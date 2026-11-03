from decimal import Decimal

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.urls import reverse

from cafe.models import MenuItem, Order, OrderItem, Restaurant
from cafe.pricing import order_total
from cafe.tests.helpers import cart, pay, start
from cafe.workflow import ACTIVE_STATUSES, QUEUE_STATUSES, allowed_next

# Every test in this file touches the database.
pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client(admin_api):
    # These tests are about orders and the workflow, not about who may see them (see
    # test_staff_access.py), so they act as an admin.
    return admin_api

S = Order.Status


@pytest.fixture
def delivering(restaurant):
    restaurant.offers_delivery = True
    restaurant.delivery_fee = Decimal("3.00")
    restaurant.save()
    return restaurant


def place(api_client, restaurant, menu_item, **extra):
    """Pay for two dishes and answer the capture response, which carries the new order."""
    return pay(api_client, cart(restaurant, menu_item, **extra))


# Defaults


def test_restaurants_default_to_no_delivery_and_no_fee(restaurant):
    restaurant.refresh_from_db()

    assert restaurant.offers_delivery is False
    assert restaurant.delivery_fee == Decimal("0.00")


def test_orders_default_to_pickup_with_no_address_and_no_fee(order):
    assert order.fulfilment_type == Order.FulfilmentType.PICKUP
    assert order.delivery_address == ""
    assert order.delivery_fee == Decimal("0.00")


# Placing orders


def test_a_pickup_order_has_no_address_and_no_fee(api_client, delivering, menu_item, fake_paypal):
    response = place(api_client, delivering, menu_item)

    body = response.json()
    assert response.status_code == 201
    assert (body["fulfilment_type"], body["delivery_address"], body["delivery_fee"]) == ("pickup", "", "0.00")
    assert body["total"] == "19.98"


def test_a_delivery_order_keeps_the_address_and_the_restaurants_fee(api_client, delivering, menu_item, fake_paypal):
    response = place(
        api_client, delivering, menu_item, fulfilment_type="delivery", delivery_address="  5 Elm Road "
    )

    body = response.json()
    assert response.status_code == 201
    assert body["fulfilment_type"] == "delivery"
    assert body["delivery_address"] == "5 Elm Road"
    assert body["delivery_fee"] == "3.00"
    assert body["total"] == "22.98"


def test_a_fee_from_the_client_is_ignored(api_client, delivering, menu_item, fake_paypal):
    response = place(
        api_client, delivering, menu_item, fulfilment_type="delivery",
        delivery_address="5 Elm Road", delivery_fee="0.01",
    )

    assert response.json()["delivery_fee"] == "3.00"


def test_a_pickup_order_never_gets_a_fee_even_at_a_delivering_restaurant(api_client, delivering, menu_item, fake_paypal):
    response = place(api_client, delivering, menu_item, delivery_fee="9.00")

    assert response.json()["delivery_fee"] == "0.00"


def test_later_fee_changes_do_not_alter_old_orders(api_client, delivering, menu_item, fake_paypal):
    order_id = place(
        api_client, delivering, menu_item, fulfilment_type="delivery", delivery_address="5 Elm Road"
    ).json()["id"]

    delivering.delivery_fee = Decimal("8.00")
    delivering.save()

    body = api_client.get(reverse("order-detail", args=[order_id])).json()
    assert body["delivery_fee"] == "3.00" and body["total"] == "22.98"


def test_delivery_at_a_restaurant_that_does_not_deliver_is_refused(api_client, restaurant, menu_item, fake_paypal):
    response = start(
        api_client,
        cart(restaurant, menu_item, fulfilment_type="delivery", delivery_address="5 Elm Road"),
    )

    assert response.status_code == 400
    assert "Corner Kitchen does not offer delivery" in response.json()["fulfilment_type"][0]
    assert Order.objects.count() == 0


@pytest.mark.parametrize("address", ["", "   ", None])
def test_a_delivery_order_needs_an_address(api_client, delivering, menu_item, address, fake_paypal):
    extra = {"fulfilment_type": "delivery"}
    if address is not None:
        extra["delivery_address"] = address

    response = start(api_client, cart(delivering, menu_item, **extra))

    assert response.status_code == 400
    assert "delivery_address" in response.json()
    assert Order.objects.count() == 0


