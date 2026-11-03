from datetime import timedelta
from decimal import Decimal
from io import StringIO

import httpx
import pytest
from django.core.management import call_command
from django.db import IntegrityError, transaction
from django.urls import reverse
from django.utils import timezone

from cafe import paypal
from cafe.models import CheckoutDraft, CheckoutDraftItem, MenuItem, Order, OrderItem, Restaurant
from cafe.tests.helpers import capture, cart, pay, start

# Every test in this file touches the database.
pytestmark = pytest.mark.django_db

SECRET = "the-client-secret-value"


@pytest.fixture
def tea(restaurant):
    return MenuItem.objects.create(restaurant=restaurant, name="Tea", price=Decimal("5.00"))


def two_dishes(restaurant, menu_item, tea):
    return {
        "restaurant": restaurant.pk,
        "customer_name": "Sam",
        "items": [
            {"menu_item": menu_item.pk, "quantity": 2},
            {"menu_item": tea.pk, "quantity": 1},
        ],
    }


# Starting a checkout


def test_starting_a_checkout_answers_the_paypal_order_id_and_creates_no_order(
    api_client, restaurant, menu_item, tea, fake_paypal
):
    response = start(api_client, two_dishes(restaurant, menu_item, tea))

    assert response.status_code == 200
    assert response.json() == {"paypal_order_id": "PP-FAKE-1"}
    assert [amount for amount, _ in fake_paypal.created] == [Decimal("24.98")]
    assert Order.objects.count() == 0
    draft = CheckoutDraft.objects.get(paypal_order_id="PP-FAKE-1")
    assert (draft.total, draft.customer_name) == (Decimal("24.98"), "Sam")
    assert draft.items.count() == 2


def test_the_client_cannot_set_the_amount_status_price_or_fee(
    api_client, restaurant, menu_item, fake_paypal
):
    body = cart(
        restaurant, menu_item, quantity=1, amount="0.01", status="ready", delivery_fee="9.00",
        payment_status="paid", paypal_order_id="PP-FORGED",
    )
    body["items"][0]["unit_price"] = "0.01"

    start(api_client, body)

    assert fake_paypal.created[0][0] == Decimal("9.99")
    item = CheckoutDraftItem.objects.get()
    assert item.unit_price == Decimal("9.99")
    assert CheckoutDraft.objects.get().delivery_fee == Decimal("0.00")


@pytest.fixture
def carts(restaurant, menu_item):
    """One invalid cart per rule, all for `restaurant`."""
    other = Restaurant.objects.create(name="Other Cafe", address="2 Side St")
    elsewhere = MenuItem.objects.create(restaurant=other, name="Soup", price=Decimal("4.00"))
    sold_out = MenuItem.objects.create(
        restaurant=restaurant, name="Dumplings", price=Decimal("6.00"), is_available=False
    )
    return {
        "empty": [],
        "zero_quantity": [{"menu_item": menu_item.pk, "quantity": 0}],
        "duplicate": [
            {"menu_item": menu_item.pk, "quantity": 1},
            {"menu_item": menu_item.pk, "quantity": 1},
        ],
        "other_restaurant": [
            {"menu_item": menu_item.pk, "quantity": 1},
            {"menu_item": elsewhere.pk, "quantity": 1},
        ],
        "unavailable": [{"menu_item": sold_out.pk, "quantity": 1}],
    }


def start_cart(api_client, restaurant, items):
    body = {"restaurant": restaurant.pk, "customer_name": "Sam", "items": items}
    return start(api_client, body)


@pytest.mark.parametrize(
    "case", ["empty", "zero_quantity", "duplicate", "other_restaurant", "unavailable"]
)
def test_an_invalid_cart_is_rejected_and_nothing_is_stored_or_sent_to_paypal(
    api_client, restaurant, carts, case, fake_paypal
):
    response = start_cart(api_client, restaurant, carts[case])

    assert response.status_code == 400
    assert "items" in response.json()
    assert fake_paypal.created == []
    assert (Order.objects.count(), CheckoutDraft.objects.count(), CheckoutDraftItem.objects.count()) == (0, 0, 0)


@pytest.mark.parametrize(
    "case, row", [("duplicate", 1), ("other_restaurant", 1), ("unavailable", 0)]
)
def test_rule_errors_point_at_the_offending_item(api_client, restaurant, carts, case, row, fake_paypal):
    response = start_cart(api_client, restaurant, carts[case])

    errors = response.json()["items"]
    assert len(errors) == len(carts[case])
    assert errors[row]["menu_item"]
    assert all(errors[i] == {} for i in range(len(errors)) if i != row)


def test_empty_cart_error_message(api_client, restaurant, carts, fake_paypal):
    response = start_cart(api_client, restaurant, carts["empty"])

    assert response.json()["items"]["non_field_errors"] == ["This list may not be empty."]


