"""PayPal Orders v2 client (ADR-0011).

Views never talk to PayPal directly: they call get_client(), which tests replace
with a fake. Every failure on the way to PayPal becomes one PayPalError.
"""

from dataclasses import dataclass
from decimal import Decimal

import httpx
from django.conf import settings

CURRENCY = "USD"
TIMEOUT_SECONDS = 10.0


class PayPalError(Exception):
    """PayPal could not be reached or answered with an error.

    `status` and `issue` (PayPal's error name, such as INSTRUMENT_DECLINED) are set when
    PayPal answered; the message never holds the request, which may carry the secret.
    """

    def __init__(self, message="", status=None, issue=""):
        super().__init__(message)
        self.status = status
        self.issue = issue


@dataclass(frozen=True)
class CaptureResult:
    """What a capture told us. The payer fields are empty when PayPal does not return them."""

    completed: bool
    capture_id: str = ""
    payer_email: str = ""
    payer_id: str = ""


class PayPalNotConfigured(Exception):
    """The client ID or secret is missing."""


class PayPalClient:
    def __init__(self, client_id, client_secret, base_url, http=None):
        self.client_id = client_id
        self.client_secret = client_secret
        self.base_url = base_url
        self.http = http or httpx.Client(timeout=TIMEOUT_SECONDS)

    def _send(self, method, path, **kwargs):
        try:
            response = self.http.request(method, f"{self.base_url}{path}", **kwargs)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as error:
            # Only the exception type goes into the message: the request may hold
            # the client secret, and it must not reach a log or a response.
            raise PayPalError(
                f"PayPal request failed ({type(error).__name__})",
                status=error.response.status_code,
                issue=_issue(error.response),
            ) from None
        except (httpx.HTTPError, ValueError) as error:
            raise PayPalError(f"PayPal request failed ({type(error).__name__})") from None

    def _token(self):
        data = self._send(
            "POST",
            "/v1/oauth2/token",
            auth=(self.client_id, self.client_secret),
            data={"grant_type": "client_credentials"},
        )
        return data["access_token"]

    def _authorized(self, method, path, **kwargs):
        # PayPal accepts a capture with an empty JSON body; httpx then sets no
        # content type, so send the JSON one explicitly on every call.
        headers = {"Authorization": f"Bearer {self._token()}", "Content-Type": "application/json"}
        return self._send(method, path, headers=headers, **kwargs)

    def create_order(self, amount: Decimal, reference: str) -> str:
        """Create a PayPal order for `amount` and return its id."""
        data = self._authorized(
            "POST",
            "/v2/checkout/orders",
            json={
                "intent": "CAPTURE",
                "purchase_units": [
                    {
                        "reference_id": reference,
                        "amount": {"currency_code": CURRENCY, "value": f"{amount:.2f}"},
                    }
                ],
            },
        )
        return data["id"]

    def capture_order(self, paypal_order_id: str) -> CaptureResult:
        """Capture an approved PayPal order.

        A decline (PayPal answers 422, for example INSTRUMENT_DECLINED) is a result with
        `completed` False, not an error. If PayPal says the order was already captured
        (an earlier request got that far and our side failed), the order is read instead
        and reported as it stands, so the buyer who already paid can still get an order.
        """
        try:
            data = self._authorized("POST", f"/v2/checkout/orders/{paypal_order_id}/capture")
        except PayPalError as error:
            if error.status != 422:
                raise
            if error.issue != "ORDER_ALREADY_CAPTURED":
                return CaptureResult(completed=False)
            data = self._authorized("GET", f"/v2/checkout/orders/{paypal_order_id}")
        return _capture_result(data)


def _issue(response) -> str:
    """PayPal's error name from an error response, or an empty string."""
    try:
        details = response.json().get("details") or []
        return str(details[0].get("issue", "")) if details else str(response.json().get("name", ""))
    except (ValueError, AttributeError, IndexError):
        return ""


def _capture_result(data: dict) -> CaptureResult:
    payer = data.get("payer") or {}
    units = data.get("purchase_units") or [{}]
    captures = (units[0].get("payments") or {}).get("captures") or [{}]
    return CaptureResult(
        completed=data.get("status") == "COMPLETED",
        capture_id=str(captures[0].get("id", "")),
        payer_email=str(payer.get("email_address", "")),
        payer_id=str(payer.get("payer_id", "")),
    )


def get_client():
    """The one place views get a client from, so tests can swap it."""
    if not settings.PAYPAL_CLIENT_ID or not settings.PAYPAL_CLIENT_SECRET:
        raise PayPalNotConfigured("PayPal is not configured.")
    return PayPalClient(
        settings.PAYPAL_CLIENT_ID, settings.PAYPAL_CLIENT_SECRET, settings.PAYPAL_API_BASE
    )