def test_an_address_sent_with_a_pickup_order_is_not_stored(api_client, delivering, menu_item, fake_paypal):
    response = place(api_client, delivering, menu_item, fulfilment_type="pickup", delivery_address="5 Elm Road")

    assert response.json()["delivery_address"] == ""
    assert Order.objects.get().delivery_address == ""


def test_an_unknown_fulfilment_type_is_refused(api_client, delivering, menu_item, fake_paypal):
    response = start(api_client, cart(delivering, menu_item, fulfilment_type="drone"))

    assert response.status_code == 400
    assert Order.objects.count() == 0


# Totals and the PayPal amount


def paypal_amount(api_client, body, fake_paypal):
    start(api_client, body)
    return fake_paypal.created[-1][0]


def test_paypal_is_asked_for_the_total_for_pickup(api_client, delivering, menu_item, fake_paypal):
    amount = paypal_amount(api_client, cart(delivering, menu_item), fake_paypal)

    assert amount == Decimal("19.98")


def test_paypal_is_asked_for_items_plus_the_fee_for_delivery(api_client, delivering, menu_item, fake_paypal):
    body = cart(delivering, menu_item, fulfilment_type="delivery", delivery_address="5 Elm Road")

    assert paypal_amount(api_client, body, fake_paypal) == Decimal("22.98")


def test_the_order_total_equals_the_amount_paypal_was_asked_for(api_client, delivering, menu_item, fake_paypal):
    body = cart(delivering, menu_item, fulfilment_type="delivery", delivery_address="5 Elm Road")
    created = pay(api_client, body).json()

    assert Decimal(created["total"]) == fake_paypal.created[-1][0] == Decimal("22.98")


def test_an_amount_in_the_checkout_request_is_still_ignored(api_client, delivering, menu_item, fake_paypal):
    body = cart(
        delivering, menu_item, fulfilment_type="delivery", delivery_address="5 Elm Road", amount="0.01"
    )

    start(api_client, body)

    assert fake_paypal.created[-1][0] == Decimal("22.98")


def test_order_total_adds_the_fee_to_the_items(order, menu_item):
    OrderItem.objects.create(order=order, menu_item=menu_item, quantity=1, unit_price=Decimal("17.50"))
    order.delivery_fee = Decimal("3.00")

    assert order_total(order) == Decimal("20.50")


# The restaurant API


def test_restaurants_show_whether_they_deliver_and_the_fee(api_client, delivering):
    detail = api_client.get(reverse("restaurant-detail", args=[delivering.pk])).json()

    assert detail["offers_delivery"] is True and detail["delivery_fee"] == "3.00"


def test_only_restaurants_that_deliver_can_be_listed(api_client, delivering):
    Restaurant.objects.create(name="Noodle Bar", address="2 Side St")

    names = [r["name"] for r in api_client.get(reverse("restaurant-list"), {"offers_delivery": "true"}).json()["results"]]

    assert names == ["Corner Kitchen"]


@pytest.mark.parametrize("value", ["false", "1", "yes", ""])
def test_any_other_value_does_not_filter(api_client, delivering, value):
    Restaurant.objects.create(name="Noodle Bar", address="2 Side St")

    results = api_client.get(reverse("restaurant-list"), {"offers_delivery": value}).json()["results"]

    assert len(results) == 2


def test_delivery_combines_with_the_cuisine_filter(api_client, delivering):
    delivering.cuisine = "Noodles"
    delivering.save()
    Restaurant.objects.create(name="Noodle Bar", address="x", cuisine="Noodles")
    Restaurant.objects.create(name="Golden Wok", address="x", cuisine="Cantonese", offers_delivery=True)

    results = api_client.get(
        reverse("restaurant-list"), {"offers_delivery": "true", "cuisine": "Noodles"}
    ).json()["results"]

    assert [r["name"] for r in results] == ["Corner Kitchen"]


