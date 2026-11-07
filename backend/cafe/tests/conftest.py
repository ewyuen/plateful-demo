from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from rest_framework.test import APIClient

from cafe.models import MenuItem, Order, Restaurant


@pytest.fixture
def api_client():
    return APIClient()


PASSWORD = "a-good-password-1"


@pytest.fixture
def make_user():
    """Makes a user: `role` is 'fulfilment', 'admin' or None, `restaurants` the ones they staff."""

    def make(username="sam", role=None, restaurants=(), password=PASSWORD, **extra):
        user = get_user_model().objects.create_user(username, password=password, **extra)
        if role is not None:
            user.groups.add(Group.objects.get(name=role))
        for restaurant in restaurants:
            restaurant.staff.add(user)
        return user

    return make


@pytest.fixture
def admin_api(make_user):
    """A client signed in as an admin, for tests that are about orders and not about login."""
    client = APIClient()
    client.force_authenticate(make_user("an-admin", "admin"))
    return client


@pytest.fixture
def owner_api(make_user):
    """A client signed in as an owner: the one role that may read the orders dashboard (ADR-0020)."""
    client = APIClient()
    client.force_authenticate(make_user("an-owner", "owner"))
    return client


@pytest.fixture
def restaurant():
    return Restaurant.objects.create(name="Corner Kitchen", address="1 Main St")


@pytest.fixture
def menu_item(restaurant):
    return MenuItem.objects.create(
        restaurant=restaurant, name="Noodles", price=Decimal("9.99")
    )


@pytest.fixture
def order(restaurant):
    return Order.objects.create(restaurant=restaurant, customer_name="Sam")


@pytest.fixture
def fake_paypal(monkeypatch):
    """Replace the PayPal client views use, so no test reaches the network.

    Views must call `paypal.get_client()` (the module attribute) for this to work.
    """
    from cafe import paypal
    from cafe.tests.fakes import FakePayPal

    fake = FakePayPal()
    monkeypatch.setattr(paypal, "get_client", lambda: fake)
    return fake


@pytest.fixture
def fake_assistant(monkeypatch):
    """Replace the assistant client views use, so no test reaches the Claude API.

    Views must call `assistant.get_client()` (the module attribute) for this to work.
    """
    from cafe import assistant
    from cafe.tests.fakes import FakeAssistant

    fake = FakeAssistant()
    monkeypatch.setattr(assistant, "get_client", lambda: fake)
    return fake


@pytest.fixture(autouse=True)
def fast_password_hashing(settings):
    """Real hashers are slow on purpose; tests make many users and need not be."""
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]


@pytest.fixture(autouse=True)
def clear_throttle_counts():
    """Rate-limit counts live in the cache, which outlives a test: start each one empty."""
    from django.core.cache import cache

    cache.clear()
    yield
    cache.clear()
