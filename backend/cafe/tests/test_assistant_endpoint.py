from decimal import Decimal

import anthropic
import httpx2
import pytest
from django.urls import reverse
from rest_framework.throttling import ScopedRateThrottle

from cafe import assistant
from cafe.assistant import (
    EMPTY_MENU_REPLY,
    REFUSAL_REPLY,
    AssistantClient,
    AssistantError,
    AssistantResult,
)
from cafe.models import MenuItem, Order, OrderItem


pytestmark = pytest.mark.django_db


def assistant_payload(restaurant):
    return {
        "restaurant": restaurant.pk,
        "messages": [{"role": "user", "content": "Suggest something light."}],
    }


def test_assistant_endpoint_returns_reply_and_suggestion_shape(
    api_client, restaurant, menu_item, fake_assistant
):
    fake_assistant.result = AssistantResult(
        "Try the noodles.",
        [{"menu_item_id": menu_item.pk, "quantity": 2}],
    )

    response = api_client.post(
        reverse("assistant"), assistant_payload(restaurant), format="json"
    )

    assert response.status_code == 200
    assert response.json() == {
        "reply": "Try the noodles.",
        "suggestions": [
            {"menu_item": menu_item.pk, "name": "Noodles", "quantity": 2}
        ],
    }
    assert fake_assistant.calls[0][1] == [
        {"role": "user", "content": "Suggest something light."}
    ]


def test_assistant_receives_only_available_restaurant_menu_items(
    api_client, restaurant, menu_item, fake_assistant
):
    unavailable_item = MenuItem.objects.create(
        restaurant=restaurant,
        name="Unavailable",
        price=Decimal("3.50"),
        is_available=False,
    )

    response = api_client.post(
        reverse("assistant"), assistant_payload(restaurant), format="json"
    )

    assert response.status_code == 200
    assert fake_assistant.calls[0][0] == [
        {
            "id": menu_item.pk,
            "name": "Noodles",
            "description": "",
            "price": "9.99",
        }
    ]
    assert unavailable_item.pk not in {
        item["id"] for item in fake_assistant.calls[0][0]
    }


def test_assistant_returns_fixed_reply_without_call_when_menu_is_empty(
    api_client, restaurant, menu_item, fake_assistant
):
    menu_item.is_available = False
    menu_item.save(update_fields=["is_available"])

    response = api_client.post(
        reverse("assistant"), assistant_payload(restaurant), format="json"
    )

    assert response.status_code == 200
    assert response.json() == {"reply": EMPTY_MENU_REPLY, "suggestions": []}
    assert fake_assistant.calls == []


def test_assistant_drops_unknown_suggestions_and_clamps_valid_quantity(
    api_client, restaurant, menu_item, fake_assistant
):
    fake_assistant.result = AssistantResult(
        "Here are some ideas.",
        [
            {"menu_item_id": 9999, "quantity": 500},
            {"menu_item_id": menu_item.pk, "quantity": 500},
        ],
    )

    response = api_client.post(
        reverse("assistant"), assistant_payload(restaurant), format="json"
    )

    assert response.status_code == 200
    assert response.json()["suggestions"] == [
        {"menu_item": menu_item.pk, "name": "Noodles", "quantity": 10}
    ]
    assert fake_assistant.calls[0][0][0]["id"] == menu_item.pk
    assert Order.objects.count() == 0


# --- failures (s18 task 3.3) -------------------------------------------------

SECRET = "sk-ant-the-secret-key"


@pytest.fixture
def failing_assistant(monkeypatch, settings):
    """The real AssistantClient, holding a known key, over a transport that fails."""
    settings.ANTHROPIC_API_KEY = SECRET

    def handler(request):
        # The provider answering with an error is the path most likely to echo a key.
        return httpx2.Response(
            401,
            json={
                "type": "error",
                "error": {"type": "authentication_error", "message": f"bad key {SECRET}"},
            },
        )

    http = anthropic.DefaultHttpxClient(transport=httpx2.MockTransport(handler))
    sdk = anthropic.Anthropic(api_key=SECRET, http_client=http, max_retries=0)
    client = AssistantClient(SECRET, "claude-haiku-5-5", client=sdk)
    monkeypatch.setattr(assistant, "get_client", lambda: client)


def test_assistant_answers_503_when_it_is_not_configured(
    api_client, restaurant, menu_item, settings
):
    # No fake here: the real get_client() runs and finds no key.
    settings.ANTHROPIC_API_KEY = ""

    response = api_client.post(
        reverse("assistant"), assistant_payload(restaurant), format="json"
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "The assistant is not configured."}


def test_other_endpoints_keep_working_when_the_assistant_is_not_configured(
    api_client, restaurant, menu_item, settings
):
    settings.ANTHROPIC_API_KEY = ""
    api_client.post(reverse("assistant"), assistant_payload(restaurant), format="json")

    assert api_client.get(reverse("menuitem-list")).status_code == 200
    assert api_client.get(reverse("restaurant-list")).status_code == 200
    assert api_client.get(reverse("health-ready")).status_code == 200


def test_assistant_answers_502_with_a_fixed_message_when_claude_fails(
    api_client, restaurant, menu_item, fake_assistant
):
    fake_assistant.error = AssistantError("Claude request failed (APIConnectionError)")

    response = api_client.post(
        reverse("assistant"), assistant_payload(restaurant), format="json"
    )

    assert response.status_code == 502
    assert response.json() == {"detail": "The assistant could not answer. Please try again."}
    assert "APIConnectionError" not in response.content.decode()