def test_zero_quantity_error_points_at_the_item(api_client, restaurant, carts, fake_paypal):
    response = start_cart(api_client, restaurant, carts["zero_quantity"])

    assert "quantity" in response.json()["items"]["0"]


def test_a_menu_item_that_does_not_exist_is_a_400(api_client, restaurant, fake_paypal):
    response = start_cart(api_client, restaurant, [{"menu_item": 9999, "quantity": 2}])

    assert response.status_code == 400
    assert response.json()["items"]["0"]["menu_item"] == ['Invalid pk "9999" - object does not exist.']


def test_a_missing_name_is_a_400_on_the_name(api_client, restaurant, menu_item, fake_paypal):
    body = cart(restaurant, menu_item)
    body["customer_name"] = ""

    assert "customer_name" in start(api_client, body).json()


def test_start_answers_503_when_paypal_is_not_configured(api_client, restaurant, menu_item, monkeypatch):
    def not_configured():
        raise paypal.PayPalNotConfigured("not configured")

    monkeypatch.setattr(paypal, "get_client", not_configured)

    response = start(api_client, cart(restaurant, menu_item))

    assert response.status_code == 503
    assert (Order.objects.count(), CheckoutDraft.objects.count()) == (0, 0)


def test_start_answers_502_when_paypal_cannot_be_reached(api_client, restaurant, menu_item, fake_paypal):
    fake_paypal.unreachable()

    response = start(api_client, cart(restaurant, menu_item))

    assert response.status_code == 502
    assert (Order.objects.count(), CheckoutDraft.objects.count()) == (0, 0)


# Completing a checkout


def test_completing_creates_a_confirmed_paid_order_from_the_draft(
    api_client, restaurant, menu_item, tea, fake_paypal
):
    started = start(api_client, two_dishes(restaurant, menu_item, tea)).json()

    response = capture(api_client, started["paypal_order_id"])

    assert response.status_code == 201
    body = response.json()
    assert (body["status"], body["payment_status"]) == ("confirmed", "paid")
    assert body["restaurant_name"] == "Corner Kitchen"
    assert body["customer_name"] == "Sam"
    assert body["paypal_order_id"] == "PP-FAKE-1"
    assert body["total"] == "24.98"
    assert body["items"] == [
        {"menu_item": menu_item.pk, "quantity": 2, "unit_price": "9.99", "menu_item_name": "Noodles"},
        {"menu_item": tea.pk, "quantity": 1, "unit_price": "5.00", "menu_item_name": "Tea"},
    ]
    assert fake_paypal.captured == ["PP-FAKE-1"]
    assert CheckoutDraft.objects.count() == 0
    assert Order.objects.count() == 1


def test_the_order_uses_the_price_from_when_the_checkout_started(
    api_client, restaurant, menu_item, fake_paypal
):
    started = start(api_client, cart(restaurant, menu_item, quantity=1)).json()
    menu_item.price = Decimal("12.50")
    menu_item.save(update_fields=["price"])

    body = capture(api_client, started["paypal_order_id"]).json()

    assert body["items"][0]["unit_price"] == "9.99"
    assert Decimal(body["total"]) == fake_paypal.created[0][0] == Decimal("9.99")


def test_a_later_price_change_does_not_alter_the_order(api_client, restaurant, menu_item, fake_paypal):
    body = pay(api_client, cart(restaurant, menu_item, quantity=1)).json()

    menu_item.price = Decimal("1.00")
    menu_item.save(update_fields=["price"])

    assert OrderItem.objects.get(order_id=body["id"]).unit_price == Decimal("9.99")


def test_the_payer_and_the_capture_are_kept_on_the_order(api_client, restaurant, menu_item, fake_paypal):
    body = pay(api_client, cart(restaurant, menu_item)).json()

    order = Order.objects.get(pk=body["id"])
    assert (order.payer_email, order.payer_id, order.paypal_capture_id) == (
        "buyer@example.com", "PAYER-FAKE-1", "CAP-FAKE-1",
    )


def test_an_order_is_still_created_when_paypal_returns_no_payer(
    api_client, restaurant, menu_item, fake_paypal
):
    fake_paypal.payer_email = fake_paypal.payer_id = fake_paypal.capture_id = ""

    body = pay(api_client, cart(restaurant, menu_item)).json()

    order = Order.objects.get(pk=body["id"])
    assert (order.payer_email, order.payer_id, order.paypal_capture_id) == ("", "", "")


