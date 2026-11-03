import json
from decimal import Decimal

import httpx
import pytest

from cafe.paypal import CaptureResult, PayPalClient, PayPalError, PayPalNotConfigured, get_client

BASE = "https://paypal.test"


def make_client(handler):
    """A PayPalClient whose HTTP calls go to `handler` instead of the network."""
    http = httpx.Client(transport=httpx.MockTransport(handler))
    return PayPalClient("the-id", "the-secret", BASE, http=http)


def paypal_handler(requests, create_status=201, capture_body=None):
    def handler(request):
        requests.append(request)
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json={"access_token": "tok"})
        if request.url.path == "/v2/checkout/orders":
            return httpx.Response(create_status, json={"id": "PP-1"})
        body = {"status": "COMPLETED"} if capture_body is None else capture_body
        return httpx.Response(201, json=body)

    return handler


def test_create_order_sends_the_amount_with_two_places_and_returns_the_id():
    requests = []
    client = make_client(paypal_handler(requests))

    paypal_id = client.create_order(Decimal("24.9"), "order-7")

    assert paypal_id == "PP-1"
    sent = json.loads(requests[-1].content)
    assert sent["purchase_units"][0]["amount"] == {"currency_code": "USD", "value": "24.90"}
    assert sent["purchase_units"][0]["reference_id"] == "order-7"
    assert requests[-1].headers["Authorization"] == "Bearer tok"


def test_token_request_uses_the_client_credentials():
    requests = []
    make_client(paypal_handler(requests)).create_order(Decimal("1"), "o")

    token_request = requests[0]
    assert token_request.headers["Authorization"].startswith("Basic ")
    assert b"grant_type=client_credentials" in token_request.content


@pytest.mark.parametrize(
    ("body", "expected"),
    [
        ({"status": "COMPLETED"}, True),
        ({"status": "DECLINED"}, False),
        ({"status": "PAYER_ACTION_REQUIRED"}, False),
        ({}, False),
    ],
)
def test_capture_is_true_only_when_paypal_says_completed(body, expected):
    client = make_client(paypal_handler([], capture_body=body))

    assert client.capture_order("PP-1").completed is expected


def test_a_non_2xx_answer_becomes_paypal_error():
    client = make_client(paypal_handler([], create_status=422))

    with pytest.raises(PayPalError):
        client.create_order(Decimal("1"), "o")


def test_a_network_failure_becomes_paypal_error_without_the_secret():
    def handler(request):
        raise httpx.ConnectError("boom", request=request)

    with pytest.raises(PayPalError) as caught:
        make_client(handler).create_order(Decimal("1"), "o")

    assert "the-secret" not in str(caught.value)


def test_a_non_json_answer_becomes_paypal_error():
    def handler(request):
        return httpx.Response(200, text="<html>not json</html>")

    with pytest.raises(PayPalError):
        make_client(handler).create_order(Decimal("1"), "o")


def test_get_client_requires_the_credentials(settings):
    settings.PAYPAL_CLIENT_ID = ""
    settings.PAYPAL_CLIENT_SECRET = ""

    with pytest.raises(PayPalNotConfigured):
        get_client()


def test_get_client_uses_the_configured_values(settings):
    settings.PAYPAL_CLIENT_ID = "id"
    settings.PAYPAL_CLIENT_SECRET = "secret"
    settings.PAYPAL_API_BASE = "https://paypal.example"

    client = get_client()

    assert (client.client_id, client.client_secret, client.base_url) == (
        "id",
        "secret",
        "https://paypal.example",
    )


FULL_CAPTURE = {
    "status": "COMPLETED",
    "payer": {"email_address": "buyer@example.com", "payer_id": "PAYER1"},
    "purchase_units": [{"payments": {"captures": [{"id": "CAP-1"}]}}],
}


def test_capture_returns_the_payer_and_the_capture_id():
    client = make_client(paypal_handler([], capture_body=FULL_CAPTURE))

    assert client.capture_order("PP-1") == CaptureResult(
        completed=True, capture_id="CAP-1", payer_email="buyer@example.com", payer_id="PAYER1"
    )


def test_capture_leaves_the_payer_empty_when_paypal_sends_none():
    client = make_client(paypal_handler([], capture_body={"status": "COMPLETED"}))

    assert client.capture_order("PP-1") == CaptureResult(completed=True)


def capture_error_handler(status, body, order_body=None):
    """PayPal answers the capture with an error; a GET of the order answers `order_body`."""

    def handler(request):
        if request.url.path == "/v1/oauth2/token":
            return httpx.Response(200, json={"access_token": "tok"})
        if request.method == "GET":
            return httpx.Response(200, json=order_body or {})
        return httpx.Response(status, json=body)

    return handler


def test_a_declined_capture_is_a_result_not_an_error():
    body = {"name": "UNPROCESSABLE_ENTITY", "details": [{"issue": "INSTRUMENT_DECLINED"}]}
    client = make_client(capture_error_handler(422, body))

    assert client.capture_order("PP-1") == CaptureResult(completed=False)


def test_an_already_captured_order_is_read_and_reported_as_it_stands():
    body = {"name": "UNPROCESSABLE_ENTITY", "details": [{"issue": "ORDER_ALREADY_CAPTURED"}]}
    client = make_client(capture_error_handler(422, body, order_body=FULL_CAPTURE))

    assert client.capture_order("PP-1").completed is True
    assert client.capture_order("PP-1").capture_id == "CAP-1"


def test_another_error_status_on_capture_is_still_an_error():
    client = make_client(capture_error_handler(500, {"name": "INTERNAL_SERVER_ERROR"}))

    with pytest.raises(PayPalError) as caught:
        client.capture_order("PP-1")

    assert caught.value.status == 500


def test_an_error_carries_paypals_status_and_issue_but_not_the_secret():
    body = {"name": "UNPROCESSABLE_ENTITY", "details": [{"issue": "SOMETHING"}]}
    client = make_client(capture_error_handler(422, body))

    with pytest.raises(PayPalError) as caught:
        client._authorized("POST", "/v2/checkout/orders")

    assert (caught.value.status, caught.value.issue) == (422, "SOMETHING")
    assert "the-secret" not in str(caught.value)