def test_assistant_passes_a_refusal_through_as_a_normal_reply_without_suggestions(
    api_client, restaurant, menu_item, fake_assistant
):
    fake_assistant.result = AssistantResult(REFUSAL_REPLY, [])

    response = api_client.post(
        reverse("assistant"), assistant_payload(restaurant), format="json"
    )

    assert response.status_code == 200
    assert response.json() == {"reply": REFUSAL_REPLY, "suggestions": []}


def test_assistant_errors_never_contain_the_api_key(
    api_client, restaurant, menu_item, failing_assistant, caplog
):
    response = api_client.post(
        reverse("assistant"), assistant_payload(restaurant), format="json"
    )

    assert response.status_code == 502
    assert SECRET not in response.content.decode()
    assert SECRET not in caplog.text


def test_successful_assistant_responses_never_contain_the_api_key(
    api_client, restaurant, menu_item, fake_assistant, settings
):
    settings.ANTHROPIC_API_KEY = SECRET
    fake_assistant.result = AssistantResult(
        "Try the noodles.", [{"menu_item_id": menu_item.pk, "quantity": 1}]
    )

    response = api_client.post(
        reverse("assistant"), assistant_payload(restaurant), format="json"
    )

    assert response.status_code == 200
    assert SECRET not in response.content.decode()


# --- rate limit (s18 task 3.4) -----------------------------------------------


@pytest.fixture
def two_a_minute(monkeypatch):
    # DRF reads its rate table once, when the module is imported, so overriding the
    # Django setting in a test changes nothing: patch the class attribute instead.
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", {"assistant": "2/min"})


def ask_assistant(api_client, restaurant, **extra):
    return api_client.post(
        reverse("assistant"), assistant_payload(restaurant), format="json", **extra
    )


def test_the_default_limit_is_twenty_a_minute():
    assert ScopedRateThrottle.THROTTLE_RATES["assistant"] == "20/min"


def test_assistant_answers_429_over_the_limit_and_does_not_call_claude_for_it(
    api_client, restaurant, menu_item, fake_assistant, two_a_minute
):
    statuses = [ask_assistant(api_client, restaurant).status_code for _ in range(3)]

    assert statuses == [200, 200, 429]
    assert len(fake_assistant.calls) == 2


def test_the_429_response_says_how_long_to_wait(
    api_client, restaurant, menu_item, fake_assistant, two_a_minute
):
    for _ in range(2):
        ask_assistant(api_client, restaurant)

    response = ask_assistant(api_client, restaurant)

    assert response.status_code == 429
    assert int(response.headers["Retry-After"]) > 0


def test_the_limit_is_per_client(
    api_client, restaurant, menu_item, fake_assistant, two_a_minute
):
    for _ in range(3):
        ask_assistant(api_client, restaurant)

    other_client = ask_assistant(api_client, restaurant, REMOTE_ADDR="10.0.0.2")

    assert other_client.status_code == 200


def test_other_endpoints_are_not_limited_when_the_assistant_is(
    api_client, restaurant, menu_item, fake_assistant, two_a_minute
):
    for _ in range(3):
        ask_assistant(api_client, restaurant)

    assert api_client.get(reverse("menuitem-list")).status_code == 200
    assert api_client.get(reverse("restaurant-list")).status_code == 200


def test_an_over_limit_request_is_refused_before_it_is_even_validated(
    api_client, restaurant, menu_item, fake_assistant, two_a_minute
):
    for _ in range(2):
        ask_assistant(api_client, restaurant)

    response = api_client.post(reverse("assistant"), {"messages": []}, format="json")

    assert response.status_code == 429


# --- no side effects (s18 task 3.5) ------------------------------------------


def assert_nothing_ordered_or_paid(fake_paypal):
    assert Order.objects.count() == 0
    assert OrderItem.objects.count() == 0
    assert fake_paypal.created == []
    assert fake_paypal.captured == []


def test_a_suggestion_creates_no_order_and_calls_no_paypal(
    api_client, restaurant, menu_item, fake_assistant, fake_paypal
):
    # A real suggestion, so a view that turned suggestions into an order would show it.
    fake_assistant.result = AssistantResult(
        "Try the noodles.", [{"menu_item_id": menu_item.pk, "quantity": 2}]
    )

    response = ask_assistant(api_client, restaurant)

    assert response.status_code == 200
    assert len(response.json()["suggestions"]) == 1
    assert_nothing_ordered_or_paid(fake_paypal)


def test_a_refusal_creates_no_order_and_calls_no_paypal(
    api_client, restaurant, menu_item, fake_assistant, fake_paypal
):
    fake_assistant.result = AssistantResult(REFUSAL_REPLY, [])

    response = ask_assistant(api_client, restaurant)

    assert response.status_code == 200
    assert_nothing_ordered_or_paid(fake_paypal)


def test_an_empty_menu_creates_no_order_and_calls_no_paypal(
    api_client, restaurant, menu_item, fake_assistant, fake_paypal
):
    menu_item.is_available = False
    menu_item.save(update_fields=["is_available"])

    response = ask_assistant(api_client, restaurant)

    assert response.status_code == 200
    assert_nothing_ordered_or_paid(fake_paypal)


def test_a_failed_answer_creates_no_order_and_calls_no_paypal(
    api_client, restaurant, menu_item, fake_assistant, fake_paypal
):
    fake_assistant.error = AssistantError("Claude request failed (APIConnectionError)")

    response = ask_assistant(api_client, restaurant)

    assert response.status_code == 502
    assert_nothing_ordered_or_paid(fake_paypal)
