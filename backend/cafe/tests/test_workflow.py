import pytest

from cafe.models import Order
from cafe.workflow import ACTIVE_STATUSES, NEXT_STATUSES, QUEUE_STATUSES, allowed_next

S = Order.Status


def test_every_status_has_an_entry():
    assert set(NEXT_STATUSES) == set(Order.Status)


@pytest.mark.parametrize(
    ("status", "next_steps"),
    [
        (S.PENDING, ["cancelled"]),
        (S.CONFIRMED, ["preparing", "cancelled"]),
        (S.PREPARING, ["ready", "cancelled"]),
        (S.READY, ["completed"]),
        (S.COMPLETED, []),
        (S.CANCELLED, []),
    ],
)
def test_next_steps(status, next_steps):
    assert allowed_next(status) == next_steps


def test_allowed_next_accepts_a_plain_string_and_returns_plain_strings():
    steps = allowed_next("confirmed")

    assert steps == ["preparing", "cancelled"]
    assert all(type(step) is str for step in steps)


def test_cancelling_is_possible_only_before_ready():
    cancellable = [s for s in Order.Status if S.CANCELLED in NEXT_STATUSES[s]]

    assert cancellable == [S.PENDING, S.CONFIRMED, S.PREPARING]


def test_final_statuses_are_final():
    assert allowed_next(S.COMPLETED) == [] and allowed_next(S.CANCELLED) == []


def test_the_queue_holds_everything_except_pending_and_active_is_a_subset():
    assert S.PENDING not in QUEUE_STATUSES
    assert set(QUEUE_STATUSES) | {S.PENDING} == set(Order.Status)
    assert set(ACTIVE_STATUSES) <= set(QUEUE_STATUSES)
    assert S.COMPLETED not in ACTIVE_STATUSES and S.CANCELLED not in ACTIVE_STATUSES
