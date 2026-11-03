import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.urls import reverse
from rest_framework.test import APIClient

from cafe import codes
from cafe.models import MenuItem, Order, OrderItem, Restaurant
from cafe.roles import ADMIN, CUSTOMER, FULFILMENT, STAFF_ROLES, restaurants_of, role_of
from cafe.tests.conftest import PASSWORD

# Every test in this file touches the database.
pytestmark = pytest.mark.django_db

User = get_user_model()


def browser():
    """A client with a session cookie and CSRF checking on, as a browser has."""
    client = APIClient(enforce_csrf_checks=True)
    client.get(reverse("auth-me"))
    return client


def post(client, url, body=None):
    token = client.cookies["csrftoken"].value if "csrftoken" in client.cookies else ""
    return client.post(url, body or {}, format="json", HTTP_X_CSRFTOKEN=token)


def register(client, username="shopper", password=PASSWORD):
    return post(client, reverse("auth-register"), {"username": username, "password": password})


def signed_in_customer(make_user, name="shopper"):
    make_user(name, CUSTOMER)
    client = browser()
    assert post(client, reverse("auth-login"), {"username": name, "password": PASSWORD}).status_code == 200
    return client


@pytest.fixture
def paid_order(restaurant, menu_item):
    order = Order.objects.create(
        restaurant=restaurant, customer_name="Sam Private", delivery_address="9 Secret Lane",
        status=Order.Status.CONFIRMED, payment_status=Order.PaymentStatus.PAID,
        payer_email="payer@example.com",
    )
    OrderItem.objects.create(order=order, menu_item=menu_item, quantity=2, unit_price="9.99")
    return order


def attach(client, code):
    return post(client, reverse("my-orders-attach"), {"code": code})


# The role


def test_the_customer_group_exists_after_migrating():
    assert Group.objects.filter(name=CUSTOMER).exists()


def test_a_customer_has_the_customer_role_and_is_not_staff(make_user):
    user = make_user("shopper", CUSTOMER)

    assert role_of(user) == CUSTOMER
    assert CUSTOMER not in STAFF_ROLES
    assert list(restaurants_of(user)) == []


def test_a_superuser_in_the_customer_group_is_still_admin(make_user):
    assert role_of(make_user("both", CUSTOMER, is_superuser=True)) == ADMIN


def test_a_customer_cannot_use_the_queue_or_order_reads(make_user, paid_order):
    client = signed_in_customer(make_user)

    for route, args in (("fulfilment-orders", []), ("order-list", []), ("order-detail", [paid_order.pk])):
        assert client.get(reverse(route, args=args)).status_code == 403
    assert post(client, reverse("order-transition", args=[paid_order.pk]), {"status": "preparing"}).status_code == 403


def test_a_customer_can_sign_in_on_the_login_endpoint(make_user):
    make_user("shopper", CUSTOMER)
    client = browser()

    response = post(client, reverse("auth-login"), {"username": "shopper", "password": PASSWORD})

    assert response.status_code == 200
    assert response.json()["role"] == CUSTOMER and response.json()["restaurants"] == []


# Registering


def test_registering_makes_a_customer_and_signs_them_in():
    client = browser()

    response = register(client)

    assert response.status_code == 201
    assert response.json() == {"username": "shopper", "role": CUSTOMER, "restaurants": []}
    user = User.objects.get(username="shopper")
    assert role_of(user) == CUSTOMER and not user.is_staff and not user.is_superuser
    assert user.check_password(PASSWORD)
    assert client.get(reverse("auth-me")).json()["user"]["username"] == "shopper"


def test_the_password_is_not_stored_as_given():
    register(browser())

    assert User.objects.get(username="shopper").password != PASSWORD


@pytest.mark.parametrize("password", ["short1", "password", "12345678", "shopper12"])
def test_a_weak_password_is_refused_and_nothing_is_created(password):
    response = register(browser(), password=password)

    assert response.status_code == 400 and response.json()["detail"]
    assert not User.objects.filter(username="shopper").exists()


@pytest.mark.parametrize("username", ["", "   ", "bad name!", "x" * 151])
def test_a_bad_username_is_refused(username):
    assert register(browser(), username=username).status_code == 400
    assert User.objects.count() == 0


@pytest.mark.parametrize("body", [{}, {"username": "a"}, {"password": PASSWORD}, {"username": 1, "password": 2}, {"username": ["a"], "password": PASSWORD}])
def test_a_missing_or_odd_field_is_refused(body):
    assert post(browser(), reverse("auth-register"), body).status_code == 400
    assert User.objects.count() == 0


def test_a_list_body_is_refused():
    client = browser()
    token = client.cookies["csrftoken"].value

    response = client.post(reverse("auth-register"), ["a"], format="json", HTTP_X_CSRFTOKEN=token)

    assert response.status_code == 400


