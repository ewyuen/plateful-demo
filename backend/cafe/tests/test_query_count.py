from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from cafe.models import MenuItem, Order, OrderItem

# Every test in this file touches the database.
pytestmark = pytest.mark.django_db


@pytest.fixture
def api_client(admin_api):
    # Reading orders is for staff now (ADR-0014), so these tests read as an admin.
    return admin_api


@pytest.fixture
def dishes(restaurant):
    return [
        MenuItem.objects.create(
            restaurant=restaurant, name=f"Dish {i}", price=Decimal("3.00")
        )
        for i in range(5)
    ]


def add_orders(restaurant, dishes, orders, items_per_order):
    created = []
    for n in range(orders):
        order = Order.objects.create(restaurant=restaurant, customer_name=f"Customer {n}")
        OrderItem.objects.bulk_create(
            [
                OrderItem(order=order, menu_item=dish, quantity=1, unit_price=dish.price)
                for dish in dishes[:items_per_order]
            ]
        )
        created.append(order)
    return created


def count_queries(api_client, url):
    with CaptureQueriesContext(connection) as ctx:
        response = api_client.get(url)
    assert response.status_code == 200
    return len(ctx)


def test_list_query_count_does_not_grow_with_orders(api_client, restaurant, dishes):
    url = reverse("order-list")
    add_orders(restaurant, dishes, orders=1, items_per_order=3)
    with_one = count_queries(api_client, url)

    add_orders(restaurant, dishes, orders=9, items_per_order=3)
    with_ten = count_queries(api_client, url)

    assert with_ten == with_one


def test_list_query_count_does_not_grow_with_items(api_client, restaurant, dishes):
    url = reverse("order-list")
    add_orders(restaurant, dishes, orders=3, items_per_order=1)
    few_items = count_queries(api_client, url)

    Order.objects.all().delete()
    add_orders(restaurant, dishes, orders=3, items_per_order=5)
    many_items = count_queries(api_client, url)

    assert many_items == few_items


def test_retrieve_query_count_does_not_grow_with_items(api_client, restaurant, dishes):
    small, large = (
        add_orders(restaurant, dishes, orders=1, items_per_order=1)[0],
        add_orders(restaurant, dishes, orders=1, items_per_order=5)[0],
    )

    with_one_item = count_queries(api_client, reverse("order-detail", args=[small.pk]))
    with_five_items = count_queries(api_client, reverse("order-detail", args=[large.pk]))

    assert with_five_items == with_one_item


def test_list_uses_exactly_five_queries(
    api_client, restaurant, dishes, django_assert_num_queries
):
    # the staff role twice (the permission, then the restaurants the user may read), count,
    # orders joined with restaurants, items joined with menu items
    add_orders(restaurant, dishes, orders=5, items_per_order=3)

    with django_assert_num_queries(5):
        api_client.get(reverse("order-list"))


def test_menu_item_list_query_count_does_not_grow_with_items(api_client, restaurant):
    url = reverse("menuitem-list")
    MenuItem.objects.bulk_create(
        [MenuItem(restaurant=restaurant, name=f"A{i}", price=Decimal("1.00")) for i in range(2)]
    )
    with_two = count_queries(api_client, url)

    MenuItem.objects.bulk_create(
        [MenuItem(restaurant=restaurant, name=f"B{i}", price=Decimal("1.00")) for i in range(13)]
    )
    with_fifteen = count_queries(api_client, url)

    assert with_fifteen == with_two
