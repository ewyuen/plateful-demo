import pytest
from django.conf import settings
from django.urls import reverse

# Every test in this file touches the database (the list view reads it).
pytestmark = pytest.mark.django_db

ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

# Not in the allowlist: a stranger, the `npm run preview` port, the right host
# on the wrong scheme, and a host that merely starts with an allowed one.
DENIED_ORIGINS = [
    "http://evil.example",
    "http://localhost:4173",
    "https://localhost:5173",
    "http://localhost:5173.evil.example",
]


def preflight(api_client, origin):
    """What a browser sends before a JSON POST from another origin."""
    return api_client.options(
        reverse("order-list"),
        HTTP_ORIGIN=origin,
        HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
        HTTP_ACCESS_CONTROL_REQUEST_HEADERS="content-type",
    )


def allowed_values(response, header):
    """The comma-separated values of a header, lower-cased, or [] if it is absent."""
    value = response.headers.get(header, "")
    return [part.strip().lower() for part in value.split(",") if part.strip()]


# Settings


def test_allow_all_origins_is_off():
    assert getattr(settings, "CORS_ALLOW_ALL_ORIGINS", False) is False


def test_allowlist_has_no_wildcard():
    assert "*" not in settings.CORS_ALLOWED_ORIGINS
    assert "null" not in settings.CORS_ALLOWED_ORIGINS


# Normal requests


@pytest.mark.parametrize("origin", ALLOWED_ORIGINS)
def test_allowed_origin_gets_its_own_origin_back(api_client, origin):
    response = api_client.get(reverse("restaurant-list"), HTTP_ORIGIN=origin)

    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == origin


def test_response_varies_by_origin(api_client):
    response = api_client.get(
        reverse("restaurant-list"), HTTP_ORIGIN=ALLOWED_ORIGINS[0]
    )

    assert "origin" in allowed_values(response, "Vary")


@pytest.mark.parametrize("origin", DENIED_ORIGINS)
def test_unlisted_origin_gets_no_allow_header(api_client, origin):
    response = api_client.get(reverse("restaurant-list"), HTTP_ORIGIN=origin)

    # The server still answers: CORS is enforced by the browser, not here.
    assert response.status_code == 200
    assert "Access-Control-Allow-Origin" not in response.headers


def test_request_without_origin_gets_no_allow_header(api_client):
    response = api_client.get(reverse("restaurant-list"))

    assert response.status_code == 200
    assert "Access-Control-Allow-Origin" not in response.headers


# Preflight requests


@pytest.mark.parametrize("origin", ALLOWED_ORIGINS)
def test_preflight_from_allowed_origin_allows_post_with_json(api_client, origin):
    response = preflight(api_client, origin)

    assert response.headers["Access-Control-Allow-Origin"] == origin
    assert "post" in allowed_values(response, "Access-Control-Allow-Methods")
    assert "content-type" in allowed_values(response, "Access-Control-Allow-Headers")
    assert "origin" in allowed_values(response, "Vary")


@pytest.mark.parametrize("origin", DENIED_ORIGINS)
def test_preflight_from_unlisted_origin_gets_no_allow_headers(api_client, origin):
    response = preflight(api_client, origin)

    # Status 200 does not mean allowed: the browser looks at these headers.
    assert "Access-Control-Allow-Origin" not in response.headers
    assert "Access-Control-Allow-Methods" not in response.headers
    assert "Access-Control-Allow-Headers" not in response.headers
