from decimal import Decimal

from rest_framework import serializers
from .models import MenuItem, Order, OrderItem, Restaurant
from . import codes
from .pricing import order_total


class RestaurantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Restaurant
        fields = (
            "id", "name", "address", "cuisine", "description", "image_url",
            "offers_delivery", "delivery_fee",
        )
        read_only_fields = fields


class MenuItemSerializer(serializers.ModelSerializer):
    restaurant_name = serializers.CharField(source="restaurant.name", read_only=True)

    class Meta:
        model = MenuItem
        fields = (
            "id",
            "restaurant",
            "restaurant_name",
            "name",
            "description",
            "price",
            "is_available",
        )
        read_only_fields = fields


class MenuGroupItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = MenuItem
        fields = ("id", "name", "description", "price")
        read_only_fields = fields


def menu_group(category, items):
    """One group of the grouped menu; `category` is None for the "Other" group."""
    return {
        "id": category.id if category else None,
        "name": category.name if category else "Other",
        "position": category.position if category else None,
        "items": MenuGroupItemSerializer(items, many=True).data,
    }


class TransitionSerializer(serializers.Serializer):
    # Any status of the model is a valid thing to ask for; whether the order may go there
    # from where it is, is the workflow's decision (409), not the request's shape (400).
    status = serializers.ChoiceField(choices=Order.Status.choices)


class AssistantMessageSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=("user", "assistant"))
    content = serializers.CharField(max_length=1000)


class AssistantRequestSerializer(serializers.Serializer):
    restaurant = serializers.PrimaryKeyRelatedField(
        queryset=Restaurant.objects.all()
    )
    messages = AssistantMessageSerializer(
        many=True, allow_empty=False, max_length=20
    )

    def validate_messages(self, messages):
        if messages[-1]["role"] != "user":
            raise serializers.ValidationError("The last message must be from the user.")
        return messages


class OrderItemSerializer(serializers.ModelSerializer):
    quantity = serializers.IntegerField(min_value=1)
    menu_item_name = serializers.CharField(source="menu_item.name", read_only=True)

    class Meta:
        model = OrderItem
        fields = ("menu_item", "quantity", "unit_price", "menu_item_name")
        read_only_fields = ("unit_price",)


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, allow_empty=False)
    restaurant_name = serializers.CharField(source="restaurant.name", read_only=True)
    total = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = (
            "id", "restaurant", "restaurant_name", "customer_name", "status",
            "payment_status", "paypal_order_id", "created_at", "items", "total",
            "fulfilment_type", "delivery_address", "delivery_fee",
        )
        # Orders are only read: one is created when a checkout is paid (ADR-0011).
        read_only_fields = fields

    def get_total(self, obj):
        return f"{order_total(obj):.2f}"


class CompletedOrderSerializer(OrderSerializer):
    """The order as answered when a checkout completes: the only list-style response that
    carries the order code (ADR-0014), because the buyer must be given it once."""

    public_code = serializers.SerializerMethodField()

    class Meta(OrderSerializer.Meta):
        fields = OrderSerializer.Meta.fields + ("public_code",)
        read_only_fields = fields

    def get_public_code(self, obj):
        return codes.display(obj.public_code)


class GuestOrderItemSerializer(serializers.ModelSerializer):
    menu_item_name = serializers.CharField(source="menu_item.name", read_only=True)

    class Meta:
        model = OrderItem
        fields = ("menu_item_name", "quantity", "unit_price")
        read_only_fields = fields


class GuestOrderSerializer(serializers.ModelSerializer):
    """What someone holding an order code may see. The fields are listed one by one, so a
    field added to the model later is not shown by accident: no customer name, no delivery
    address, no numeric id and nothing about the payer."""

    restaurant_name = serializers.CharField(source="restaurant.name", read_only=True)
    items = GuestOrderItemSerializer(many=True, read_only=True)
    total = serializers.SerializerMethodField()
    public_code = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = (
            "restaurant_name", "status", "created_at", "fulfilment_type", "items",
            "delivery_fee", "total", "public_code",
        )
        read_only_fields = fields

    def get_total(self, obj):
        return f"{order_total(obj):.2f}"

    def get_public_code(self, obj):
        return codes.display(obj.public_code)



class CheckoutSerializer(serializers.ModelSerializer):
    """The cart a customer starts paying for (ADR-0011). It checks the cart and stores nothing."""

    items = OrderItemSerializer(many=True, allow_empty=False)

    class Meta:
        model = Order
        fields = ("restaurant", "customer_name", "items", "fulfilment_type", "delivery_address")

    def validate(self, attrs):
        restaurant = attrs["restaurant"]
        fulfilment = {}
        if attrs.get("fulfilment_type") == Order.FulfilmentType.DELIVERY:
            if not restaurant.offers_delivery:
                fulfilment["fulfilment_type"] = [
                    f"{restaurant.name} does not offer delivery."
                ]
            attrs["delivery_address"] = attrs.get("delivery_address", "").strip()
            if attrs["delivery_address"] == "":
                fulfilment["delivery_address"] = ["Enter a delivery address."]
        else:
            # An address sent with a pickup order is not kept.
            attrs["delivery_address"] = ""
        if fulfilment:
            raise serializers.ValidationError(fulfilment)

        seen = set()
        errors = []
        for item_data in attrs["items"]:
            menu_item = item_data["menu_item"]
            row = {}
            if menu_item.restaurant_id != restaurant.pk:
                row["menu_item"] = [f"{menu_item.name} is not on this restaurant's menu."]
            elif not menu_item.is_available:
                row["menu_item"] = [f"{menu_item.name} is unavailable."]
            elif menu_item.pk in seen:
                row["menu_item"] = [f"{menu_item.name} appears more than once."]
            seen.add(menu_item.pk)
            errors.append(row)
        if any(errors):
            raise serializers.ValidationError({"items": errors})
        return attrs


class CheckoutCaptureSerializer(serializers.Serializer):
    paypal_order_id = serializers.CharField(max_length=255)
