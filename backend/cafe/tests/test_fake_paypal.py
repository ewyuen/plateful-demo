from decimal import Decimal

import pytest

from cafe import paypal
from cafe.paypal import PayPalError


def test_fixture_swaps_the_client_views_get(fake_paypal):
    assert paypal.get_client() is fake_paypal


def test_fake_records_calls_and_returns_its_ids(fake_paypal):
    assert fake_paypal.create_order(Decimal("5.00"), "order-1") == "PP-FAKE-1"
    assert fake_paypal.capture_order("PP-FAKE-1").completed is True
    assert fake_paypal.created == [(Decimal("5.00"), "order-1")]
    assert fake_paypal.captured == ["PP-FAKE-1"]


def test_unreachable_makes_every_call_raise(fake_paypal):
    fake_paypal.unreachable()

    with pytest.raises(PayPalError):
        fake_paypal.create_order(Decimal("1"), "o")
    with pytest.raises(PayPalError):
        fake_paypal.capture_order("PP")
