"""The dashboard's order list (S34, ADR-0019; owner only from S35, ADR-0020): who may read it, what it holds, its bounds."""

from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from cafe.models import MenuItem, Order, OrderItem, Restaurant
from cafe.roles import FULFILMENT
from cafe.views import DASHBOARD_LIMIT

# Every test in this file touches the database.
pytestmark = pytest.mark.django_db

URL = "dashboard-orders"


@pytest.fixture
def dish(restaurant):
    return MenuItem.objects.create(restaurant=restaurant, name="Soup", price=Decimal("4.00"))


def make_order(restaurant, dish, status=Order.Status.CONFIRMED, quantity=1, **extra):
    order = Order.objects.create(
        restaurant=restaurant, customer_name="Sam", status=status,
        payment_status=Order.PaymentStatus.PAID, **extra,
    )
    OrderItem.objects.create(order=order, menu_item=dish, quantity=quantity, unit_price=dish.price)
    return order


def test_an_owner_sees_every_restaurant_and_every_paid_status_newest_first(owner_api, restaurant, dish):
    other = Restaurant.objects.create(name="Noodle Bar", address="2 Side St")
    other_dish = MenuItem.objects.create(restaurant=other, name="Noodles", price=Decimal("6.00"))
    third = Restaurant.objects.create(name="Tea House", address="3 Tea Rd")
    third_dish = MenuItem.objects.create(restaurant=third, name="Tea", price=Decimal("2.00"))
    first = make_order(restaurant, dish, Order.Status.CONFIRMED)
    second = make_order(other, other_dish, Order.Status.COMPLETED)
    third_order = make_order(third, third_dish, Order.Status.CANCELLED)

    body = owner_api.get(reverse(URL)).json()

    assert body["count"] == 3
    assert body["truncated"] is False
    assert [row["id"] for row in body["results"]] == [third_order.id, second.id, first.id]
    assert {row["restaurant_name"] for row in body["results"]} == {restaurant.name, "Noodle Bar", "Tea House"}


def test_unpaid_pending_orders_are_not_listed(owner_api, restaurant, dish):
    make_order(restaurant, dish, Order.Status.PENDING)
    shown = make_order(restaurant, dish, Order.Status.CONFIRMED)

    ids = [row["id"] for row in owner_api.get(reverse(URL)).json()["results"]]

    assert ids == [shown.id]


def test_the_total_and_item_count_match_the_order(owner_api, restaurant, dish):
    restaurant.offers_delivery = True
    restaurant.delivery_fee = Decimal("2.50")
    restaurant.save()
    order = make_order(
        restaurant, dish, quantity=3,
        fulfilment_type=Order.FulfilmentType.DELIVERY, delivery_address="1 Home St", delivery_fee=Decimal("2.50"),
    )

    row = owner_api.get(reverse(URL)).json()["results"][0]

    assert row["total"] == "14.50"  # 3 x 4.00 + 2.50 fee
    assert row["item_count"] == 3
    assert row["fulfilment_type"] == "delivery"
    assert row["id"] == order.id


def test_private_details_are_left_out(owner_api, restaurant, dish):
    order = make_order(
        restaurant, dish, fulfilment_type=Order.FulfilmentType.DELIVERY,
        delivery_address="1 Home St", delivery_fee=Decimal("1.00"),
        paypal_order_id="PP-SECRET-1",
    )
    text = owner_api.get(reverse(URL)).content.decode()

    assert "1 Home St" not in text
    assert "PP-SECRET-1" not in text
    assert order.public_code not in text
    for field in ("delivery_address", "public_code", "paypal_order_id", "payer", "payment_status"):
        assert field not in text


def test_only_these_fields_are_returned(owner_api, restaurant, dish):
    make_order(restaurant, dish)

    row = owner_api.get(reverse(URL)).json()["results"][0]

    assert set(row) == {
        "id", "restaurant", "restaurant_name", "customer_name", "status",
        "fulfilment_type", "created_at", "item_count", "total",
    }


def test_a_fulfilment_user_is_refused_even_for_their_own_restaurant(make_user, restaurant, dish, api_client):
    make_order(restaurant, dish)
    api_client.force_authenticate(make_user("cook", FULFILMENT, restaurants=[restaurant]))

    response = api_client.get(reverse(URL))

    assert response.status_code == 403
    assert "results" not in response.json()


def test_an_admin_is_refused(admin_api, restaurant, dish):
    make_order(restaurant, dish)

    response = admin_api.get(reverse(URL))

    assert response.status_code == 403
    assert "results" not in response.json()


def test_a_superuser_counts_as_an_admin_and_is_refused(api_client, restaurant, dish, django_user_model):
    make_order(restaurant, dish)
    api_client.force_authenticate(django_user_model.objects.create_superuser("root", password="a-good-password-1"))

    assert api_client.get(reverse(URL)).status_code == 403


def test_nothing_can_be_written_through_it(owner_api):
    for method in ("post", "put", "patch", "delete"):
        assert getattr(owner_api, method)(reverse(URL), {}, format="json").status_code == 405


def test_the_list_is_cut_at_the_limit_and_says_so(owner_api, restaurant, dish, monkeypatch):
    monkeypatch.setattr("cafe.views.DASHBOARD_LIMIT", 3)
    for _ in range(4):
        make_order(restaurant, dish)

    body = owner_api.get(reverse(URL)).json()

    assert body["count"] == 4
    assert body["truncated"] is True
    assert len(body["results"]) == 3


def test_the_limit_is_one_thousand():
    assert DASHBOARD_LIMIT == 1000


def count_queries(client):
    with CaptureQueriesContext(connection) as ctx:
        assert client.get(reverse(URL)).status_code == 200
    return len(ctx)


def test_the_number_of_queries_does_not_grow_with_the_orders(owner_api, restaurant, dish):
    for _ in range(5):
        make_order(restaurant, dish, quantity=2)
    with_five = count_queries(owner_api)

    for _ in range(45):
        make_order(restaurant, dish, quantity=2)

    assert count_queries(owner_api) == with_five
