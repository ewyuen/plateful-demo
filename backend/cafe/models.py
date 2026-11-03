from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from . import codes

class Restaurant(models.Model):
    name = models.CharField(max_length=255)
    address = models.TextField()
    cuisine = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    # a link only; the frontend uses its own photo pool when this is empty
    image_url = models.URLField(max_length=500, blank=True)
    offers_delivery = models.BooleanField(default=False)
    # Copied onto each delivery order when it is placed (ADR-0015).
    delivery_fee = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    # The people who work for this restaurant and may see and move its orders (ADR-0014).
    staff = models.ManyToManyField(
        settings.AUTH_USER_MODEL, related_name="staffed_restaurants", blank=True
    )

    def __str__(self):
        return self.name

class MenuCategory(models.Model):
    restaurant = models.ForeignKey(
        "Restaurant", on_delete=models.CASCADE, related_name="categories"
    )
    name = models.CharField(max_length=100)
    position = models.PositiveSmallIntegerField(default=0)

    class Meta:
        verbose_name_plural = "menu categories"
        ordering = ["position", "name", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["restaurant", "name"], name="unique_category_per_restaurant"
            ),
        ]

    def __str__(self):
        return f"{self.restaurant.name}: {self.name}"

class MenuItem(models.Model):
    restaurant = models.ForeignKey(
        "Restaurant", on_delete=models.CASCADE, related_name="menu_items"
    )
    # Deleting a category keeps its dishes; they fall under "Other".
    category = models.ForeignKey(
        "MenuCategory",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="items",
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=8, decimal_places=2)
    is_available = models.BooleanField(default=True)

    def __str__(self):
        return self.name

    def clean(self):
        # A database constraint cannot compare two tables, so forms and
        # full_clean() check that the category belongs to this restaurant.
        if (
            self.category_id is not None
            and self.category.restaurant_id != self.restaurant_id
        ):
            raise ValidationError(
                {"category": "The category must belong to the item's restaurant."}
            )

class Order(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        CONFIRMED = "confirmed", "Confirmed"
        PREPARING = "preparing", "Preparing"
        READY = "ready", "Ready"
        OUT_FOR_DELIVERY = "out_for_delivery", "Out for delivery"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"

    class FulfilmentType(models.TextChoices):
        PICKUP = "pickup", "Pickup"
        DELIVERY = "delivery", "Delivery"

    class PaymentStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        PAID = "paid", "Paid"
        FAILED = "failed", "Failed"

    restaurant = models.ForeignKey(
        "Restaurant", on_delete=models.PROTECT, related_name="orders"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING
    )
    customer_name = models.CharField(max_length=255)
    payment_status = models.CharField(
        max_length=20, choices=PaymentStatus.choices, default=PaymentStatus.PENDING
    )
    paypal_order_id = models.CharField(max_length=255, blank=True, null=True)
    fulfilment_type = models.CharField(
        max_length=20, choices=FulfilmentType.choices, default=FulfilmentType.PICKUP
    )
    delivery_address = models.TextField(blank=True)
    # A snapshot of Restaurant.delivery_fee at placement, so later fee changes never
    # alter old orders (like OrderItem.unit_price).
    delivery_fee = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    # What PayPal told us when the payment was captured (ADR-0011). Kept for a later
    # "find my orders" lookup and never returned by the open orders endpoints.
    paypal_capture_id = models.CharField(max_length=255, blank=True, default="")
    payer_email = models.EmailField(blank=True, default="")
    payer_id = models.CharField(max_length=255, blank=True, default="")
    # What a guest uses to look the order up (ADR-0014): random, unique, shown once at
    # payment and never derived from the id. Not editable, and in no list response.
    public_code = models.CharField(
        max_length=codes.LENGTH, unique=True, default=codes.generate, editable=False
    )
    # The customer account that claimed this order with its code (ADR-0014). Empty for guest
    # orders. The first claim wins, and only an admin changes it afterwards.
    customer = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="orders",
    )

    class Meta:
        constraints = [
            # A PayPal order produces at most one Order, even if two captures race.
            models.UniqueConstraint(
                fields=["paypal_order_id"],
                condition=models.Q(paypal_order_id__isnull=False)
                & ~models.Q(paypal_order_id=""),
                name="unique_paypal_order_id",
            ),
        ]

    def __str__(self):
        return f"Order {self.id} at {self.restaurant_id}"

class OrderItem(models.Model):
    order = models.ForeignKey(
        "Order", on_delete=models.CASCADE, related_name="items"
    )
    menu_item = models.ForeignKey(
        "MenuItem", on_delete=models.PROTECT, related_name="order_items"
    )
    quantity = models.PositiveSmallIntegerField()
    # snapshot of MenuItem.price at order time, so later price edits
    # never rewrite past orders
    unit_price = models.DecimalField(max_digits=8, decimal_places=2)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["order", "menu_item"], name="unique_menu_item_per_order"
            ),
            models.CheckConstraint(
                condition=models.Q(quantity__gte=1),
                name="order_item_quantity_at_least_one",
            ),
        ]

    def __str__(self):
        return f"{self.quantity} x {self.menu_item_id}"


class CheckoutDraft(models.Model):
    """The cart frozen when a customer starts paying (ADR-0011).

    An Order is created from it only when PayPal confirms the capture, so an unpaid
    order never exists. Prices and the delivery fee are copied here when the checkout
    starts, so the order equals the amount PayPal was asked for.
    """

    restaurant = models.ForeignKey(
        "Restaurant", on_delete=models.CASCADE, related_name="checkout_drafts"
    )
    customer_name = models.CharField(max_length=255)
    fulfilment_type = models.CharField(
        max_length=20,
        choices=Order.FulfilmentType.choices,
        default=Order.FulfilmentType.PICKUP,
    )
    delivery_address = models.TextField(blank=True)
    delivery_fee = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    paypal_order_id = models.CharField(max_length=255, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Checkout {self.paypal_order_id} at {self.restaurant_id}"


class CheckoutDraftItem(models.Model):
    draft = models.ForeignKey(
        "CheckoutDraft", on_delete=models.CASCADE, related_name="items"
    )
    # PROTECT: a dish cannot be deleted while a checkout that names it is waiting
    # for a payment, so the order can always be created after the money is taken.
    menu_item = models.ForeignKey(
        "MenuItem", on_delete=models.PROTECT, related_name="draft_items"
    )
    quantity = models.PositiveSmallIntegerField()
    unit_price = models.DecimalField(max_digits=8, decimal_places=2)

    def __str__(self):
        return f"{self.quantity} x {self.menu_item_id}"