def test_no_response_shows_the_payer_or_the_capture(api_client, admin_api, restaurant, menu_item, fake_paypal):
    started = start(api_client, cart(restaurant, menu_item)).json()
    captured = capture(api_client, started["paypal_order_id"])
    order_id = captured.json()["id"]
    responses = [
        started,
        captured.json(),
        admin_api.get(reverse("order-detail", args=[order_id])).json(),
        admin_api.get(reverse("order-list")).json(),
        admin_api.get(reverse("fulfilment-orders")).json(),
    ]

    text = str(responses)

    for private in ("buyer@example.com", "PAYER-FAKE-1", "CAP-FAKE-1"):
        assert private not in text


def test_a_declined_payment_creates_no_order_and_keeps_the_draft(
    api_client, restaurant, menu_item, fake_paypal
):
    fake_paypal.capture_completes = False
    started = start(api_client, cart(restaurant, menu_item)).json()

    response = capture(api_client, started["paypal_order_id"])

    assert response.status_code == 402
    assert Order.objects.count() == 0
    assert CheckoutDraft.objects.count() == 1


def test_the_buyer_can_pay_again_after_a_decline(api_client, restaurant, menu_item, fake_paypal):
    fake_paypal.capture_completes = False
    started = start(api_client, cart(restaurant, menu_item)).json()
    capture(api_client, started["paypal_order_id"])
    fake_paypal.capture_completes = True

    response = capture(api_client, started["paypal_order_id"])

    assert response.status_code == 201
    assert Order.objects.count() == 1


def test_paypal_unreachable_on_capture_creates_no_order(api_client, restaurant, menu_item, fake_paypal):
    started = start(api_client, cart(restaurant, menu_item)).json()
    fake_paypal.unreachable()

    response = capture(api_client, started["paypal_order_id"])

    assert response.status_code == 502
    assert Order.objects.count() == 0
    assert CheckoutDraft.objects.count() == 1


def test_capture_answers_503_when_paypal_is_not_configured(api_client, restaurant, menu_item, fake_paypal, monkeypatch):
    started = start(api_client, cart(restaurant, menu_item)).json()

    def not_configured():
        raise paypal.PayPalNotConfigured("not configured")

    monkeypatch.setattr(paypal, "get_client", not_configured)

    response = capture(api_client, started["paypal_order_id"])

    assert response.status_code == 503
    assert Order.objects.count() == 0


def test_an_unknown_paypal_order_is_404_and_paypal_is_not_called(api_client, fake_paypal):
    response = capture(api_client, "PP-NOT-OURS")

    assert response.status_code == 404
    assert fake_paypal.captured == []


def test_the_paypal_order_id_is_required(api_client, fake_paypal):
    response = api_client.post(reverse("checkout-capture"), {}, format="json")

    assert response.status_code == 400
    assert "paypal_order_id" in response.json()


def test_completing_twice_returns_the_same_order_and_captures_once(
    api_client, restaurant, menu_item, fake_paypal
):
    started = start(api_client, cart(restaurant, menu_item)).json()

    first = capture(api_client, started["paypal_order_id"])
    second = capture(api_client, started["paypal_order_id"])

    assert (first.status_code, second.status_code) == (201, 200)
    assert first.json()["id"] == second.json()["id"]
    assert fake_paypal.captured == ["PP-FAKE-1"]
    assert Order.objects.count() == 1


def test_two_orders_can_never_share_a_paypal_order(restaurant):
    Order.objects.create(restaurant=restaurant, customer_name="A", paypal_order_id="PP-1")

    with pytest.raises(IntegrityError), transaction.atomic():
        Order.objects.create(restaurant=restaurant, customer_name="B", paypal_order_id="PP-1")


def test_orders_without_a_paypal_order_do_not_clash(restaurant):
    Order.objects.create(restaurant=restaurant, customer_name="A")
    Order.objects.create(restaurant=restaurant, customer_name="B")

    assert Order.objects.count() == 2


def test_a_failure_after_the_capture_leaves_nothing_and_a_retry_succeeds(
    api_client, restaurant, menu_item, fake_paypal, monkeypatch
):
    started = start(api_client, cart(restaurant, menu_item)).json()
    real = OrderItem.objects.bulk_create

    def fail(*args, **kwargs):
        raise RuntimeError("items could not be written")

    monkeypatch.setattr(OrderItem.objects, "bulk_create", fail)
    with pytest.raises(RuntimeError):
        capture(api_client, started["paypal_order_id"])
    assert (Order.objects.count(), OrderItem.objects.count()) == (0, 0)
    assert CheckoutDraft.objects.count() == 1

    monkeypatch.setattr(OrderItem.objects, "bulk_create", real)
    retry = capture(api_client, started["paypal_order_id"])

    assert retry.status_code == 201
    assert Order.objects.count() == 1


def test_a_dish_in_a_waiting_checkout_cannot_be_deleted(api_client, restaurant, menu_item, fake_paypal):
    start(api_client, cart(restaurant, menu_item))

    with pytest.raises(Exception) as caught:
        menu_item.delete()

    assert "protected" in str(caught.value).lower()


