from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.urls import reverse
from rest_framework.test import APIClient

from cafe.models import Order, Restaurant
from cafe.roles import ADMIN, FULFILMENT, restaurants_of, role_of
from cafe.tests.conftest import PASSWORD
from cafe.tests.helpers import cart, start

# Every test in this file touches the database.
pytestmark = pytest.mark.django_db

S = Order.Status


@pytest.fixture
def noodle_bar():
    return Restaurant.objects.create(name="Noodle Bar", address="2 Side St")


def an_order(restaurant, status=S.CONFIRMED):
    return Order.objects.create(
        restaurant=restaurant, customer_name="Sam", status=status,
        payment_status=Order.PaymentStatus.PAID,
    )


def signed_in(user):
    """A client with a real session cookie and CSRF checking switched on, as a browser has."""
    client = APIClient(enforce_csrf_checks=True)
    client.get(reverse("auth-me"))
    response = post(client, reverse("auth-login"), {"username": user.username, "password": PASSWORD})
    assert response.status_code == 200, response.content
    return client


def post(client, url, body=None):
    token = client.cookies["csrftoken"].value if "csrftoken" in client.cookies else ""
    return client.post(url, body or {}, format="json", HTTP_X_CSRFTOKEN=token)


# Roles


def test_the_staff_groups_exist_after_migrating():
    assert set(Group.objects.values_list("name", flat=True)) >= {"fulfilment", "admin"}


def test_a_user_in_no_group_has_no_role(make_user):
    assert role_of(make_user("plain")) is None


def test_the_group_gives_the_role(make_user):
    assert role_of(make_user("cook", FULFILMENT)) == FULFILMENT
    assert role_of(make_user("boss", ADMIN)) == ADMIN


def test_a_superuser_counts_as_admin(make_user):
    assert role_of(make_user("root", is_superuser=True)) == ADMIN


def test_an_inactive_user_has_no_role(make_user):
    assert role_of(make_user("gone", FULFILMENT, is_active=False)) is None


def test_nobody_signed_in_has_no_role():
    from django.contrib.auth.models import AnonymousUser

    assert role_of(AnonymousUser()) is None
    assert role_of(None) is None


def test_a_fulfilment_user_works_for_their_restaurants_only(make_user, restaurant, noodle_bar):
    cook = make_user("cook", FULFILMENT, restaurants=[restaurant])

    assert list(restaurants_of(cook)) == [restaurant]


def test_an_admin_works_for_every_restaurant(make_user, restaurant, noodle_bar):
    assert set(restaurants_of(make_user("boss", ADMIN))) == {restaurant, noodle_bar}


def test_a_user_with_no_role_works_for_none(make_user, restaurant):
    plain = make_user("plain", restaurants=[restaurant])

    assert list(restaurants_of(plain)) == []


# Who am I


def test_me_says_nobody_is_signed_in_and_sets_the_csrf_cookie(api_client):
    response = api_client.get(reverse("auth-me"))

    assert response.status_code == 200
    assert response.json() == {"user": None}
    assert "csrftoken" in response.cookies


def test_me_shows_the_user_their_role_and_restaurants(make_user, restaurant, noodle_bar):
    cook = make_user("cook", FULFILMENT, restaurants=[restaurant])
    client = APIClient()
    client.force_authenticate(cook)

    body = client.get(reverse("auth-me")).json()

    assert body == {
        "user": {
            "username": "cook",
            "role": "fulfilment",
            "restaurants": [{"id": restaurant.pk, "name": "Corner Kitchen"}],
        }
    }


# Signing in


def test_staff_sign_in_with_the_right_password(make_user, restaurant):
    make_user("cook", FULFILMENT, restaurants=[restaurant])
    client = APIClient(enforce_csrf_checks=True)
    client.get(reverse("auth-me"))

    response = post(client, reverse("auth-login"), {"username": "cook", "password": PASSWORD})

    assert response.status_code == 200
    assert response.json()["username"] == "cook"
    assert "sessionid" in response.cookies
    assert client.get(reverse("auth-me")).json()["user"]["username"] == "cook"


