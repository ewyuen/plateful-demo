import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from cafe.models import Restaurant

# Every test in this file touches the database.
pytestmark = pytest.mark.django_db


@pytest.fixture
def network():
    rows = [
        ("Corner Kitchen", "Chinese"),
        ("Corner Kitchen East", "Chinese"),
        ("Golden Wok", "Noodles"),
        ("Noodle Bar", "Noodles"),
        ("Tea House", "Café"),
        ("Plain Place", ""),
    ]
    return [
        Restaurant.objects.create(name=name, address="x", cuisine=cuisine)
        for name, cuisine in rows
    ]


def names(response):
    return [row["name"] for row in response.json()["results"]]


def list_restaurants(api_client, **params):
    return api_client.get(reverse("restaurant-list"), params)


# Profile fields


def test_profile_fields_are_shown_in_list_and_detail(api_client):
    restaurant = Restaurant.objects.create(
        name="Golden Wok",
        address="48 Harbour Road",
        cuisine="Cantonese",
        description="Wok classics",
        image_url="https://example.com/wok.jpg",
    )
    expected = {
        "cuisine": "Cantonese",
        "description": "Wok classics",
        "image_url": "https://example.com/wok.jpg",
    }

    listed = list_restaurants(api_client).json()["results"][0]
    detail = api_client.get(reverse("restaurant-detail", args=[restaurant.pk])).json()

    assert {key: listed[key] for key in expected} == expected
    assert {key: detail[key] for key in expected} == expected


def test_a_restaurant_without_profile_details_shows_empty_strings(api_client, restaurant):
    detail = api_client.get(reverse("restaurant-detail", args=[restaurant.pk])).json()

    assert (detail["cuisine"], detail["description"], detail["image_url"]) == ("", "", "")


# Search


def test_search_matches_the_name(api_client, network):
    assert names(list_restaurants(api_client, search="corner")) == [
        "Corner Kitchen",
        "Corner Kitchen East",
    ]


def test_search_matches_the_cuisine(api_client, network):
    assert names(list_restaurants(api_client, search="noodle")) == ["Golden Wok", "Noodle Bar"]


def test_search_ignores_letter_case(api_client, network):
    upper = names(list_restaurants(api_client, search="CORNER"))
    lower = names(list_restaurants(api_client, search="corner"))

    assert upper == lower != []


def test_blank_search_returns_everything(api_client, network):
    assert len(names(list_restaurants(api_client, search=""))) == len(network)


def test_search_with_no_match_is_an_empty_list(api_client, network):
    body = list_restaurants(api_client, search="zzz").json()

    assert body["count"] == 0
    assert body["results"] == []


# Cuisine filter


def test_cuisine_filter_returns_one_cuisine(api_client, network):
    assert names(list_restaurants(api_client, cuisine="Noodles")) == ["Golden Wok", "Noodle Bar"]


def test_cuisine_filter_ignores_letter_case(api_client, network):
    assert names(list_restaurants(api_client, cuisine="noodles")) == ["Golden Wok", "Noodle Bar"]


def test_cuisine_filter_needs_the_whole_value(api_client, network):
    assert names(list_restaurants(api_client, cuisine="Noodle")) == []


def test_search_and_cuisine_must_both_match(api_client, network):
    assert names(list_restaurants(api_client, search="corner", cuisine="Chinese")) == [
        "Corner Kitchen",
        "Corner Kitchen East",
    ]
    assert names(list_restaurants(api_client, search="corner", cuisine="Noodles")) == []


def test_filtered_count_reflects_the_filter(api_client, network):
    assert list_restaurants(api_client, cuisine="Chinese").json()["count"] == 2


def test_filters_do_not_hide_a_restaurant_fetched_by_id(api_client, network):
    detail = reverse("restaurant-detail", args=[network[0].pk])

    response = api_client.get(detail, {"cuisine": "Noodles", "search": "zzz"})

    assert response.status_code == 200
    assert response.json()["name"] == "Corner Kitchen"


# Cuisine list


def test_cuisines_are_distinct_sorted_and_not_blank(api_client, network):
    response = api_client.get(reverse("restaurant-cuisines"))

    assert response.status_code == 200
    assert response.json() == ["Café", "Chinese", "Noodles"]


def test_cuisines_are_a_plain_list_not_a_page(api_client, network):
    assert isinstance(api_client.get(reverse("restaurant-cuisines")).json(), list)


def test_cuisines_refuses_writes(api_client, network):
    url = reverse("restaurant-cuisines")

    for method in (api_client.post, api_client.put, api_client.patch, api_client.delete):
        assert method(url).status_code == 405


def test_cuisines_is_not_read_as_a_restaurant_id(api_client, network):
    assert reverse("restaurant-cuisines") == "/api/restaurants/cuisines/"
    assert api_client.get("/api/restaurants/cuisines/").json() == ["Café", "Chinese", "Noodles"]


def test_discovery_reads_need_no_login(api_client, network):
    assert list_restaurants(api_client, search="corner").status_code == 200
    assert api_client.get(reverse("restaurant-cuisines")).status_code == 200


# Query counts


def count_queries(api_client, **params):
    with CaptureQueriesContext(connection) as ctx:
        response = list_restaurants(api_client, **params)
    assert response.status_code == 200
    return len(ctx)


@pytest.mark.parametrize("params", [{}, {"search": "cafe"}, {"cuisine": "Chinese"}])
def test_list_query_count_does_not_grow_with_restaurants(api_client, params):
    Restaurant.objects.bulk_create(
        [Restaurant(name=f"Cafe {i}", address="x", cuisine="Chinese") for i in range(2)]
    )
    with_two = count_queries(api_client, **params)

    Restaurant.objects.bulk_create(
        [Restaurant(name=f"Cafe {i + 2}", address="x", cuisine="Chinese") for i in range(13)]
    )

    assert count_queries(api_client, **params) == with_two
