import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from cafe import codes
from cafe.models import MenuItem, Order, OrderItem, Restaurant
from cafe.roles import FULFILMENT
from cafe.tests.helpers import cart, capture, pay, start

# Every test in this file touches the database.
pytestmark = pytest.mark.django_db

PRIVATE = ("Sam Private", "7 Secret Lane", "buyer@example.com", "PAYER-FAKE-1", "CAP-FAKE-1")


@pytest.fixture
def an_order(restaurant, menu_item):
    order = Order.objects.create(
        restaurant=restaurant, customer_name="Sam Private", status=Order.Status.CONFIRMED,
        payment_status=Order.PaymentStatus.PAID, fulfilment_type=Order.FulfilmentType.DELIVERY,
        delivery_address="7 Secret Lane", delivery_fee="3.00", payer_email="buyer@example.com",
        payer_id="PAYER-FAKE-1", paypal_capture_id="CAP-FAKE-1", paypal_order_id="PP-X",
    )
    OrderItem.objects.create(order=order, menu_item=menu_item, quantity=2, unit_price="9.99")
    return order


def lookup(client, code):
    return client.post(reverse("order-lookup"), {"code": code}, format="json")


# The lookup


def test_a_code_finds_its_order(api_client, an_order):
    response = lookup(api_client, codes.display(an_order.public_code))

    assert response.status_code == 200
    assert response.json() == {
        "restaurant_name": "Corner Kitchen",
        "status": "confirmed",
        "created_at": response.json()["created_at"],
        "fulfilment_type": "delivery",
        "items": [{"menu_item_name": "Noodles", "quantity": 2, "unit_price": "9.99"}],
        "delivery_fee": "3.00",
        "total": "22.98",
        "public_code": codes.display(an_order.public_code),
    }


@pytest.mark.parametrize(
    "shape",
    [str.lower, lambda c: c.replace("-", " "), lambda c: c.replace("-", ""), lambda c: f"  {c}  "],
)
def test_the_code_may_be_typed_loosely(api_client, an_order, shape):
    typed = shape(codes.display(an_order.public_code))

    assert lookup(api_client, typed).status_code == 200


def test_the_answer_has_none_of_the_private_details(api_client, an_order):
    text = lookup(api_client, an_order.public_code).content.decode()

    for private in PRIVATE:
        assert private not in text
    assert f'"id": {an_order.pk}' not in text and '"id"' not in text


def test_the_answer_is_one_order_never_a_list(api_client, an_order, restaurant):
    Order.objects.create(restaurant=restaurant, customer_name="Other", payment_status="paid")

    body = lookup(api_client, an_order.public_code).json()

    assert isinstance(body, dict) and "results" not in body


def test_no_sign_in_is_needed(an_order):
    assert lookup(APIClient(), an_order.public_code).status_code == 200


def test_the_lookup_follows_the_order_as_staff_move_it(api_client, an_order):
    an_order.status = Order.Status.READY
    an_order.save()

    assert lookup(api_client, an_order.public_code).json()["status"] == "ready"


# Misses all look alike


def test_an_unknown_code_is_a_404(api_client, an_order):
    response = lookup(api_client, codes.display(codes.generate()))

    assert response.status_code == 404
    assert response.json() == {"detail": "No order was found for that code."}


@pytest.mark.parametrize("bad", ["", "ABCD", "ABCD-EFGH-JKM1", None, 12, ["x"], {"a": 1}, "x" * 1000])
def test_a_body_that_is_not_a_code_gets_the_same_answer(api_client, an_order, bad):
    unknown = lookup(api_client, codes.display(codes.generate()))

    response = lookup(api_client, bad)

    assert (response.status_code, response.json()) == (unknown.status_code, unknown.json())


def test_a_missing_code_gets_the_same_answer(api_client, an_order):
    response = api_client.post(reverse("order-lookup"), {}, format="json")

    assert response.status_code == 404
    assert response.json() == {"detail": "No order was found for that code."}


def test_a_body_that_is_a_list_gets_the_same_answer(api_client):
    response = api_client.post(reverse("order-lookup"), ["a"], format="json")

    assert response.status_code == 404


def test_the_code_goes_in_the_body_only(api_client, an_order):
    assert api_client.get(reverse("order-lookup"), {"code": an_order.public_code}).status_code == 405
    assert api_client.get(f"/api/orders/lookup/{an_order.public_code}/").status_code == 404


def test_the_numeric_id_is_not_a_lookup_key(api_client, an_order):
    assert lookup(api_client, str(an_order.pk)).status_code == 404


