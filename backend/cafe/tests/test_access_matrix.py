"""Every API endpoint against every kind of caller (ADR-0014).

One table says who gets what. A new endpoint that is not in the table fails the last test,
so nobody can add a route without deciding who may use it.
"""

import json
import subprocess
import sys

import pytest
from django.urls import get_resolver, reverse
from rest_framework.test import APIClient

from cafe.models import MenuItem, Order, OrderItem, Restaurant
from cafe.roles import ADMIN, CUSTOMER, FULFILMENT, OWNER

# Every test in this file touches the database.
pytestmark = pytest.mark.django_db

CALLERS = ["anonymous", "no_role", "customer", "cook_here", "cook_elsewhere", "admin", "owner"]


@pytest.fixture
def world(make_user, restaurant, menu_item):
    other = Restaurant.objects.create(name="Noodle Bar", address="2 Side St")
    order = Order.objects.create(
        restaurant=restaurant, customer_name="Sam", status=Order.Status.CONFIRMED,
        payment_status=Order.PaymentStatus.PAID,
    )
    OrderItem.objects.create(order=order, menu_item=menu_item, quantity=1, unit_price="9.99")
    return {
        "restaurant": restaurant, "menu_item": menu_item, "order": order, "code": order.public_code,
        "users": {
            "no_role": make_user("plain"),
            "customer": make_user("shopper", CUSTOMER),
            "cook_here": make_user("cook-here", FULFILMENT, restaurants=[restaurant]),
            "cook_elsewhere": make_user("cook-there", FULFILMENT, restaurants=[other]),
            "admin": make_user("boss", ADMIN, is_staff=True),
            "owner": make_user("the-owner", OWNER),
        },
    }


def client_for(world, caller):
    client = APIClient()
    if caller != "anonymous":
        client.force_authenticate(world["users"][caller])
    return client


ALL = dict.fromkeys(CALLERS, 200)
STAFF_ONLY = {"anonymous": 403, "no_role": 403, "customer": 403, "cook_here": 200, "cook_elsewhere": 200, "admin": 200}

