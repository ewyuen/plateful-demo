"""The steps an order moves through (ADR-0015). One definition, used by the transition
endpoint, the queue and the tests.

Pickup: pending, confirmed, preparing, ready, completed. Delivery has one more step after
ready: out_for_delivery, then completed. Cancelled is possible from pending, confirmed and
preparing. An order becomes confirmed by being paid, not by a step, so pending allows only
cancelled here.
"""

from .models import Order

S = Order.Status

NEXT_STATUSES = {
    S.PENDING: (S.CANCELLED,),
    S.CONFIRMED: (S.PREPARING, S.CANCELLED),
    S.PREPARING: (S.READY, S.CANCELLED),
    S.READY: (S.COMPLETED,),
    S.OUT_FOR_DELIVERY: (S.COMPLETED,),
    S.COMPLETED: (),
    S.CANCELLED: (),
}

# What the kitchen still has to work on. Completed and cancelled orders are done.
ACTIVE_STATUSES = (S.CONFIRMED, S.PREPARING, S.READY, S.OUT_FOR_DELIVERY)

# Orders that have entered the queue: everything except pending (unpaid).
QUEUE_STATUSES = (
    S.CONFIRMED,
    S.PREPARING,
    S.READY,
    S.OUT_FOR_DELIVERY,
    S.COMPLETED,
    S.CANCELLED,
)


def allowed_next(status, fulfilment_type=Order.FulfilmentType.PICKUP):
    """The statuses an order in `status` may move to, as plain strings.

    A delivery order that is ready goes out for delivery; a pickup order cannot, and
    out_for_delivery is only ever reached by delivery orders.
    """
    steps = NEXT_STATUSES[S(status)]
    if S(status) == S.READY and fulfilment_type == Order.FulfilmentType.DELIVERY:
        steps = (S.OUT_FOR_DELIVERY,)
    return [str(step.value) for step in steps]