def test_staff_see_and_edit_the_delivery_settings(admin_client, restaurant):
    changelist = admin_client.get(reverse("admin:cafe_restaurant_changelist")).content.decode()
    assert "Offers delivery" in changelist or "offers delivery" in changelist.lower()

    response = admin_client.post(
        reverse("admin:cafe_restaurant_change", args=[restaurant.pk]),
        {"name": "Corner Kitchen", "address": "1 Main St", "offers_delivery": "on", "delivery_fee": "2.50",
         "cuisine": "", "description": "", "image_url": ""},
    )

    assert response.status_code == 302
    restaurant.refresh_from_db()
    assert restaurant.offers_delivery and restaurant.delivery_fee == Decimal("2.50")


# The workflow for delivery


def test_a_ready_delivery_order_goes_out_for_delivery_then_completes():
    assert allowed_next(S.READY, Order.FulfilmentType.DELIVERY) == ["out_for_delivery"]
    assert allowed_next(S.OUT_FOR_DELIVERY, Order.FulfilmentType.DELIVERY) == ["completed"]


def test_a_ready_pickup_order_still_completes_directly():
    assert allowed_next(S.READY) == ["completed"]
    assert allowed_next(S.READY, Order.FulfilmentType.PICKUP) == ["completed"]


def test_earlier_steps_are_the_same_for_both_types():
    for status in (S.PENDING, S.CONFIRMED, S.PREPARING):
        assert allowed_next(status, "delivery") == allowed_next(status, "pickup")


def test_out_for_delivery_is_active_and_in_the_queue():
    assert S.OUT_FOR_DELIVERY in ACTIVE_STATUSES and S.OUT_FOR_DELIVERY in QUEUE_STATUSES


def move(api_client, order, target):
    return api_client.post(reverse("order-transition", args=[order.pk]), {"status": target}, format="json")


def test_a_delivery_order_is_moved_through_every_step(api_client, order):
    order.fulfilment_type = Order.FulfilmentType.DELIVERY
    order.status = S.READY
    order.save()

    first = move(api_client, order, S.OUT_FOR_DELIVERY)
    skipped = move(api_client, order, S.READY)
    done = move(api_client, order, S.COMPLETED)

    assert [first.status_code, skipped.status_code, done.status_code] == [200, 409, 200]


def test_a_ready_delivery_order_cannot_skip_the_delivery_step(api_client, order):
    order.fulfilment_type = Order.FulfilmentType.DELIVERY
    order.status = S.READY
    order.save()

    response = move(api_client, order, S.COMPLETED)

    assert response.status_code == 409
    assert response.json()["allowed"] == ["out_for_delivery"]


def test_a_pickup_order_cannot_be_sent_out_for_delivery(api_client, order):
    order.status = S.READY
    order.save()

    response = move(api_client, order, S.OUT_FOR_DELIVERY)

    assert response.status_code == 409
    assert response.json()["allowed"] == ["completed"]


def test_an_order_out_for_delivery_is_in_the_default_queue(api_client, order):
    order.fulfilment_type = Order.FulfilmentType.DELIVERY
    order.status = S.OUT_FOR_DELIVERY
    order.save()

    body = api_client.get(reverse("fulfilment-orders")).json()

    assert [row["id"] for row in body["results"]] == [order.pk]
    assert body["results"][0]["fulfilment_type"] == "delivery"
    chosen = api_client.get(reverse("fulfilment-orders"), {"status": "out_for_delivery"}).json()
    assert chosen["count"] == 1


# Existing data


@pytest.mark.django_db(transaction=True)
def test_orders_and_restaurants_from_before_delivery_stay_valid():
    def migrate(targets):
        executor = MigrationExecutor(connection)
        executor.migrate(targets)
        return MigrationExecutor(connection).loader.project_state(targets).apps

    before = [("cafe", "0004_order_workflow_statuses")]
    old = migrate(before)
    try:
        r = old.get_model("cafe", "Restaurant").objects.create(name="Corner Kitchen", address="x")
        old.get_model("cafe", "Order").objects.create(restaurant=r, customer_name="Sam", status="confirmed")

        new = migrate([("cafe", "0005_delivery")])

        restaurant = new.get_model("cafe", "Restaurant").objects.get()
        order = new.get_model("cafe", "Order").objects.get()
        assert (restaurant.offers_delivery, restaurant.delivery_fee) == (False, Decimal("0.00"))
        assert (order.fulfilment_type, order.delivery_address, order.delivery_fee) == (
            "pickup", "", Decimal("0.00"),
        )
        assert order.status == "confirmed"
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