# No order without a payment


def test_posting_an_order_is_refused_and_stores_nothing(api_client, admin_api, restaurant, menu_item):
    # Staff are told the method is not allowed; anyone else is not even let in.
    staff = admin_api.post(reverse("order-list"), cart(restaurant, menu_item), format="json")
    guest = api_client.post(reverse("order-list"), cart(restaurant, menu_item), format="json")

    assert (staff.status_code, guest.status_code) == (405, 403)
    assert Order.objects.count() == 0


def test_the_old_per_order_payment_endpoints_are_gone(api_client, order):
    for path in (f"/api/orders/{order.pk}/paypal/create/", f"/api/orders/{order.pk}/paypal/capture/"):
        assert api_client.post(path).status_code == 404


def test_abandoning_a_checkout_leaves_no_order(api_client, restaurant, menu_item, fake_paypal):
    start(api_client, cart(restaurant, menu_item))

    assert Order.objects.count() == 0


# Expiry


def age(draft, hours):
    CheckoutDraft.objects.filter(pk=draft.pk).update(created_at=timezone.now() - timedelta(hours=hours))


def test_purge_deletes_old_drafts_and_keeps_recent_ones_and_orders(
    api_client, restaurant, menu_item, fake_paypal
):
    start(api_client, cart(restaurant, menu_item))
    start(api_client, cart(restaurant, menu_item))
    old, recent = CheckoutDraft.objects.order_by("id")
    age(old, 48)
    age(recent, 1)
    Order.objects.create(restaurant=restaurant, customer_name="Kept")

    out = StringIO()
    call_command("purge_checkout_drafts", stdout=out)

    assert list(CheckoutDraft.objects.all()) == [recent]
    assert CheckoutDraftItem.objects.count() == 1
    assert Order.objects.count() == 1
    assert "1 drafts remain" in out.getvalue()


def test_purge_takes_the_age_in_hours(api_client, restaurant, menu_item, fake_paypal):
    start(api_client, cart(restaurant, menu_item))
    age(CheckoutDraft.objects.get(), 3)

    call_command("purge_checkout_drafts", older_than_hours=2, stdout=StringIO())

    assert CheckoutDraft.objects.count() == 0


def test_a_recent_draft_can_still_be_completed_after_a_purge(api_client, restaurant, menu_item, fake_paypal):
    started = start(api_client, cart(restaurant, menu_item)).json()
    call_command("purge_checkout_drafts", stdout=StringIO())

    assert capture(api_client, started["paypal_order_id"]).status_code == 201


def test_a_purged_draft_cannot_be_completed(api_client, restaurant, menu_item, fake_paypal):
    started = start(api_client, cart(restaurant, menu_item)).json()
    age(CheckoutDraft.objects.get(), 48)
    call_command("purge_checkout_drafts", stdout=StringIO())

    response = capture(api_client, started["paypal_order_id"])

    assert response.status_code == 404
    assert Order.objects.count() == 0


# The client secret


@pytest.fixture
def failing_paypal(monkeypatch, settings):
    """The real PayPalClient, holding a known secret, over a transport that fails."""
    settings.PAYPAL_CLIENT_SECRET = SECRET

    def handler(request):
        # PayPal answering with an error is the path most likely to echo a secret.
        return httpx.Response(401, text=f"bad credentials: {SECRET}")

    http = httpx.Client(transport=httpx.MockTransport(handler))
    client = paypal.PayPalClient("the-id", SECRET, "https://paypal.test", http=http)
    monkeypatch.setattr(paypal, "get_client", lambda: client)


def test_payment_errors_never_contain_the_client_secret(
    api_client, restaurant, menu_item, failing_paypal, caplog
):
    started = start(api_client, cart(restaurant, menu_item))
    draft = CheckoutDraft.objects.create(
        restaurant=restaurant, customer_name="Sam", total=Decimal("1.00"), paypal_order_id="PP-1"
    )
    CheckoutDraftItem.objects.create(
        draft=draft, menu_item=menu_item, quantity=1, unit_price=Decimal("1.00")
    )
    captured = capture(api_client, "PP-1")

    assert (started.status_code, captured.status_code) == (502, 502)
    for response in (started, captured):
        assert SECRET not in response.content.decode()
    assert SECRET not in caplog.text


def test_successful_responses_never_contain_the_client_secret(
    api_client, restaurant, menu_item, fake_paypal, settings
):
    settings.PAYPAL_CLIENT_SECRET = SECRET

    started = start(api_client, cart(restaurant, menu_item))
    captured = capture(api_client, started.json()["paypal_order_id"])

    assert (started.status_code, captured.status_code) == (200, 201)
    assert SECRET not in started.content.decode() + captured.content.decode()
