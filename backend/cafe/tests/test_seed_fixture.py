from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.urls import reverse

from cafe.models import MenuCategory, MenuItem, Order, Restaurant

# Every test loads the fixture, so every test touches the database.
pytestmark = pytest.mark.django_db


@pytest.fixture
def seeded():
    call_command("loaddata", "seed")


def test_seed_loads_catalogue_data_only(seeded):
    assert Restaurant.objects.count() == 7
    assert MenuCategory.objects.count() == 18
    assert MenuItem.objects.count() == 44
    assert Order.objects.count() == 0
    assert get_user_model().objects.count() == 0


def test_loading_the_seed_twice_keeps_the_same_rows(seeded):
    call_command("loaddata", "seed")

    assert Restaurant.objects.count() == 7
    assert MenuCategory.objects.count() == 18
    assert MenuItem.objects.count() == 44


def test_seed_has_an_unavailable_item(seeded):
    unavailable = MenuItem.objects.filter(is_available=False)

    assert [item.name for item in unavailable] == ["Seasonal Soup"]


def test_seed_has_a_restaurant_without_a_menu(seeded):
    empty = Restaurant.objects.filter(menu_items__isnull=True)

    assert empty.count() == 1
    assert empty.get().address == "1896 Wayne Circle"


def test_seed_has_an_available_item_without_a_category(seeded):
    loose = MenuItem.objects.filter(category__isnull=True)

    assert [item.name for item in loose] == ["Chef's Special"]
    assert loose.get().is_available


def test_seed_restaurants_have_no_image_links(seeded):
    assert not Restaurant.objects.exclude(image_url="").exists()


def test_seed_restaurant_names_are_unique(seeded):
    names = list(Restaurant.objects.values_list("name", flat=True))

    assert len(names) == len(set(names))


def test_every_seeded_category_belongs_to_its_items_restaurant(seeded):
    items = MenuItem.objects.exclude(category__isnull=True).select_related("category")

    assert [item for item in items if item.category.restaurant_id != item.restaurant_id] == []
    for item in items:
        item.full_clean()


def test_seeded_cuisines_are_listed(api_client, seeded):
    cuisines = api_client.get(reverse("restaurant-cuisines")).json()

    assert len(cuisines) >= 2
    assert {"Chinese", "Noodles", "Cantonese", "Dim sum", "Sichuan", "Café"} <= set(cuisines)


def test_seeded_search_finds_a_restaurant_by_cuisine(api_client, seeded):
    response = api_client.get(reverse("restaurant-list"), {"search": "sichuan"})

    assert [row["name"] for row in response.json()["results"]] == ["Spice Lane"]


def test_a_seeded_restaurant_menu_has_several_groups(api_client, seeded):
    plateful = Restaurant.objects.get(name="Corner Kitchen")

    groups = api_client.get(reverse("restaurant-menu", args=[plateful.pk])).json()["groups"]

    assert [group["name"] for group in groups] == [
        "Appetizers",
        "Soups",
        "Main course",
        "Drinks",
        "Other",
    ]
    assert all(group["items"] for group in groups)


def test_the_seeded_restaurant_without_a_menu_has_no_groups(api_client, seeded):
    empty = Restaurant.objects.get(name="Corner Kitchen East")

    assert api_client.get(reverse("restaurant-menu", args=[empty.pk])).json()["groups"] == []


def test_loading_over_the_earlier_seed_updates_rows_in_place():
    # What the first version of the fixture created, with the same ids.
    for pk, name, address in [
        (1, "Corner Kitchen", "1 Main St"),
        (2, "Corner Kitchen", "1896 Wayne Circle"),
        (3, "Noodle Bar", "2 Side St."),
    ]:
        Restaurant.objects.create(pk=pk, name=name, address=address)
    for pk, restaurant, name, price, available in [
        (1, 1, "Noodles", "9.99", True),
        (2, 1, "Coffee", "5.00", True),
        (4, 3, "Ramen", "12.50", True),
        (5, 3, "Dumplings", "6.00", True),
        (6, 3, "Seasonal Soup", "8.00", False),
    ]:
        MenuItem.objects.create(
            pk=pk, restaurant_id=restaurant, name=name, price=Decimal(price), is_available=available
        )

    call_command("loaddata", "seed")

    assert Restaurant.objects.count() == 7
    assert MenuItem.objects.count() == 44
    assert Restaurant.objects.get(pk=1).cuisine == "Chinese"
    assert Restaurant.objects.get(pk=2).name == "Corner Kitchen East"
    assert MenuItem.objects.get(pk=1).category.name == "Main course"
    assert MenuItem.objects.filter(name="Noodles").count() == 1


def test_some_seeded_restaurants_deliver_and_some_are_pickup_only(seeded):
    delivering = Restaurant.objects.filter(offers_delivery=True)
    pickup_only = Restaurant.objects.filter(offers_delivery=False)

    assert sorted(r.name for r in delivering) == ["Corner Kitchen", "Golden Wok", "Jade Garden", "Spice Lane"]
    assert all(r.delivery_fee > 0 for r in delivering)
    assert sorted(r.name for r in pickup_only) == ["Corner Kitchen East", "Noodle Bar", "Tea House"]
    assert all(r.delivery_fee == 0 for r in pickup_only)


def test_the_delivery_filter_lists_the_seeded_delivering_restaurants(api_client, seeded):
    response = api_client.get(reverse("restaurant-list"), {"offers_delivery": "true"})

    assert response.json()["count"] == 4
