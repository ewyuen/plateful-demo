from unittest.mock import patch

import pytest
from django.db import OperationalError
from django.db.backends.base.base import BaseDatabaseWrapper

LIVE = "/api/health/live/"
READY = "/api/health/ready/"


def database_down():
    """Make every attempt to connect to the database fail, as it does in an outage."""
    return patch.object(
        BaseDatabaseWrapper,
        "ensure_connection",
        side_effect=OperationalError("connection refused"),
    )


# No django_db mark on the live tests: pytest-django raises if the view touches
# the database, so "liveness does not use the database" is a failing test, not a comment.
def test_live_returns_ok(api_client):
    response = api_client.get(LIVE)

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_live_is_ok_even_when_the_database_is_down(api_client):
    with database_down():
        response = api_client.get(LIVE)

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.django_db
def test_ready_returns_ok_when_the_database_works(api_client):
    response = api_client.get(READY)

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.django_db
def test_ready_returns_503_when_the_database_fails(api_client):
    with database_down():
        response = api_client.get(READY)

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}


@pytest.mark.parametrize("url", [LIVE, READY])
def test_health_endpoints_only_accept_get(api_client, url):
    response = api_client.post(url, {}, format="json")

    assert response.status_code == 405
