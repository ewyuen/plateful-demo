from decimal import Decimal


def total_for(lines, delivery_fee) -> Decimal:
    """What the customer pays: the lines plus the delivery fee.

    `lines` is any iterable of objects with `unit_price` and `quantity` (order items or
    checkout draft items). The one place the arithmetic lives, so the amount PayPal is
    asked for and the total on the order that follows can never disagree.
    """
    items = sum((line.unit_price * line.quantity for line in lines), Decimal("0.00"))
    return items + delivery_fee


def order_total(order) -> Decimal:
    """The total of a stored order, from stored values only.

    Reads `order.items.all()`, so it uses rows that were prefetched.
    """
    return total_for(order.items.all(), order.delivery_fee)
