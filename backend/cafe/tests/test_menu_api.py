from decimal import Decimal

import pytest
from django.urls import reverse

from cafe.models import MenuItem, Restaurant

# Every test in this file touches the database.
pytestmark = pytest.mark.django_db


@pytest.fixture
def other_restaurant():
    return Restaurant.objects.create(name="Another Cafe", address="2 Side St")


def names(response):
    return [row["name"] for row in response.json()["results"]]


# Restaurants


def test_restaurant_list_shape_and_ordering(api_client, restaurant, other_restaurant):
    response = api_client.get(reverse("restaurant-list"))

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"count", "next", "previous", "results"}
    assert body["count"] == 2
    assert names(response) == ["Another Cafe", "Corner Kitchen"]
    assert body["results"][1] == {
        "id": restaurant.pk,
        "name": "Corner Kitchen",
        "address": "1 Main St",
        "cuisine": "",
        "description": "",
        "image_url": "",
        "offers_delivery": False,
        "delivery_fee": "0.00",
    }


def test_restaurant_list_is_paginated(api_client):
    Restaurant.objects.bulk_create(
        [Restaurant(name=f"Cafe {i:02}", address="x") for i in range(21)]
    )

    body = api_client.get(reverse("restaurant-list")).json()

    assert body["count"] == 21
    assert len(body["results"]) == 20
    assert body["next"] is not None


def test_restaurant_retrieve(api_client, restaurant):
    response = api_client.get(reverse("restaurant-detail", args=[restaurant.pk]))

    assert response.status_code == 200
    assert response.json()["name"] == "Corner Kitchen"


def test_restaurant_retrieve_missing_returns_404(api_client):
    assert api_client.get(reverse("restaurant-detail", args=[9999])).status_code == 404


# Menu items


def test_menu_item_fields_and_decimal_string_price(api_client, restaurant, menu_item):
    response = api_client.get(reverse("menuitem-detail", args=[menu_item.pk]))

    assert response.status_code == 200
    assert response.json() == {
        "id": menu_item.pk,
        "restaurant": restaurant.pk,
        "restaurant_name": "Corner Kitchen",
        "name": "Noodles",
        "description": "",
        "price": "9.99",
        "is_available": True,
    }


def test_menu_item_list_is_ordered_by_name(api_client, restaurant):
    for name in ["Tea", "Dumplings", "Noodles"]:
        MenuItem.objects.create(restaurant=restaurant, name=name, price=Decimal("1.00"))

    assert names(api_client.get(reverse("menuitem-list"))) == ["Dumplings", "Noodles", "Tea"]


def test_unavailable_menu_item_is_listed(api_client, restaurant, menu_item):
    MenuItem.objects.create(
        restaurant=restaurant, name="Sold Out", price=Decimal("2.00"), is_available=False
    )

    results = api_client.get(reverse("menuitem-list")).json()["results"]

    sold_out = next(row for row in results if row["name"] == "Sold Out")
    assert sold_out["is_available"] is False
    assert len(results) == 2


def test_menu_item_retrieve_missing_returns_404(api_client):
    assert api_client.get(reverse("menuitem-detail", args=[9999])).status_code == 404


# Filter by restaurant


def test_filter_returns_only_that_restaurants_items(
    api_client, restaurant, menu_item, other_restaurant
):
    MenuItem.objects.create(restaurant=other_restaurant, name="Soup", price=Decimal("4.00"))

    response = api_client.get(reverse("menuitem-list"), {"restaurant": restaurant.pk})

    assert response.status_code == 200
    assert names(response) == ["Noodles"]


def test_filter_for_restaurant_without_items_is_empty(api_client, other_restaurant, menu_item):
    response = api_client.get(reverse("menuitem-list"), {"restaurant": other_restaurant.pk})

    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 0
    assert body["results"] == []


def test_filter_for_unknown_restaurant_is_empty(api_client, menu_item):
    body = api_client.get(reverse("menuitem-list"), {"restaurant": 9999}).json()

    assert body["count"] == 0


@pytest.mark.parametrize("value", ["abc", "1.5", ""])
def test_filter_with_non_numeric_value_is_400(api_client, menu_item, value):
    response = api_client.get(reverse("menuitem-list"), {"restaurant": value})

    assert response.status_code == 400
    assert "restaurant" in response.json()


# Read-only and public


@pytest.mark.parametrize("route", ["restaurant", "menuitem"])
@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
def test_writes_are_refused(api_client, restaurant, menu_item, route, method):
    target = restaurant if route == "restaurant" else menu_item
    url = reverse(f"{route}-detail", args=[target.pk])
    if method == "post":
        url = reverse(f"{route}-list")

    response = getattr(api_client, method)(url, {"name": "x"}, format="json")

    assert response.status_code == 405
    assert type(target).objects.filter(pk=target.pk).exists()


def test_reads_are_public(api_client, restaurant, menu_item):
    assert api_client.get(reverse("restaurant-list")).status_code == 200
    assert api_client.get(reverse("menuitem-list")).status_code == 200


@pytest.mark.parametrize("value", ["0", "-5", "99999999999999999999999999"])
def test_filter_with_out_of_range_id_is_empty_not_an_error(api_client, menu_item, value):
    response = api_client.get(reverse("menuitem-list"), {"restaurant": value})

    assert response.status_code == 200
    assert response.json()["count"] == 0
