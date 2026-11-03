from cafe.paypal import CaptureResult, PayPalError


class FakePayPal:
    """Stands in for PayPalClient. Records calls so a test can count them."""

    def __init__(self):
        self.created = []  # (amount, reference) for each create_order call
        self.captured = []  # paypal order id for each capture_order call
        self.next_id = None  # a fixed id for every create; by default PP-FAKE-1, PP-FAKE-2, ...
        self.capture_completes = True
        self.capture_id = "CAP-FAKE-1"
        self.payer_email = "buyer@example.com"
        self.payer_id = "PAYER-FAKE-1"
        self.fail_with = None  # set to a PayPalError to make every call raise

    def create_order(self, amount, reference):
        if self.fail_with:
            raise self.fail_with
        self.created.append((amount, reference))
        return self.next_id or f"PP-FAKE-{len(self.created)}"

    def capture_order(self, paypal_order_id):
        if self.fail_with:
            raise self.fail_with
        self.captured.append(paypal_order_id)
        return CaptureResult(
            completed=self.capture_completes,
            capture_id=self.capture_id,
            payer_email=self.payer_email,
            payer_id=self.payer_id,
        )

    def unreachable(self):
        self.fail_with = PayPalError("PayPal request failed (ConnectError)")


class FakeAssistant:
    """Stands in for AssistantClient. Records what views give it."""

    def __init__(self):
        from cafe.assistant import AssistantResult

        self.calls = []  # (menu, messages) for each ask call
        self.result = AssistantResult("Try the noodles.", [])
        self.error = None  # set to an exception to make ask raise it

    def ask(self, menu, messages):
        self.calls.append((menu, messages))
        if self.error:
            raise self.error
        return self.result
