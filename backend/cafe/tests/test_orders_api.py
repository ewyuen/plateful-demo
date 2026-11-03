from decimal import Decimal

import pytest
from django.urls import reverse

from cafe.models import MenuItem, Order, OrderItem, Restaurant

# Every test in this file touches the database. Orders are created by a paid checkout
# (see test_checkout.py), so these tests build them directly and only read them.
pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client(admin_api):
    # Reading orders is for staff now (ADR-0014), so these tests read as an admin.
    return admin_api


def test_list_is_paginated_newest_first(api_client, restaurant):
    Order.objects.bulk_create(
        [Order(restaurant=restaurant, customer_name=f"C{i}") for i in range(21)]
    )

    response = api_client.get(reverse("order-list"))

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"count", "next", "previous", "results"}
    assert body["count"] == 21
    assert body["previous"] is None
    assert body["next"] is not None
    ids = [order["id"] for order in body["results"]]
    assert len(ids) == 20
    assert ids == sorted(ids, reverse=True)
    assert ids[0] == Order.objects.order_by("-id").first().pk

    second = api_client.get(reverse("order-list"), {"page": 2}).json()
    assert len(second["results"]) == 1
    assert second["next"] is None


def test_retrieve_returns_the_order_with_its_items(api_client, order, menu_item):
    OrderItem.objects.create(
        order=order, menu_item=menu_item, quantity=2, unit_price=menu_item.price
    )

    response = api_client.get(reverse("order-detail", args=[order.pk]))

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == order.pk
    assert body["items"][0]["menu_item_name"] == "Noodles"
    assert body["total"] == "19.98"


def test_retrieve_missing_order_returns_404(api_client):
    response = api_client.get(reverse("order-detail", args=[9999]))

    assert response.status_code == 404


@pytest.mark.parametrize("method", ["put", "patch", "delete"])
def test_orders_cannot_be_changed_or_deleted(api_client, order, method):
    url = reverse("order-detail", args=[order.pk])

    response = getattr(api_client, method)(url, {}, format="json")

    assert response.status_code == 405
    assert Order.objects.filter(pk=order.pk).exists()


def test_retrieve_shows_the_stored_payment_fields(api_client, order):
    order.payment_status = Order.PaymentStatus.PAID
    order.paypal_order_id = "PP-123"
    order.save()

    response = api_client.get(reverse("order-detail", args=[order.pk]))

    assert response.status_code == 200
    body = response.json()
    assert body["payment_status"] == "paid"
    assert body["paypal_order_id"] == "PP-123"


def test_list_shows_the_payment_state_of_each_order(api_client, restaurant):
    paid = Order.objects.create(
        restaurant=restaurant,
        customer_name="Ann",
        payment_status=Order.PaymentStatus.PAID,
        paypal_order_id="PP-1",
    )
    unpaid = Order.objects.create(restaurant=restaurant, customer_name="Bo")

    response = api_client.get(reverse("order-list"))

    assert response.status_code == 200
    by_id = {row["id"]: row for row in response.json()["results"]}
    assert by_id[paid.pk]["payment_status"] == "paid"
    assert by_id[paid.pk]["paypal_order_id"] == "PP-1"
    assert by_id[unpaid.pk]["payment_status"] == "pending"
    assert by_id[unpaid.pk]["paypal_order_id"] is None


@pytest.mark.parametrize("method", ["put", "patch"])
def test_payment_fields_cannot_be_changed_through_the_orders_endpoint(api_client, order, method):
    response = getattr(api_client, method)(
        reverse("order-detail", args=[order.pk]),
        {"payment_status": "paid"},
        format="json",
    )

    assert response.status_code == 405
    order.refresh_from_db()
    assert order.payment_status == Order.PaymentStatus.PENDING


def test_new_orders_from_a_checkout_are_paid(api_client, restaurant, menu_item, fake_paypal):
    from cafe.tests.helpers import cart, pay

    body = pay(api_client, cart(restaurant, menu_item)).json()

    assert (body["payment_status"], body["status"]) == ("paid", "confirmed")
    assert api_client.get(reverse("order-detail", args=[body["id"]])).json()["payment_status"] == "paid"
