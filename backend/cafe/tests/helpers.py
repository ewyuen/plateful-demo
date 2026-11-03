"""Paying through the real checkout endpoints, for tests that need an order to exist.

An order is created only when a payment is captured (ADR-0011), so a test that needs one
either builds it with `Order.objects.create` (the `order` fixture) or goes through here.
"""

from django.urls import reverse


def cart(restaurant, menu_item, quantity=2, **extra):
    """A checkout request body for one dish."""
    return {
        "restaurant": restaurant.pk,
        "customer_name": "Sam",
        "items": [{"menu_item": menu_item.pk, "quantity": quantity}],
        **extra,
    }


def start(api_client, body):
    return api_client.post(reverse("checkout-start"), body, format="json")


def capture(api_client, paypal_order_id):
    return api_client.post(
        reverse("checkout-capture"), {"paypal_order_id": paypal_order_id}, format="json"
    )


def pay(api_client, body):
    """Start a checkout and capture it. Returns the capture response (201 with the order)."""
    started = start(api_client, body)
    assert started.status_code == 200, started.content
    return capture(api_client, started.json()["paypal_order_id"])