def test_the_session_cookie_is_http_only_and_same_site(make_user):
    make_user("cook", FULFILMENT)
    client = APIClient(enforce_csrf_checks=True)
    client.get(reverse("auth-me"))

    response = post(client, reverse("auth-login"), {"username": "cook", "password": PASSWORD})

    cookie = response.cookies["sessionid"]
    assert cookie["httponly"] and cookie["samesite"] == "Lax"
    assert int(cookie["max-age"]) <= 12 * 60 * 60


@pytest.mark.parametrize(
    "credentials",
    [
        {"username": "cook", "password": "wrong"},
        {"username": "nobody", "password": PASSWORD},
        {"username": "cook"},
        {"password": PASSWORD},
        {"username": 5, "password": PASSWORD},
        {"username": "cook", "password": ["a"]},
    ],
)
def test_every_failure_to_sign_in_answers_alike(make_user, credentials):
    make_user("cook", FULFILMENT)
    client = APIClient(enforce_csrf_checks=True)
    client.get(reverse("auth-me"))

    response = post(client, reverse("auth-login"), credentials)

    assert response.status_code == 400
    assert response.json() == {"detail": "Wrong username or password."}
    assert "sessionid" not in response.cookies


def test_an_inactive_account_cannot_sign_in(make_user):
    make_user("gone", FULFILMENT, is_active=False)
    client = APIClient(enforce_csrf_checks=True)
    client.get(reverse("auth-me"))

    response = post(client, reverse("auth-login"), {"username": "gone", "password": PASSWORD})

    assert response.status_code == 400
    assert response.json() == {"detail": "Wrong username or password."}


def test_a_user_with_no_role_is_refused_and_gets_no_session(make_user):
    make_user("plain")
    client = APIClient(enforce_csrf_checks=True)
    client.get(reverse("auth-me"))

    response = post(client, reverse("auth-login"), {"username": "plain", "password": PASSWORD})

    assert response.status_code == 403
    assert "sessionid" not in response.cookies
    assert client.get(reverse("auth-me")).json() == {"user": None}


def test_signing_in_needs_the_csrf_token(make_user):
    make_user("cook", FULFILMENT)
    client = APIClient(enforce_csrf_checks=True)

    response = client.post(
        reverse("auth-login"), {"username": "cook", "password": PASSWORD}, format="json"
    )

    assert response.status_code == 403


def test_login_is_rate_limited(make_user, settings):
    make_user("cook", FULFILMENT)
    client = APIClient(enforce_csrf_checks=True)
    client.get(reverse("auth-me"))
    codes = [
        post(client, reverse("auth-login"), {"username": "cook", "password": "wrong"}).status_code
        for _ in range(11)
    ]

    assert codes[:10] == [400] * 10
    assert codes[10] == 429


def test_a_throttled_login_does_not_check_the_password(make_user):
    make_user("cook", FULFILMENT)
    client = APIClient(enforce_csrf_checks=True)
    client.get(reverse("auth-me"))
    for _ in range(10):
        post(client, reverse("auth-login"), {"username": "cook", "password": "wrong"})

    response = post(client, reverse("auth-login"), {"username": "cook", "password": PASSWORD})

    assert response.status_code == 429
    assert "sessionid" not in response.cookies


# Signing out


def test_signing_out_ends_the_session(make_user):
    client = signed_in(make_user("cook", FULFILMENT))

    response = post(client, reverse("auth-logout"))

    assert response.status_code == 204
    assert client.get(reverse("auth-me")).json() == {"user": None}


def test_signing_out_when_nobody_is_signed_in_is_fine(api_client):
    assert api_client.post(reverse("auth-logout")).status_code == 204


# The queue and the transition are for staff


def queue(client, **params):
    return client.get(reverse("fulfilment-orders"), params)


def move(client, order, target):
    return post(client, reverse("order-transition", args=[order.pk]), {"status": target})


def test_the_queue_refuses_nobody_signed_in(api_client, restaurant):
    an_order(restaurant)

    assert queue(api_client).status_code == 403


def test_the_queue_refuses_a_user_with_no_role(make_user, restaurant):
    client = APIClient()
    client.force_authenticate(make_user("plain", restaurants=[restaurant]))

    assert queue(client).status_code == 403


def test_a_move_is_refused_when_nobody_is_signed_in(api_client, restaurant):
    order = an_order(restaurant)

    assert move(api_client, order, S.PREPARING).status_code == 403
    order.refresh_from_db()
    assert order.status == S.CONFIRMED