def test_a_taken_username_is_refused_whatever_its_case(make_user):
    make_user("Shopper", CUSTOMER)

    for name in ("Shopper", "shopper", "SHOPPER"):
        assert register(browser(), username=name).status_code == 400
    assert User.objects.count() == 1


def test_a_taken_staff_username_is_refused_too_and_nothing_changes(make_user):
    cook = make_user("cook", FULFILMENT)

    assert register(browser(), username="cook").status_code == 400
    cook.refresh_from_db()
    assert role_of(cook) == FULFILMENT and cook.check_password(PASSWORD)


def test_registering_needs_the_csrf_token():
    client = APIClient(enforce_csrf_checks=True)
    client.get(reverse("auth-me"))

    response = client.post(
        reverse("auth-register"), {"username": "shopper", "password": PASSWORD}, format="json"
    )

    assert response.status_code == 403 and not User.objects.exists()


def test_registering_is_rate_limited_and_the_password_is_not_checked_over_the_limit():
    client = browser()
    codes_seen = [register(client, username=f"user{n}").status_code for n in range(11)]

    assert codes_seen[:10] == [201] * 10
    assert codes_seen[10] == 429
    assert User.objects.count() == 10


def test_registering_cannot_make_staff():
    register(browser(), username="sneaky")

    user = User.objects.get(username="sneaky")
    assert list(user.groups.values_list("name", flat=True)) == [CUSTOMER]
    assert not user.staffed_restaurants.exists()


def test_a_registered_customer_cannot_open_the_django_admin(client):
    register_client = browser()
    register(register_client)
    client.force_login(User.objects.get(username="shopper"))

    response = client.get(reverse("admin:index"))

    assert response.status_code == 302 and "/admin/login/" in response["Location"]


# Attaching an order


def test_a_customer_attaches_an_order_by_its_code(make_user, paid_order):
    client = signed_in_customer(make_user)

    response = attach(client, codes.display(paid_order.public_code))

    assert response.status_code == 200
    assert response.json()["public_code"] == codes.display(paid_order.public_code)
    paid_order.refresh_from_db()
    assert paid_order.customer.username == "shopper"


def test_a_code_typed_loosely_still_attaches(make_user, paid_order):
    client = signed_in_customer(make_user)
    raw = paid_order.public_code

    assert attach(client, f"{raw[:4].lower()} {raw[4:8]}-{raw[8:]}").status_code == 200


def test_the_attach_answer_has_no_private_details(make_user, paid_order):
    client = signed_in_customer(make_user)

    text = attach(client, paid_order.public_code).content.decode()

    for private in ("Sam Private", "9 Secret Lane", "payer@example.com", "customer_name", "delivery_address"):
        assert private not in text
    assert f'"id": {paid_order.pk}' not in text and '"id":' not in text


def test_the_first_claim_wins_and_the_second_looks_like_a_wrong_code(make_user, paid_order):
    first = signed_in_customer(make_user, "first")
    second = signed_in_customer(make_user, "second")
    wrong = attach(second, codes.display(codes.generate()))

    assert attach(first, paid_order.public_code).status_code == 200
    lost = attach(second, paid_order.public_code)

    assert lost.status_code == 404 and lost.json() == wrong.json()
    paid_order.refresh_from_db()
    assert paid_order.customer.username == "first"


def test_attaching_an_order_you_already_hold_answers_not_found(make_user, paid_order):
    client = signed_in_customer(make_user)
    attach(client, paid_order.public_code)

    assert attach(client, paid_order.public_code).status_code == 404


@pytest.mark.parametrize("code", ["", "nonsense", "ZZZZ-ZZZZ-ZZZZ", None, 12, ["a"], {"x": 1}])
def test_a_wrong_or_malformed_code_is_the_same_404(make_user, paid_order, code):
    client = signed_in_customer(make_user)

    response = post(client, reverse("my-orders-attach"), {"code": code})

    assert response.status_code == 404
    assert response.json() == {"detail": "No order was found for that code."}
    paid_order.refresh_from_db()
    assert paid_order.customer is None


def test_attaching_needs_the_csrf_token(make_user, paid_order):
    client = signed_in_customer(make_user)

    response = client.post(reverse("my-orders-attach"), {"code": paid_order.public_code}, format="json")

    assert response.status_code == 403
    paid_order.refresh_from_db()
    assert paid_order.customer is None


def test_attaching_is_rate_limited(make_user):
    client = signed_in_customer(make_user)
    seen = [attach(client, codes.display(codes.generate())).status_code for _ in range(21)]

    assert seen[:20] == [404] * 20 and seen[20] == 429