# name, method, how to build the request from the world, and the status each caller gets
ENDPOINTS = [
    ("health-live", "get", lambda w: ("health-live", [], None), ALL),
    ("health-ready", "get", lambda w: ("health-ready", [], None), ALL),
    ("restaurant-list", "get", lambda w: ("restaurant-list", [], None), ALL),
    ("restaurant-detail", "get", lambda w: ("restaurant-detail", [w["restaurant"].pk], None), ALL),
    ("restaurant-menu", "get", lambda w: ("restaurant-menu", [w["restaurant"].pk], None), ALL),
    ("restaurant-cuisines", "get", lambda w: ("restaurant-cuisines", [], None), ALL),
    ("menuitem-list", "get", lambda w: ("menuitem-list", [], None), ALL),
    ("menuitem-detail", "get", lambda w: ("menuitem-detail", [w["menu_item"].pk], None), ALL),
    ("auth-me", "get", lambda w: ("auth-me", [], None), ALL),
    ("auth-logout", "post", lambda w: ("auth-logout", [], {}), dict.fromkeys(CALLERS, 204)),
    ("order-lookup (found)", "post", lambda w: ("order-lookup", [], {"code": w["code"]}), ALL),
    ("checkout-start", "post", lambda w: ("checkout-start", [], {
        "restaurant": w["restaurant"].pk, "customer_name": "Sam",
        "items": [{"menu_item": w["menu_item"].pk, "quantity": 1}]}), ALL),
    ("checkout-capture (unknown)", "post", lambda w: ("checkout-capture", [], {"paypal_order_id": "PP-NONE"}),
     dict.fromkeys(CALLERS, 404)),
    ("assistant", "post", lambda w: ("assistant", [], {
        "restaurant": w["restaurant"].pk, "messages": [{"role": "user", "content": "something light"}]}), ALL),
    # Customers only
    ("my-orders", "get", lambda w: ("my-orders", [], None),
     {"anonymous": 403, "no_role": 403, "customer": 200, "cook_here": 403, "cook_elsewhere": 403, "admin": 403}),
    ("my-orders-attach", "post", lambda w: ("my-orders-attach", [], {"code": w["code"]}),
     {"anonymous": 403, "no_role": 403, "customer": 200, "cook_here": 403, "cook_elsewhere": 403, "admin": 403}),
    # Staff only
    ("fulfilment-orders", "get", lambda w: ("fulfilment-orders", [], None), STAFF_ONLY),
    # Owner only (S35, ADR-0020): everyone else is refused, an admin and a fulfilment user included
    ("dashboard-orders", "get", lambda w: ("dashboard-orders", [], None),
     {"anonymous": 403, "no_role": 403, "customer": 403, "cook_here": 403, "cook_elsewhere": 403, "admin": 403, "owner": 200}),
    ("dashboard-orders-post", "post", lambda w: ("dashboard-orders", [], {}),
     {"anonymous": 403, "no_role": 403, "customer": 403, "cook_here": 403, "cook_elsewhere": 403, "admin": 403, "owner": 405}),
    ("order-list", "get", lambda w: ("order-list", [], None), STAFF_ONLY),
    ("order-detail", "get", lambda w: ("order-detail", [w["order"].pk], None),
     {"anonymous": 403, "no_role": 403, "customer": 403, "cook_here": 200, "cook_elsewhere": 404, "admin": 200}),
    ("order-transition", "post", lambda w: ("order-transition", [w["order"].pk], {"status": "preparing"}),
     {"anonymous": 403, "no_role": 403, "customer": 403, "cook_here": 200, "cook_elsewhere": 403, "admin": 200}),
    # Orders are only made by a paid checkout, and are never changed or deleted by the API
    ("order-create", "post", lambda w: ("order-list", [], {}),
     {"anonymous": 403, "no_role": 403, "customer": 403, "cook_here": 405, "cook_elsewhere": 405, "admin": 405}),
    ("order-put", "put", lambda w: ("order-detail", [w["order"].pk], {}),
     {"anonymous": 403, "no_role": 403, "customer": 403, "cook_here": 405, "cook_elsewhere": 405, "admin": 405}),
    ("order-delete", "delete", lambda w: ("order-detail", [w["order"].pk], None),
     {"anonymous": 403, "no_role": 403, "customer": 403, "cook_here": 405, "cook_elsewhere": 405, "admin": 405}),
    # The catalogue is read-only through the API
    ("restaurant-create", "post", lambda w: ("restaurant-list", [], {}), dict.fromkeys(CALLERS, 405)),
    ("menuitem-delete", "delete", lambda w: ("menuitem-detail", [w["menu_item"].pk], None), dict.fromkeys(CALLERS, 405)),
]


# An owner is not staff and not a customer (ADR-0020), so on every route that does not name the
# owner it is answered as a signed-in user with no role. A row that gives the owner its own answer
# (the dashboard list) keeps it.
for _name, _method, _build, _expected in ENDPOINTS:
    _expected.setdefault("owner", _expected["no_role"])


@pytest.mark.parametrize("caller", CALLERS)
@pytest.mark.parametrize(
    "name, method, build, expected", ENDPOINTS, ids=[e[0] for e in ENDPOINTS]
)
def test_every_endpoint_answers_each_caller_as_the_table_says(
    world, fake_paypal, fake_assistant, name, method, build, expected, caller
):
    route, args, body = build(world)
    client = client_for(world, caller)

    response = getattr(client, method)(reverse(route, args=args), body, format="json") if body is not None else getattr(client, method)(reverse(route, args=args))

    assert response.status_code == expected[caller], f"{name} as {caller}: {response.content[:200]!r}"


def test_a_staff_move_changes_the_order_only_for_the_right_callers(world):
    order = world["order"]
    client = client_for(world, "cook_elsewhere")

    client.post(reverse("order-transition", args=[order.pk]), {"status": "preparing"}, format="json")

    order.refresh_from_db()
    assert order.status == Order.Status.CONFIRMED


def test_the_lookup_gives_the_same_answer_to_every_caller(world):
    answers = []
    for caller in CALLERS:
        response = client_for(world, caller).post(
            reverse("order-lookup"), {"code": world["code"]}, format="json"
        )
        answers.append(json.dumps(response.json(), sort_keys=True))

    assert len(set(answers)) == 1


def test_no_caller_reads_private_details_from_the_lookup(world):
    text = client_for(world, "anonymous").post(
        reverse("order-lookup"), {"code": world["code"]}, format="json"
    ).content.decode()

    assert "Sam" not in text and "customer_name" not in text and "delivery_address" not in text


