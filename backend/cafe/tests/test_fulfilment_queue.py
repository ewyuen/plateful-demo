from decimal import Decimal

import pytest
from rest_framework.test import APIClient
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from cafe.models import MenuItem, Order, OrderItem, Restaurant

# Every test in this file touches the database.
pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client(admin_api):
    # These tests are about orders and the workflow, not about who may see them (see
    # test_staff_access.py), so they act as an admin.
    return admin_api

S = Order.Status


@pytest.fixture
def noodle_bar():
    return Restaurant.objects.create(name="Noodle Bar", address="2 Side St")


def make_order(restaurant, status, customer="Sam", dishes=1):
    order = Order.objects.create(restaurant=restaurant, customer_name=customer, status=status)
    for n in range(dishes):
        item = MenuItem.objects.create(
            restaurant=restaurant, name=f"Dish {order.pk}-{n}", price=Decimal("5.00")
        )
        OrderItem.objects.create(order=order, menu_item=item, quantity=2, unit_price=item.price)
    return order


def ids(response):
    return [row["id"] for row in response.json()["results"]]


def queue(api_client, **params):
    return api_client.get(reverse("fulfilment-orders"), params)


def test_the_queue_lists_orders_of_every_restaurant_newest_first(api_client, restaurant, noodle_bar):
    first = make_order(restaurant, S.CONFIRMED)
    second = make_order(noodle_bar, S.PREPARING)
    third = make_order(restaurant, S.READY)

    response = queue(api_client)

    assert response.status_code == 200
    assert ids(response) == [third.pk, second.pk, first.pk]
    assert set(response.json()) == {"count", "next", "previous", "results"}


def test_an_order_shows_what_the_orders_list_shows(api_client, restaurant):
    order = make_order(restaurant, S.CONFIRMED, customer="Sam")

    row = queue(api_client).json()["results"][0]

    assert row["id"] == order.pk
    assert row["restaurant_name"] == "Corner Kitchen"
    assert row["customer_name"] == "Sam"
    assert row["status"] == "confirmed"
    assert row["total"] == "10.00"
    assert row["items"][0]["quantity"] == 2
    assert {"payment_status", "created_at", "items", "total"} <= set(row)


def test_pending_orders_are_not_in_the_queue(api_client, restaurant):
    make_order(restaurant, S.PENDING)
    confirmed = make_order(restaurant, S.CONFIRMED)

    assert ids(queue(api_client)) == [confirmed.pk]
    assert ids(queue(api_client, status="confirmed,completed,cancelled")) == [confirmed.pk]


def test_by_default_only_active_orders_are_shown(api_client, restaurant):
    active = [make_order(restaurant, s) for s in (S.CONFIRMED, S.PREPARING, S.READY)]
    make_order(restaurant, S.COMPLETED)
    make_order(restaurant, S.CANCELLED)

    assert sorted(ids(queue(api_client))) == sorted(order.pk for order in active)


def test_a_blank_status_means_the_default(api_client, restaurant):
    confirmed = make_order(restaurant, S.CONFIRMED)
    make_order(restaurant, S.COMPLETED)

    assert ids(queue(api_client, status="")) == [confirmed.pk]


def test_chosen_statuses_replace_the_default(api_client, restaurant):
    make_order(restaurant, S.CONFIRMED)
    done = make_order(restaurant, S.COMPLETED)
    cancelled = make_order(restaurant, S.CANCELLED)

    response = queue(api_client, status="completed,cancelled")

    assert sorted(ids(response)) == sorted([done.pk, cancelled.pk])


def test_a_single_status_can_be_chosen(api_client, restaurant):
    make_order(restaurant, S.CONFIRMED)
    ready = make_order(restaurant, S.READY)

    assert ids(queue(api_client, status="ready")) == [ready.pk]


@pytest.mark.parametrize("bad", ["pending", "soon", "confirmed,pending", "confirmed,,ready"])
def test_a_status_outside_the_queue_is_refused(api_client, restaurant, bad):
    response = queue(api_client, status=bad)

    assert response.status_code == 400
    assert "status" in response.json()


def test_one_restaurant_can_be_chosen(api_client, restaurant, noodle_bar):
    make_order(restaurant, S.CONFIRMED)
    theirs = make_order(noodle_bar, S.CONFIRMED)

    assert ids(queue(api_client, restaurant=noodle_bar.pk)) == [theirs.pk]


def test_a_restaurant_without_orders_gives_an_empty_list(api_client, restaurant, noodle_bar):
    make_order(restaurant, S.CONFIRMED)

    body = queue(api_client, restaurant=noodle_bar.pk).json()

    assert body["count"] == 0 and body["results"] == []


@pytest.mark.parametrize("bad", ["abc", "1.5", ""])
def test_a_restaurant_that_is_not_an_id_is_refused(api_client, restaurant, bad):
    assert queue(api_client, restaurant=bad).status_code == 400


def test_a_huge_restaurant_id_is_an_empty_list(api_client, restaurant):
    make_order(restaurant, S.CONFIRMED)

    assert queue(api_client, restaurant=str(2**70)).json()["results"] == []


def test_status_and_restaurant_combine(api_client, restaurant, noodle_bar):
    make_order(restaurant, S.CONFIRMED)
    make_order(noodle_bar, S.READY)
    wanted = make_order(noodle_bar, S.CONFIRMED)

    assert ids(queue(api_client, status="confirmed", restaurant=noodle_bar.pk)) == [wanted.pk]


def test_the_queue_is_paginated_like_other_lists(api_client, restaurant):
    for _ in range(21):
        make_order(restaurant, S.CONFIRMED)

    body = queue(api_client).json()

    assert body["count"] == 21 and len(body["results"]) == 20 and body["next"] is not None


def test_the_queue_refuses_writes(api_client, restaurant):
    url = reverse("fulfilment-orders")

    for method in (api_client.post, api_client.put, api_client.patch, api_client.delete):
        assert method(url).status_code == 405


def test_the_queue_is_for_signed_in_staff(restaurant):
    make_order(restaurant, S.CONFIRMED)

    assert queue(APIClient()).status_code == 403


def count_queries(api_client):
    with CaptureQueriesContext(connection) as ctx:
        response = queue(api_client)
    assert response.status_code == 200
    return len(ctx)


def test_the_queue_query_count_does_not_grow_with_orders_or_items(api_client, restaurant, noodle_bar):
    for n in range(2):
        make_order(restaurant, S.CONFIRMED, dishes=1)
    with_two = count_queries(api_client)

    for n in range(13):
        make_order(noodle_bar, S.PREPARING, dishes=3)

    assert count_queries(api_client) == with_two
