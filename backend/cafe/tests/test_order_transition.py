from decimal import Decimal

import pytest
from rest_framework.test import APIClient
from django.urls import reverse

from cafe.models import MenuItem, Order, OrderItem
from cafe.tests.helpers import cart, pay

# Every test in this file touches the database.
pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client(admin_api):
    # These tests are about orders and the workflow, not about who may see them (see
    # test_staff_access.py), so they act as an admin.
    return admin_api

S = Order.Status


def move(api_client, order, target):
    return api_client.post(
        reverse("order-transition", args=[order.pk]), {"status": target}, format="json"
    )


@pytest.fixture
def paid_order(order, menu_item):
    OrderItem.objects.create(
        order=order, menu_item=menu_item, quantity=2, unit_price=menu_item.price
    )
    order.payment_status = Order.PaymentStatus.PAID
    order.paypal_order_id = "PP-1"
    order.status = S.CONFIRMED
    order.save()
    return order


# The transition endpoint


@pytest.mark.parametrize(
    ("start", "target"),
    [
        (S.CONFIRMED, S.PREPARING),
        (S.CONFIRMED, S.CANCELLED),
        (S.PREPARING, S.READY),
        (S.PREPARING, S.CANCELLED),
        (S.READY, S.COMPLETED),
        (S.PENDING, S.CANCELLED),
    ],
)
def test_an_allowed_step_moves_the_order(api_client, order, start, target):
    order.status = start
    order.save(update_fields=["status"])

    response = move(api_client, order, target)

    assert response.status_code == 200
    assert response.json()["status"] == target
    order.refresh_from_db()
    assert order.status == target


@pytest.mark.parametrize(
    ("start", "target", "allowed"),
    [
        (S.CONFIRMED, S.COMPLETED, ["preparing", "cancelled"]),
        (S.CONFIRMED, S.READY, ["preparing", "cancelled"]),
        (S.PENDING, S.CONFIRMED, ["cancelled"]),
        (S.READY, S.CANCELLED, ["completed"]),
        (S.COMPLETED, S.PREPARING, []),
        (S.CANCELLED, S.CONFIRMED, []),
        (S.PREPARING, S.PREPARING, ["ready", "cancelled"]),
    ],
)
def test_a_step_that_is_not_allowed_is_refused_and_changes_nothing(
    api_client, order, start, target, allowed
):
    order.status = start
    order.save(update_fields=["status"])

    response = move(api_client, order, target)

    assert response.status_code == 409
    assert response.json()["allowed"] == allowed
    assert "detail" in response.json()
    order.refresh_from_db()
    assert order.status == start


def test_two_moves_of_the_same_order_in_turn_give_200_then_409(api_client, order):
    order.status = S.CONFIRMED
    order.save(update_fields=["status"])

    first = move(api_client, order, S.PREPARING)
    second = move(api_client, order, S.PREPARING)

    assert (first.status_code, second.status_code) == (200, 409)
    assert second.json()["allowed"] == ["ready", "cancelled"]
    order.refresh_from_db()
    assert order.status == S.PREPARING


@pytest.mark.parametrize("body", [{}, {"status": "soon"}, {"status": ""}, {"status": None}])
def test_an_unknown_or_missing_status_is_400(api_client, order, body):
    order.status = S.CONFIRMED
    order.save(update_fields=["status"])

    response = api_client.post(reverse("order-transition", args=[order.pk]), body, format="json")

    assert response.status_code == 400
    assert "status" in response.json()
    order.refresh_from_db()
    assert order.status == S.CONFIRMED


def test_a_missing_order_is_404(api_client):
    response = api_client.post(
        reverse("order-transition", args=[9999]), {"status": "preparing"}, format="json"
    )

    assert response.status_code == 404


def test_only_post_is_allowed(api_client, order):
    url = reverse("order-transition", args=[order.pk])

    for method in (api_client.get, api_client.put, api_client.patch, api_client.delete):
        assert method(url).status_code == 405


def test_the_endpoint_needs_a_staff_login(order):
    order.status = S.CONFIRMED
    order.save(update_fields=["status"])

    response = move(APIClient(), order, S.PREPARING)

    assert response.status_code == 403
    order.refresh_from_db()
    assert order.status == S.CONFIRMED


def test_a_move_changes_only_the_status_and_does_not_call_paypal(
    api_client, paid_order, fake_paypal
):
    before = api_client.get(reverse("order-detail", args=[paid_order.pk])).json()

    response = move(api_client, paid_order, S.PREPARING)

    after = response.json()
    assert after["status"] == "preparing"
    assert {k: v for k, v in after.items() if k != "status"} == {
        k: v for k, v in before.items() if k != "status"
    }
    assert fake_paypal.created == [] and fake_paypal.captured == []


def test_cancelling_a_paid_order_keeps_it_paid(api_client, paid_order, fake_paypal):
    response = move(api_client, paid_order, S.CANCELLED)

    assert response.json()["status"] == "cancelled"
    assert response.json()["payment_status"] == "paid"
    assert fake_paypal.captured == []


def test_every_step_of_the_whole_workflow(api_client, restaurant, menu_item, fake_paypal):
    created = pay(api_client, cart(restaurant, menu_item)).json()
    assert created["status"] == "confirmed"
    order = Order.objects.get(pk=created["id"])

    statuses = [move(api_client, order, step).json()["status"] for step in ("preparing", "ready", "completed")]

    assert statuses == ["preparing", "ready", "completed"]
