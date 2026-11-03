import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from cafe import codes

pytestmark = pytest.mark.django_db(transaction=True)


def migrate(targets):
    executor = MigrationExecutor(connection)
    executor.migrate(targets)
    return MigrationExecutor(connection).loader.project_state(targets).apps


def test_paid_orders_get_codes_and_unpaid_ones_are_deleted():
    old = migrate([("cafe", "0008_staff_groups")])
    try:
        Restaurant = old.get_model("cafe", "Restaurant")
        Order = old.get_model("cafe", "Order")
        MenuItem = old.get_model("cafe", "MenuItem")
        OrderItem = old.get_model("cafe", "OrderItem")
        restaurant = Restaurant.objects.create(name="Corner Kitchen", address="x")
        dish = MenuItem.objects.create(restaurant=restaurant, name="Noodles", price="9.99")
        paid = [
            Order.objects.create(restaurant=restaurant, customer_name=name, status="confirmed", payment_status="paid")
            for name in ("Ann", "Bo", "Cy")
        ]
        pending = Order.objects.create(restaurant=restaurant, customer_name="Dee", payment_status="pending")
        failed = Order.objects.create(restaurant=restaurant, customer_name="Eve", payment_status="failed")
        OrderItem.objects.create(order=pending, menu_item=dish, quantity=1, unit_price="9.99")
        OrderItem.objects.create(order=paid[0], menu_item=dish, quantity=2, unit_price="9.99")

        new = migrate([("cafe", "0009_order_public_code")])

        orders = list(new.get_model("cafe", "Order").objects.order_by("id"))
        assert [o.customer_name for o in orders] == ["Ann", "Bo", "Cy"]
        assert len({o.public_code for o in orders}) == 3
        assert all(codes.normalize(o.public_code) == o.public_code for o in orders)
        assert not new.get_model("cafe", "Order").objects.filter(pk__in=[pending.pk, failed.pk]).exists()
        items = new.get_model("cafe", "OrderItem").objects.all()
        assert [(i.order_id, i.quantity) for i in items] == [(paid[0].pk, 2)]
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())


def test_new_orders_always_get_a_code(restaurant):
    from cafe.models import Order

    first = Order.objects.create(restaurant=restaurant, customer_name="A")
    second = Order.objects.create(restaurant=restaurant, customer_name="B")

    assert first.public_code != second.public_code
    assert codes.normalize(first.public_code) == first.public_code