def test_lookups_are_rate_limited(api_client, an_order):
    codes_seen = [lookup(api_client, codes.display(codes.generate())).status_code for _ in range(21)]

    assert codes_seen[:20] == [404] * 20
    assert codes_seen[20] == 429
    assert lookup(api_client, an_order.public_code).status_code == 429


# Who may read orders otherwise


def test_nobody_signed_in_cannot_read_orders(api_client, an_order):
    assert api_client.get(reverse("order-list")).status_code == 403
    assert api_client.get(reverse("order-detail", args=[an_order.pk])).status_code == 403


def test_the_order_number_opens_nothing_for_a_guest_holding_the_code(api_client, an_order):
    lookup(api_client, an_order.public_code)

    assert api_client.get(reverse("order-detail", args=[an_order.pk])).status_code == 403


def test_a_user_with_no_role_cannot_read_orders(make_user, an_order):
    client = APIClient()
    client.force_authenticate(make_user("plain"))

    assert client.get(reverse("order-list")).status_code == 403


def test_a_cook_reads_only_their_restaurants_orders(make_user, restaurant, an_order):
    other = Restaurant.objects.create(name="Noodle Bar", address="2 Side St")
    theirs = Order.objects.create(restaurant=other, customer_name="Elsewhere", payment_status="paid")
    client = APIClient()
    client.force_authenticate(make_user("cook", FULFILMENT, restaurants=[restaurant]))

    ids = [row["id"] for row in client.get(reverse("order-list")).json()["results"]]

    assert ids == [an_order.pk]
    assert client.get(reverse("order-detail", args=[an_order.pk])).status_code == 200
    assert client.get(reverse("order-detail", args=[theirs.pk])).status_code == 404


def test_an_admin_reads_every_restaurants_orders(admin_api, restaurant, an_order):
    other = Restaurant.objects.create(name="Noodle Bar", address="2 Side St")
    Order.objects.create(restaurant=other, customer_name="Elsewhere", payment_status="paid")

    assert admin_api.get(reverse("order-list")).json()["count"] == 2


# Where the code appears


def test_the_checkout_response_gives_the_code(api_client, restaurant, menu_item, fake_paypal):
    started = start(api_client, cart(restaurant, menu_item)).json()

    body = capture(api_client, started["paypal_order_id"]).json()

    order = Order.objects.get()
    assert body["public_code"] == codes.display(order.public_code)
    assert len(body["public_code"]) == 14 and body["public_code"].count("-") == 2


def test_the_repeat_of_a_completed_checkout_gives_the_same_code(api_client, restaurant, menu_item, fake_paypal):
    started = start(api_client, cart(restaurant, menu_item)).json()

    first = capture(api_client, started["paypal_order_id"]).json()
    second = capture(api_client, started["paypal_order_id"]).json()

    assert first["public_code"] == second["public_code"]


def test_the_code_from_payment_finds_the_order_just_paid(api_client, restaurant, menu_item, fake_paypal):
    code = pay(api_client, cart(restaurant, menu_item)).json()["public_code"]

    found = lookup(api_client, code)

    assert found.status_code == 200
    assert found.json()["items"][0]["menu_item_name"] == "Noodles"
    assert "Sam" not in found.content.decode()


def test_no_order_response_for_staff_carries_a_code(admin_api, an_order):
    responses = [
        admin_api.get(reverse("order-list")).content.decode(),
        admin_api.get(reverse("order-detail", args=[an_order.pk])).content.decode(),
        admin_api.get(reverse("fulfilment-orders")).content.decode(),
    ]

    for text in responses:
        assert an_order.public_code not in text
        assert codes.display(an_order.public_code) not in text
        assert "public_code" not in text


def test_checkout_start_does_not_give_a_code(api_client, restaurant, menu_item, fake_paypal):
    assert "code" not in start(api_client, cart(restaurant, menu_item)).content.decode().lower().replace("paypal_order_id", "")


def test_every_order_is_given_a_different_code(restaurant):
    made = [Order.objects.create(restaurant=restaurant, customer_name=str(i)) for i in range(50)]

    assert len({o.public_code for o in made}) == 50


# The admin


def test_an_administrator_finds_an_order_by_its_code(admin_client, an_order, restaurant):
    Order.objects.create(restaurant=restaurant, customer_name="Another")

    page = admin_client.get(reverse("admin:cafe_order_changelist"), {"q": an_order.public_code})

    assert page.status_code == 200
    assert "Sam Private" in page.content.decode() and "Another" not in page.content.decode()


def test_the_code_is_shown_on_the_admin_order_page(admin_client, an_order):
    page = admin_client.get(reverse("admin:cafe_order_change", args=[an_order.pk]))

    assert an_order.public_code in page.content.decode()