def test_only_the_claim_changes_the_order(make_user, paid_order):
    before = Order.objects.filter(pk=paid_order.pk).values().get()
    attach(signed_in_customer(make_user), paid_order.public_code)

    after = Order.objects.filter(pk=paid_order.pk).values().get()
    changed = {key for key in before if before[key] != after[key]}
    assert changed == {"customer_id"}


# My orders


def test_my_orders_lists_only_my_own_orders_newest_first(make_user, restaurant, menu_item):
    def paid(name):
        order = Order.objects.create(restaurant=restaurant, customer_name=name, payment_status="paid", status="confirmed")
        OrderItem.objects.create(order=order, menu_item=menu_item, quantity=1, unit_price="9.99")
        return order

    older, newer, theirs, unclaimed = paid("A"), paid("B"), paid("C"), paid("D")
    mine = signed_in_customer(make_user, "mine")
    other = signed_in_customer(make_user, "other")
    attach(mine, older.public_code)
    attach(mine, newer.public_code)
    attach(other, theirs.public_code)

    listed = mine.get(reverse("my-orders")).json()

    assert [row["public_code"] for row in listed] == [
        codes.display(newer.public_code), codes.display(older.public_code)
    ]
    assert codes.display(theirs.public_code) not in str(listed)
    assert codes.display(unclaimed.public_code) not in str(listed)


def test_my_orders_is_empty_for_a_new_customer(make_user):
    assert signed_in_customer(make_user).get(reverse("my-orders")).json() == []


def test_my_orders_has_the_guest_shape_and_no_private_details(make_user, paid_order):
    client = signed_in_customer(make_user)
    attach(client, paid_order.public_code)

    response = client.get(reverse("my-orders"))
    row = response.json()[0]

    assert set(row) == {
        "restaurant_name", "status", "created_at", "fulfilment_type", "items",
        "delivery_fee", "total", "public_code",
    }
    assert row["total"] == "19.98" and row["items"][0]["quantity"] == 2
    text = response.content.decode()
    for private in ("Sam Private", "9 Secret Lane", "payer@example.com"):
        assert private not in text


def test_my_orders_query_count_does_not_grow(make_user, restaurant, menu_item, django_assert_max_num_queries):
    client = signed_in_customer(make_user)
    for n in range(6):
        order = Order.objects.create(restaurant=restaurant, customer_name=str(n), payment_status="paid", status="confirmed")
        OrderItem.objects.create(order=order, menu_item=menu_item, quantity=1, unit_price="9.99")
        attach(client, order.public_code)

    with django_assert_max_num_queries(6):
        assert len(client.get(reverse("my-orders")).json()) == 6


def test_a_customers_orders_survive_deleting_the_account(make_user, paid_order):
    attach(signed_in_customer(make_user), paid_order.public_code)

    User.objects.get(username="shopper").delete()

    paid_order.refresh_from_db()
    assert paid_order.customer is None


# Admin: only an admin moves an attached order


def test_an_admin_moves_an_attached_order_to_another_customer(client, make_user, paid_order):
    client.force_login(make_user("boss", ADMIN, is_staff=True))
    first = make_user("first", CUSTOMER)
    second = make_user("second", CUSTOMER)
    paid_order.customer = first
    paid_order.save()
    url = reverse("admin:cafe_order_change", args=[paid_order.pk])

    page = client.get(url)
    assert page.status_code == 200 and 'name="customer"' in page.content.decode()
    response = client.post(url, {
        "customer": second.pk, "restaurant": paid_order.restaurant_id, "status": paid_order.status,
        "customer_name": paid_order.customer_name, "payment_status": "paid",
        "fulfilment_type": "pickup", "delivery_fee": "0.00", "delivery_address": "",
        "items-TOTAL_FORMS": "0", "items-INITIAL_FORMS": "0", "items-MIN_NUM_FORMS": "0", "items-MAX_NUM_FORMS": "1000",
    })

    assert response.status_code == 302, response.content.decode()[:500]
    paid_order.refresh_from_db()
    assert paid_order.customer == second


def test_the_admin_user_list_shows_the_customer_role(client, make_user):
    client.force_login(make_user("boss", ADMIN, is_staff=True))
    make_user("shopper", CUSTOMER)

    page = client.get(reverse("admin:auth_user_changelist"))

    assert page.status_code == 200 and "customer" in page.content.decode()