def test_the_order_number_never_opens_an_order_for_a_guest(world):
    anyone = client_for(world, "anonymous")

    assert anyone.get(reverse("order-detail", args=[world["order"].pk])).status_code == 403
    assert anyone.get(reverse("fulfilment-orders")).status_code == 403


def api_route_names():
    found = set()

    def walk(patterns, prefix):
        for pattern in patterns:
            route = prefix + str(pattern.pattern)
            if hasattr(pattern, "url_patterns"):
                walk(pattern.url_patterns, route)
            elif pattern.name and route.startswith("api/"):
                found.add(pattern.name)

    walk(get_resolver().url_patterns, "")
    return found - {"api-root"}


# Routes whose access is decided in the table above (auth-login and auth-register have their
# own tests in test_staff_access.py and test_customer_accounts.py, because they need the CSRF
# token and a real session).
DECIDED = {
    "health-live", "health-ready", "restaurant-list", "restaurant-detail", "restaurant-menu",
    "restaurant-cuisines", "menuitem-list", "menuitem-detail", "auth-me", "auth-login", "auth-logout", "auth-register", "my-orders", "my-orders-attach",
    "order-lookup", "checkout-start", "checkout-capture", "assistant", "fulfilment-orders", "dashboard-orders",
    "order-list", "order-detail", "order-transition",
}


def test_every_api_route_is_decided():
    """A new route must be added to ENDPOINTS, so who may use it is decided and tested."""
    assert api_route_names() == DECIDED
# Sessions are shared between backend replicas (the cluster runs two)


def test_sessions_live_in_the_database_so_every_replica_sees_them(settings):
    assert settings.SESSION_ENGINE == "django.contrib.sessions.backends.db"


def test_a_session_started_on_one_client_works_for_another_that_shares_the_cookie(make_user, restaurant, settings):
    from cafe.tests.conftest import PASSWORD

    make_user("cook", FULFILMENT, restaurants=[restaurant])
    first = APIClient(enforce_csrf_checks=True)
    first.get(reverse("auth-me"))
    token = first.cookies["csrftoken"].value
    first.post(reverse("auth-login"), {"username": "cook", "password": PASSWORD}, format="json", HTTP_X_CSRFTOKEN=token)
    session_cookie = first.cookies["sessionid"].value

    # A second backend process knows nothing of the first except the database.
    second = APIClient()
    second.cookies["sessionid"] = session_cookie

    assert second.get(reverse("auth-me")).json()["user"]["username"] == "cook"


# Settings the cluster depends on


def settings_with(env_value):
    script = "import config.settings as s; print(s.SECURE_PROXY_SSL_HEADER if hasattr(s, 'SECURE_PROXY_SSL_HEADER') else 'unset')"
    import os

    env = {**os.environ, "DJANGO_DEBUG": "true", "DJANGO_BEHIND_TLS_PROXY": env_value}
    return subprocess.run([sys.executable, "-c", script], env=env, capture_output=True, text=True, check=True).stdout.strip()


def test_the_proxy_header_is_trusted_only_when_told_to():
    assert settings_with("false") == "unset"
    assert settings_with("true") == "('HTTP_X_FORWARDED_PROTO', 'https')"


def test_cookies_are_secure_only_when_told_to():
    import os

    def flag(value):
        env = {**os.environ, "DJANGO_DEBUG": "true", "DJANGO_SECURE_COOKIES": value}
        script = "import config.settings as s; print(s.SESSION_COOKIE_SECURE, s.CSRF_COOKIE_SECURE)"
        return subprocess.run([sys.executable, "-c", script], env=env, capture_output=True, text=True, check=True).stdout.strip()

    assert flag("false") == "False False"
    assert flag("true") == "True True"


def test_the_proxy_count_comes_from_the_environment():
    import os

    env = {**os.environ, "DJANGO_DEBUG": "true", "NUM_PROXIES": "1"}
    out = subprocess.run(
        [sys.executable, "-c", "import config.settings as s; print(s.REST_FRAMEWORK['NUM_PROXIES'])"],
        env=env, capture_output=True, text=True, check=True,
    ).stdout.strip()

    assert out == "1"


def test_static_files_for_the_admin_are_served_by_the_backend(settings):
    assert "whitenoise.middleware.WhiteNoiseMiddleware" in settings.MIDDLEWARE
    assert str(settings.STATIC_ROOT).endswith("staticfiles")
