from decimal import Decimal

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from cafe.models import MenuCategory, MenuItem, Restaurant

# Every test in this file touches the database.
pytestmark = pytest.mark.django_db


def make_item(restaurant, name, category=None, price="5.00", **extra):
    return MenuItem.objects.create(
        restaurant=restaurant, name=name, category=category, price=Decimal(price), **extra
    )


def read_menu(api_client, restaurant):
    return api_client.get(reverse("restaurant-menu", args=[restaurant.pk]))


def group_names(response):
    return [group["name"] for group in response.json()["groups"]]


@pytest.fixture
def appetizers(restaurant):
    return MenuCategory.objects.create(restaurant=restaurant, name="Appetizers", position=1)


@pytest.fixture
def mains(restaurant):
    return MenuCategory.objects.create(restaurant=restaurant, name="Main course", position=2)


def test_menu_is_grouped_in_position_order(api_client, restaurant, appetizers, mains):
    make_item(restaurant, "Beef Noodles", mains)
    make_item(restaurant, "Spring Rolls", appetizers)

    response = read_menu(api_client, restaurant)

    assert response.status_code == 200
    assert group_names(response) == ["Appetizers", "Main course"]


def test_each_group_holds_only_its_own_items_ordered_by_name(
    api_client, restaurant, appetizers, mains
):
    make_item(restaurant, "Pot Stickers", appetizers)
    make_item(restaurant, "Beef Noodles", mains)
    make_item(restaurant, "Crispy Wontons", appetizers)

    groups = read_menu(api_client, restaurant).json()["groups"]

    assert [item["name"] for item in groups[0]["items"]] == ["Crispy Wontons", "Pot Stickers"]
    assert [item["name"] for item in groups[1]["items"]] == ["Beef Noodles"]


def test_menu_shows_the_restaurant_and_the_group_fields(api_client, restaurant, appetizers):
    item = make_item(restaurant, "Spring Rolls", appetizers, price="6.5", description="Crisp")

    body = read_menu(api_client, restaurant).json()

    assert body["restaurant"]["name"] == "Corner Kitchen"
    assert body["restaurant"]["cuisine"] == ""
    assert body["groups"] == [
        {
            "id": appetizers.pk,
            "name": "Appetizers",
            "position": 1,
            "items": [{"id": item.pk, "name": "Spring Rolls", "description": "Crisp", "price": "6.50"}],
        }
    ]


def test_unavailable_items_are_hidden(api_client, restaurant, appetizers):
    make_item(restaurant, "Spring Rolls", appetizers)
    make_item(restaurant, "Sold Out", appetizers, is_available=False)

    items = read_menu(api_client, restaurant).json()["groups"][0]["items"]

    assert [item["name"] for item in items] == ["Spring Rolls"]


def test_a_category_with_only_unavailable_items_is_hidden(
    api_client, restaurant, appetizers, mains
):
    make_item(restaurant, "Spring Rolls", appetizers)
    make_item(restaurant, "Sold Out", mains, is_available=False)

    assert group_names(read_menu(api_client, restaurant)) == ["Appetizers"]


def test_uncategorised_items_are_last_in_other(api_client, restaurant, appetizers):
    make_item(restaurant, "Spring Rolls", appetizers)
    special = make_item(restaurant, "Chef's Special")

    groups = read_menu(api_client, restaurant).json()["groups"]

    assert groups[-1]["name"] == "Other"
    assert groups[-1]["id"] is None
    assert [item["id"] for item in groups[-1]["items"]] == [special.pk]


def test_uncategorised_unavailable_items_do_not_make_an_other_group(api_client, restaurant):
    make_item(restaurant, "Sold Out", is_available=False)

    assert read_menu(api_client, restaurant).json()["groups"] == []


def test_a_restaurant_without_a_menu_gives_an_empty_list(api_client, restaurant):
    response = read_menu(api_client, restaurant)

    assert response.status_code == 200
    assert response.json()["groups"] == []


def test_items_of_other_restaurants_are_not_included(api_client, restaurant, appetizers):
    other = Restaurant.objects.create(name="Noodle Bar", address="2 Side St")
    make_item(other, "Ramen")
    make_item(restaurant, "Spring Rolls", appetizers)

    groups = read_menu(api_client, restaurant).json()["groups"]

    assert [item["name"] for group in groups for item in group["items"]] == ["Spring Rolls"]


def test_missing_restaurant_is_404(api_client):
    assert api_client.get(reverse("restaurant-menu", args=[9999])).status_code == 404


def test_menu_refuses_writes(api_client, restaurant):
    url = reverse("restaurant-menu", args=[restaurant.pk])

    for method in (api_client.post, api_client.put, api_client.patch, api_client.delete):
        assert method(url).status_code == 405


def test_menu_needs_no_login(api_client, restaurant):
    assert read_menu(api_client, restaurant).status_code == 200


def count_menu_queries(api_client, restaurant):
    with CaptureQueriesContext(connection) as ctx:
        response = read_menu(api_client, restaurant)
    assert response.status_code == 200
    return len(ctx)


def build_menu(restaurant, categories, items_per_category):
    for c in range(categories):
        category = MenuCategory.objects.create(restaurant=restaurant, name=f"Category {c}")
        for i in range(items_per_category):
            make_item(restaurant, f"Dish {c}-{i}", category)
    make_item(restaurant, "Chef's Special")


def test_menu_query_count_does_not_grow_with_categories_or_items(api_client, restaurant):
    small = Restaurant.objects.create(name="Small", address="x")
    build_menu(small, categories=2, items_per_category=2)
    build_menu(restaurant, categories=6, items_per_category=5)

    assert count_menu_queries(api_client, small) == count_menu_queries(api_client, restaurant)


def test_flat_menu_item_list_still_shows_unavailable_items(api_client, restaurant, appetizers):
    make_item(restaurant, "Spring Rolls", appetizers)
    make_item(restaurant, "Sold Out", appetizers, is_available=False)

    results = api_client.get(reverse("menuitem-list"), {"restaurant": restaurant.pk}).json()[
        "results"
    ]

    assert sorted(row["name"] for row in results) == ["Sold Out", "Spring Rolls"]
    assert set(results[0]) == {
        "id", "restaurant", "restaurant_name", "name", "description", "price", "is_available",
    }