def test_a_move_needs_the_csrf_token(make_user, restaurant):
    order = an_order(restaurant)
    client = signed_in(make_user("cook", FULFILMENT, restaurants=[restaurant]))

    response = client.post(
        reverse("order-transition", args=[order.pk]), {"status": S.PREPARING}, format="json"
    )

    assert response.status_code == 403
    order.refresh_from_db()
    assert order.status == S.CONFIRMED


def test_staff_move_their_own_restaurants_order(make_user, restaurant):
    order = an_order(restaurant)
    client = signed_in(make_user("cook", FULFILMENT, restaurants=[restaurant]))

    response = move(client, order, S.PREPARING)

    assert response.status_code == 200
    order.refresh_from_db()
    assert order.status == S.PREPARING


def test_staff_cannot_move_another_restaurants_order(make_user, restaurant, noodle_bar):
    order = an_order(noodle_bar)
    client = signed_in(make_user("cook", FULFILMENT, restaurants=[restaurant]))

    response = move(client, order, S.PREPARING)

    assert response.status_code == 403
    order.refresh_from_db()
    assert order.status == S.CONFIRMED


def test_an_admin_moves_any_restaurants_order(make_user, noodle_bar):
    order = an_order(noodle_bar)
    client = signed_in(make_user("boss", ADMIN))

    assert move(client, order, S.PREPARING).status_code == 200


def test_the_queue_lists_only_the_staff_members_restaurants(make_user, restaurant, noodle_bar):
    mine, theirs = an_order(restaurant), an_order(noodle_bar)
    client = signed_in(make_user("cook", FULFILMENT, restaurants=[restaurant]))

    ids = [row["id"] for row in queue(client).json()["results"]]

    assert ids == [mine.pk] and theirs.pk not in ids


def test_asking_for_another_restaurants_queue_gives_an_empty_list(make_user, restaurant, noodle_bar):
    an_order(noodle_bar)
    client = signed_in(make_user("cook", FULFILMENT, restaurants=[restaurant]))

    assert queue(client, restaurant=noodle_bar.pk).json()["results"] == []


def test_the_queue_filters_work_inside_what_the_user_may_see(make_user, restaurant, noodle_bar):
    an_order(restaurant, S.READY)
    an_order(restaurant, S.CONFIRMED)
    an_order(noodle_bar, S.READY)
    client = signed_in(make_user("cook", FULFILMENT, restaurants=[restaurant, noodle_bar]))

    both = queue(client, status="ready").json()["count"]
    mine = queue(client, status="ready", restaurant=restaurant.pk).json()["count"]

    assert (both, mine) == (2, 1)


def test_an_admin_sees_every_restaurants_orders(make_user, restaurant, noodle_bar):
    an_order(restaurant)
    an_order(noodle_bar)

    assert queue(signed_in(make_user("boss", ADMIN))).json()["count"] == 2


def test_staff_of_nothing_see_an_empty_queue(make_user, restaurant):
    an_order(restaurant)

    assert queue(signed_in(make_user("idle", FULFILMENT))).json()["results"] == []


def test_a_signed_out_user_loses_the_queue(make_user, restaurant):
    an_order(restaurant)
    client = signed_in(make_user("cook", FULFILMENT, restaurants=[restaurant]))
    post(client, reverse("auth-logout"))

    assert queue(client).status_code == 403


# Guests are not affected


def test_guests_still_browse_order_and_pay(api_client, restaurant, menu_item, fake_paypal):
    assert api_client.get(reverse("restaurant-list")).status_code == 200
    assert start(api_client, cart(restaurant, menu_item)).status_code == 200


# Checkout is rate limited


def test_starting_checkouts_is_rate_limited_and_paypal_is_not_called_over_the_limit(
    api_client, restaurant, menu_item, fake_paypal, settings
):
    codes = [start(api_client, cart(restaurant, menu_item)).status_code for _ in range(31)]

    assert codes[:30] == [200] * 30
    assert codes[30] == 429
    assert len(fake_paypal.created) == 30


# Cookies and cross-site requests


def test_cookie_and_csrf_settings(settings):
    assert settings.SESSION_COOKIE_SAMESITE == "Lax" == settings.CSRF_COOKIE_SAMESITE
    assert settings.SESSION_COOKIE_AGE <= 12 * 60 * 60
    assert settings.CORS_ALLOW_CREDENTIALS is True
    assert "http://localhost:5173" in settings.CSRF_TRUSTED_ORIGINS