def test_the_admin_refuses_two_roles_on_one_user(client, make_user):
    boss = make_user("boss", ADMIN, is_staff=True)
    shopper = make_user("shopper", CUSTOMER)
    client.force_login(boss)

    response = client.post(reverse("admin:auth_user_change", args=[shopper.pk]), {
        "username": "shopper", "groups": [Group.objects.get(name=CUSTOMER).pk, Group.objects.get(name=FULFILMENT).pk],
        "is_active": "on", "date_joined_0": "2026-01-01", "date_joined_1": "00:00:00",
    })

    assert response.status_code == 200 and "Choose one role" in response.content.decode()
    assert role_of(User.objects.get(pk=shopper.pk)) == CUSTOMER


# Staff are unaffected


def test_staff_still_see_the_queue_and_the_login_still_refuses_users_with_no_role(make_user, restaurant, paid_order):
    cook = make_user("cook", FULFILMENT, restaurants=[restaurant])
    client = browser()
    assert post(client, reverse("auth-login"), {"username": "cook", "password": PASSWORD}).status_code == 200
    assert client.get(reverse("fulfilment-orders")).status_code == 200

    make_user("nobody")
    other = browser()
    assert post(other, reverse("auth-login"), {"username": "nobody", "password": PASSWORD}).status_code == 403
    assert "sessionid" not in other.cookies


def test_a_guest_lookup_still_works_for_a_claimed_order(make_user, paid_order):
    attach(signed_in_customer(make_user), paid_order.public_code)

    response = APIClient().post(reverse("order-lookup"), {"code": paid_order.public_code}, format="json")

    assert response.status_code == 200


# A paid order goes to the customer who paid (S23c follow-up)


def pay_as(client, restaurant, menu_item, **extra):
    from cafe.tests.helpers import cart

    started = post(client, reverse("checkout-start"), cart(restaurant, menu_item, **extra))
    assert started.status_code == 200, started.content
    return post(client, reverse("checkout-capture"), {"paypal_order_id": started.json()["paypal_order_id"]})


def test_an_order_paid_by_a_signed_in_customer_is_in_my_orders(make_user, restaurant, menu_item, fake_paypal):
    client = signed_in_customer(make_user)

    response = pay_as(client, restaurant, menu_item)

    assert response.status_code == 201
    order = Order.objects.get()
    assert order.customer.username == "shopper"
    listed = client.get(reverse("my-orders")).json()
    assert [row["public_code"] for row in listed] == [response.json()["public_code"]]


def test_an_order_paid_by_a_guest_has_no_customer(restaurant, menu_item, fake_paypal):
    from cafe.tests.helpers import pay

    assert pay(APIClient(), cart_for(restaurant, menu_item)).status_code == 201

    assert Order.objects.get().customer is None


def cart_for(restaurant, menu_item):
    from cafe.tests.helpers import cart

    return cart(restaurant, menu_item)


@pytest.mark.parametrize("role", [FULFILMENT, ADMIN, None])
def test_an_order_paid_by_staff_or_a_user_with_no_role_has_no_customer(make_user, restaurant, menu_item, fake_paypal, role):
    make_user("payer", role)
    client = browser()
    post(client, reverse("auth-login"), {"username": "payer", "password": PASSWORD})
    if role is None:
        client.force_authenticate(User.objects.get(username="payer"))

    assert pay_as(client, restaurant, menu_item).status_code == 201

    assert Order.objects.get().customer is None


def test_completing_again_does_not_change_the_customer(make_user, restaurant, menu_item, fake_paypal):
    first = signed_in_customer(make_user, "first")
    second = signed_in_customer(make_user, "second")
    started = post(first, reverse("checkout-start"), cart_for(restaurant, menu_item))
    paypal_id = started.json()["paypal_order_id"]
    post(first, reverse("checkout-capture"), {"paypal_order_id": paypal_id})

    again = post(second, reverse("checkout-capture"), {"paypal_order_id": paypal_id})

    assert again.status_code == 200
    assert Order.objects.get().customer.username == "first"
    assert second.get(reverse("my-orders")).json() == []


def test_a_failed_payment_makes_no_order_for_the_customer(make_user, restaurant, menu_item, fake_paypal):
    client = signed_in_customer(make_user)
    started = post(client, reverse("checkout-start"), cart_for(restaurant, menu_item))
    fake_paypal.capture_completes = False

    response = post(client, reverse("checkout-capture"), {"paypal_order_id": started.json()["paypal_order_id"]})

    assert response.status_code == 402
    assert not Order.objects.exists()


def test_a_signed_in_customer_must_send_the_csrf_token_to_complete_a_checkout(make_user, restaurant, menu_item, fake_paypal):
    client = signed_in_customer(make_user)
    started = post(client, reverse("checkout-start"), cart_for(restaurant, menu_item))

    response = client.post(
        reverse("checkout-capture"), {"paypal_order_id": started.json()["paypal_order_id"]}, format="json"
    )

    assert response.status_code == 403
    assert not Order.objects.exists()
