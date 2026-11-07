import uuid
from decimal import Decimal

from django.db import Error as DatabaseError
from django.db import connection
from django.db.models import Prefetch
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import generics, mixins, status, viewsets
from rest_framework.decorators import (
    action,
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.exceptions import ValidationError
from rest_framework.filters import SearchFilter
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from . import assistant, codes, paypal, workflow
from .permissions import IsCustomer, IsOwner, IsStaff
from .pricing import total_for
from .roles import CUSTOMER, restaurants_of, role_of
from .models import (
    CheckoutDraft,
    CheckoutDraftItem,
    MenuItem,
    Order,
    OrderItem,
    Restaurant,
)
from .serializers import (
    AssistantRequestSerializer,
    CheckoutCaptureSerializer,
    CheckoutSerializer,
    CompletedOrderSerializer,
    DashboardOrderSerializer,
    GuestOrderSerializer,
    MenuItemSerializer,
    OrderSerializer,
    TransitionSerializer,
    RestaurantSerializer,
    menu_group,
)


class RestaurantViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Restaurant.objects.order_by("name", "id")
    serializer_class = RestaurantSerializer
    permission_classes = [AllowAny]
    # ?search= matches the name or the cuisine, ignoring case (ADR-0016)
    filter_backends = [SearchFilter]
    search_fields = ("name", "cuisine")

    def get_queryset(self):
        queryset = super().get_queryset()
        # The whole-value cuisine filter narrows the list only, so a restaurant
        # is always found by its id whatever the query string says.
        if self.action == "list":
            cuisine = self.request.query_params.get("cuisine", "").strip()
            if cuisine:
                queryset = queryset.filter(cuisine__iexact=cuisine)
            if self.request.query_params.get("offers_delivery") == "true":
                queryset = queryset.filter(offers_delivery=True)
        return queryset

    def filter_queryset(self, queryset):
        # Search narrows the list only, like the cuisine filter above.
        if self.action != "list":
            return queryset
        return super().filter_queryset(queryset)

    @action(detail=True, pagination_class=None)
    def menu(self, request, pk=None):
        """The restaurant's available dishes grouped by category, in one request.

        Four queries however many categories or dishes there are: the restaurant,
        the categories, their available dishes (one prefetch), and the dishes
        that have no category.
        """
        restaurant = self.get_object()
        available = MenuItem.objects.filter(is_available=True).order_by("name", "id")
        categories = restaurant.categories.prefetch_related(
            Prefetch("items", queryset=available)
        )
        groups = [
            menu_group(category, category.items.all())
            for category in categories
            if category.items.all()
        ]
        others = list(available.filter(restaurant=restaurant, category__isnull=True))
        if others:
            groups.append(menu_group(None, others))
        return Response(
            {"restaurant": RestaurantSerializer(restaurant).data, "groups": groups}
        )

    @action(detail=False, pagination_class=None)
    def cuisines(self, request):
        names = (
            Restaurant.objects.exclude(cuisine="")
            .order_by("cuisine")
            .values_list("cuisine", flat=True)
            .distinct()
        )
        return Response(list(names))


class MenuItemViewSet(viewsets.ReadOnlyModelViewSet):
    # The serializer reads restaurant.name, so join the restaurant (ADR-0004).
    queryset = MenuItem.objects.select_related("restaurant").order_by("name", "id")
    serializer_class = MenuItemSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        queryset = super().get_queryset()
        restaurant = self.request.query_params.get("restaurant")
        if restaurant is not None:
            try:
                restaurant_id = int(restaurant)
            except ValueError:
                raise ValidationError({"restaurant": ["Must be a restaurant id."]})
            if not 0 < restaurant_id < 2**63:
                # ids are 64-bit; anything outside cannot match and would
                # overflow the database driver
                return queryset.none()
            queryset = queryset.filter(restaurant_id=restaurant_id)
        return queryset


class OrderViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    # The serializer reads order.restaurant, order.items and each item's
    # menu_item, so load them up front (ADR-0004). Keep get_total on
    # obj.items.all() so it reuses the prefetched rows.
    queryset = (
        Order.objects.select_related("restaurant")
        .prefetch_related(
            Prefetch("items", queryset=OrderItem.objects.select_related("menu_item"))
        )
        .order_by("-created_at", "-id")
    )
    serializer_class = OrderSerializer
    # Reading orders is for staff (ADR-0014). Guests find their order with its code instead.
    permission_classes = [IsStaff]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.action in ("list", "retrieve"):
            # A fulfilment user reads only the orders of the restaurants they work for. The
            # transition looks the order up unscoped and answers 403 for another restaurant.
            queryset = queryset.filter(restaurant__in=restaurants_of(self.request.user))
        return queryset

    @action(detail=True, methods=["post"], permission_classes=[IsStaff])
    def transition(self, request, pk=None):
        """Move the order to its next step (ADR-0015).

        The row is locked before the check, so when two people press a button on the same
        order the second one finds the new status and is refused with 409.
        """
        serializer = TransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target = serializer.validated_data["status"]

        with transaction.atomic():
            order = get_object_or_404(
                self.filter_queryset(
                    self.get_queryset().select_for_update(of=("self",))
                ),
                pk=pk,
            )
            self.check_object_permissions(request, order)
            # A fulfilment user moves only the orders of restaurants they work for.
            if not restaurants_of(request.user).filter(pk=order.restaurant_id).exists():
                return Response(
                    {"detail": "You do not work for this restaurant."},
                    status=status.HTTP_403_FORBIDDEN,
                )

            allowed = workflow.allowed_next(order.status, order.fulfilment_type)
            if target not in allowed:
                return Response(
                    {
                        "detail": f"An order that is {order.status} cannot become {target}.",
                        "allowed": allowed,
                    },
                    status=status.HTTP_409_CONFLICT,
                )
            order.status = target
            order.save(update_fields=["status"])
            return Response(OrderSerializer(order).data)


class FulfilmentOrderList(generics.ListAPIView):
    """The orders restaurants have to work on, from every restaurant (open in alpha2).

    Pending (unpaid) orders are not here. By default only the active ones are; `?status=`
    takes a comma-separated list of the queue statuses, and `?restaurant=` an id.
    """

    serializer_class = OrderSerializer
    # Staff only (ADR-0014), and only the orders of the restaurants the user works for.
    permission_classes = [IsStaff]

    def get_queryset(self):
        wanted = self.request.query_params.get("status")
        if wanted is None or wanted.strip() == "":
            statuses = [str(s.value) for s in workflow.ACTIVE_STATUSES]
        else:
            statuses = [part.strip() for part in wanted.split(",")]
            known = [str(s.value) for s in workflow.QUEUE_STATUSES]
            unknown = [part for part in statuses if part not in known]
            if unknown:
                raise ValidationError(
                    {"status": [f"Choose from: {', '.join(known)}."]}
                )
        queryset = (
            Order.objects.filter(
                status__in=statuses,
                restaurant__in=restaurants_of(self.request.user),
            )
            .select_related("restaurant")
            .prefetch_related(
                Prefetch("items", queryset=OrderItem.objects.select_related("menu_item"))
            )
            .order_by("-created_at", "-id")
        )

        restaurant = self.request.query_params.get("restaurant")
        if restaurant is not None:
            try:
                restaurant_id = int(restaurant)
            except ValueError:
                raise ValidationError({"restaurant": ["Must be a restaurant id."]})
            if not 0 < restaurant_id < 2**63:
                return queryset.none()
            queryset = queryset.filter(restaurant_id=restaurant_id)
        return queryset


def _orders_for_response():
    """Orders with what OrderSerializer reads already loaded (ADR-0004)."""
    return Order.objects.select_related("restaurant").prefetch_related(
        Prefetch("items", queryset=OrderItem.objects.select_related("menu_item"))
    )


class CheckoutStartView(APIView):
    """Start paying: freeze the cart in a draft and create the PayPal order (ADR-0011).

    No order exists until the payment is captured. The amount comes from the draft, which
    is built from the database's prices and fee, never from the request.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    # Each start creates a PayPal order, so a client may only start so many (CHECKOUT_RATE).
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "checkout"

    def post(self, request):
        serializer = CheckoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        restaurant = data["restaurant"]
        delivering = data.get("fulfilment_type") == Order.FulfilmentType.DELIVERY
        fee = restaurant.delivery_fee if delivering else Decimal("0.00")
        lines = [
            CheckoutDraftItem(
                menu_item=item["menu_item"],
                quantity=item["quantity"],
                unit_price=item["menu_item"].price,
            )
            for item in data["items"]
        ]
        total = total_for(lines, fee)

        try:
            paypal_order_id = paypal.get_client().create_order(total, uuid.uuid4().hex)
        except paypal.PayPalNotConfigured:
            return Response(
                {"detail": "Payments are not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except paypal.PayPalError:
            return Response(
                {"detail": "PayPal request failed."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        with transaction.atomic():
            draft = CheckoutDraft.objects.create(
                restaurant=restaurant,
                customer_name=data["customer_name"],
                fulfilment_type=data.get("fulfilment_type", Order.FulfilmentType.PICKUP),
                delivery_address=data["delivery_address"],
                delivery_fee=fee,
                total=total,
                paypal_order_id=paypal_order_id,
            )
            for line in lines:
                line.draft = draft
            CheckoutDraftItem.objects.bulk_create(lines)
        return Response({"paypal_order_id": paypal_order_id})


class CheckoutCaptureView(APIView):
    """Finish paying: capture the payment and, only if it completed, create the order.

    The draft row is locked first, so two requests for the same PayPal order cannot both
    create an order: the second waits, then finds the order the first one made.

    The session says who is paying. A signed-in customer gets the order in My orders at once
    (ADR-0014); anyone else makes an order that has no customer, found by its code.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = CheckoutCaptureSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        paypal_order_id = serializer.validated_data["paypal_order_id"]

        with transaction.atomic():
            draft = (
                CheckoutDraft.objects.select_for_update(of=("self",))
                .filter(paypal_order_id=paypal_order_id)
                .first()
            )
            if draft is None:
                existing = _orders_for_response().filter(paypal_order_id=paypal_order_id).first()
                if existing is None:
                    return Response(
                        {"detail": "No checkout exists for this PayPal order."},
                        status=status.HTTP_404_NOT_FOUND,
                    )
                return Response(CompletedOrderSerializer(existing).data)

            try:
                result = paypal.get_client().capture_order(paypal_order_id)
            except paypal.PayPalNotConfigured:
                return Response(
                    {"detail": "Payments are not configured."},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            except paypal.PayPalError:
                return Response(
                    {"detail": "PayPal request failed."},
                    status=status.HTTP_502_BAD_GATEWAY,
                )
            if not result.completed:
                # The draft stays, so the buyer can pay again with another method.
                return Response(
                    {"detail": "Payment failed."},
                    status=status.HTTP_402_PAYMENT_REQUIRED,
                )

            order = Order.objects.create(
                customer=request.user if role_of(request.user) == CUSTOMER else None,
                restaurant=draft.restaurant,
                customer_name=draft.customer_name,
                status=Order.Status.CONFIRMED,
                payment_status=Order.PaymentStatus.PAID,
                paypal_order_id=paypal_order_id,
                fulfilment_type=draft.fulfilment_type,
                delivery_address=draft.delivery_address,
                delivery_fee=draft.delivery_fee,
                paypal_capture_id=result.capture_id,
                payer_email=result.payer_email,
                payer_id=result.payer_id,
            )
            OrderItem.objects.bulk_create(
                [
                    OrderItem(
                        order=order,
                        menu_item_id=line.menu_item_id,
                        quantity=line.quantity,
                        unit_price=line.unit_price,
                    )
                    for line in draft.items.all()
                ]
            )
            draft.delete()
        return Response(
            CompletedOrderSerializer(_orders_for_response().get(pk=order.pk)).data,
            status=status.HTTP_201_CREATED,
        )


NO_ORDER_FOUND = {"detail": "No order was found for that code."}


class OrderLookupView(APIView):
    """A guest finds their order by its code (ADR-0014).

    The code is in the body, never in a URL, so it stays out of access logs. A wrong code,
    an unknown code and a body that is not a code all get the same answer.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "lookup"

    def post(self, request):
        code = codes.normalize(request.data.get("code") if hasattr(request.data, "get") else None)
        order = None
        if code is not None:
            order = _orders_for_response().filter(public_code=code).first()
        if order is None:
            return Response(NO_ORDER_FOUND, status=status.HTTP_404_NOT_FOUND)
        return Response(GuestOrderSerializer(order).data)


class MyOrdersView(APIView):
    """The signed-in customer's own orders, newest first, in the guest shape (ADR-0014)."""

    permission_classes = [IsCustomer]

    def get(self, request):
        orders = (
            _orders_for_response()
            .filter(customer=request.user)
            .order_by("-created_at", "-id")
        )
        return Response(GuestOrderSerializer(orders, many=True).data)


class MyOrdersAttachView(APIView):
    """A customer claims an order with its code. The first claim wins (ADR-0014).

    One conditional UPDATE does the claim, so two people attaching together cannot both win.
    An unknown code, a malformed code and an order that is already attached all answer alike.
    """

    permission_classes = [IsCustomer]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "lookup"

    def post(self, request):
        code = codes.normalize(request.data.get("code") if hasattr(request.data, "get") else None)
        claimed = 0
        if code is not None:
            claimed = Order.objects.filter(
                public_code=code, customer__isnull=True
            ).update(customer=request.user)
        if not claimed:
            return Response(NO_ORDER_FOUND, status=status.HTTP_404_NOT_FOUND)
        order = _orders_for_response().get(public_code=code)
        return Response(GuestOrderSerializer(order).data)


class AssistantView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    # Each call costs money, so every client gets a limit (ASSISTANT_RATE, default
    # 20/min). The count lives in the cache, so it is per server process. Throttling
    # runs before the handler: an over-limit request never reaches Claude.
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "assistant"

    def post(self, request):
        serializer = AssistantRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        restaurant = serializer.validated_data["restaurant"]
        messages = [
            {"role": message["role"], "content": message["content"]}
            for message in serializer.validated_data["messages"]
        ]
        menu = [
            {
                "id": item.id,
                "name": item.name,
                "description": item.description,
                "price": f"{item.price:.2f}",
            }
            for item in restaurant.menu_items.filter(is_available=True).order_by(
                "name", "id"
            )
        ]

        if not menu:
            return Response({"reply": assistant.EMPTY_MENU_REPLY, "suggestions": []})

        # Fixed messages only: an exception's text can echo what was sent to Claude, and
        # must never reach the response. A refusal is not an error; the client turns it
        # into a normal reply.
        try:
            result = assistant.get_client().ask(menu, messages)
        except assistant.AssistantNotConfigured:
            return Response(
                {"detail": "The assistant is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except assistant.AssistantError:
            return Response(
                {"detail": "The assistant could not answer. Please try again."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response(
            {
                "reply": result.reply,
                "suggestions": assistant.validate_suggestions(
                    result.suggestions, menu
                ),
            }
        )


# Health checks for Kubernetes probes (ADR-0009). No authentication, so a probe
# needs no credentials and the views never read the session from the database.
@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def live(request):
    # Answers whenever the process can handle a request. It must not use the
    # database: a database outage would otherwise restart every backend pod.
    return Response({"status": "ok"})


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def ready(request):
    # Answers 200 only when the database answers, so the Service stops sending
    # requests to a pod that cannot serve them.
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except DatabaseError:
        return Response({"status": "unavailable"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
    return Response({"status": "ok"})


# The most orders the dashboard returns; past this it says so (`truncated`).
DASHBOARD_LIMIT = 1000


class DashboardOrderList(APIView):
    """Every restaurant's paid orders for the dashboard (S34, ADR-0019; owner only since S35, ADR-0020).

    Owner only (an admin is refused) and read-only (GET is the only method). Newest first, every status but
    pending, at most DASHBOARD_LIMIT of them; `count` says how many exist and `truncated`
    whether the list was cut. The number of queries does not depend on the number of orders.
    """

    permission_classes = [IsOwner]

    def get(self, request):
        queryset = Order.objects.filter(
            status__in=[str(s.value) for s in workflow.QUEUE_STATUSES]
        )
        count = queryset.count()
        orders = (
            queryset.select_related("restaurant")
            .prefetch_related(
                Prefetch("items", queryset=OrderItem.objects.select_related("menu_item"))
            )
            .order_by("-created_at", "-id")[:DASHBOARD_LIMIT]
        )
        return Response(
            {
                "count": count,
                "truncated": count > DASHBOARD_LIMIT,
                "results": DashboardOrderSerializer(orders, many=True).data,
            }
        )