def test_an_allowed_origin_may_send_credentials(api_client):
    response = api_client.get(reverse("auth-me"), HTTP_ORIGIN="http://localhost:5173")

    assert response["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert response["Access-Control-Allow-Credentials"] == "true"


def test_another_origin_is_not_allowed(api_client):
    response = api_client.get(reverse("auth-me"), HTTP_ORIGIN="http://evil.example")

    assert "Access-Control-Allow-Origin" not in response


def test_basic_authentication_is_not_accepted(make_user, restaurant):
    import base64

    make_user("cook", FULFILMENT, restaurants=[restaurant])
    an_order(restaurant)
    token = base64.b64encode(f"cook:{PASSWORD}".encode()).decode()

    response = APIClient().get(reverse("fulfilment-orders"), HTTP_AUTHORIZATION=f"Basic {token}")

    assert response.status_code == 403


# The demo users


def run_seed(*args):
    out = StringIO()
    call_command("seed_demo_users", *args, stdout=out)
    return out.getvalue()


def passwords_in(text):
    return dict(line.split() for line in text.splitlines() if line.startswith("  "))


def test_the_seed_creates_staff_for_each_restaurant_an_admin_and_an_owner(restaurant, noodle_bar):
    printed = passwords_in(run_seed())
    users = get_user_model().objects

    assert set(printed) == {"admin", "owner", "demo-customer", "staff-corner-kitchen", "staff-noodle-bar"}
    assert role_of(users.get(username="admin")) == ADMIN
    assert list(users.get(username="staff-corner-kitchen").staffed_restaurants.all()) == [restaurant]
    assert list(users.get(username="staff-noodle-bar").staffed_restaurants.all()) == [noodle_bar]


def test_the_password_option_gives_every_demo_user_the_same_password(restaurant):
    printed = passwords_in(run_seed("--password", "Password1"))

    assert set(printed) == {"admin", "owner", "demo-customer", "staff-corner-kitchen"}
    assert set(printed.values()) == {"Password1"}
    users = get_user_model().objects
    assert all(users.get(username=name).check_password("Password1") for name in printed)


def test_the_password_option_changes_existing_users_only_with_reset(restaurant):
    run_seed()
    assert passwords_in(run_seed("--password", "Password1")) == {}

    printed = passwords_in(run_seed("--password", "Password1", "--reset-passwords"))

    assert set(printed.values()) == {"Password1"}


def test_the_printed_passwords_work(restaurant):
    printed = passwords_in(run_seed())
    client = APIClient(enforce_csrf_checks=True)
    client.get(reverse("auth-me"))

    response = post(
        client, reverse("auth-login"),
        {"username": "staff-corner-kitchen", "password": printed["staff-corner-kitchen"]},
    )

    assert response.status_code == 200


def test_running_the_seed_again_changes_no_password_and_adds_no_one(restaurant):
    first = passwords_in(run_seed())

    again = run_seed()

    assert passwords_in(again) == {}
    assert get_user_model().objects.count() == len(first)
    user = get_user_model().objects.get(username="admin")
    assert user.check_password(first["admin"])


def test_reset_passwords_gives_new_ones(restaurant):
    first = passwords_in(run_seed())

    second = passwords_in(run_seed("--reset-passwords"))

    assert second["admin"] != first["admin"]
    assert get_user_model().objects.get(username="admin").check_password(second["admin"])


def test_the_seed_never_uses_a_fixed_password(restaurant, noodle_bar):
    one = passwords_in(run_seed())
    get_user_model().objects.all().delete()
    two = passwords_in(run_seed())

    assert one["admin"] != two["admin"]
    assert len(set(one.values())) == len(one)


def test_the_seed_makes_a_demo_customer_who_can_sign_in_and_is_not_staff(restaurant):
    printed = passwords_in(run_seed())
    user = get_user_model().objects.get(username="demo-customer")
    client = APIClient(enforce_csrf_checks=True)
    client.get(reverse("auth-me"))

    response = post(client, reverse("auth-login"), {"username": "demo-customer", "password": printed["demo-customer"]})

    assert role_of(user) == "customer" and not user.is_staff
    assert response.status_code == 200 and response.json()["role"] == "customer"
