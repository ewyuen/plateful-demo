import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

BEFORE = [("cafe", "0003_marketplace_fields")]
AFTER = [("cafe", "0004_order_workflow_statuses")]


def migrate(targets):
    executor = MigrationExecutor(connection)
    executor.migrate(targets)
    return MigrationExecutor(connection).loader.project_state(targets).apps


@pytest.fixture
def restore_latest():
    yield
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())


@pytest.mark.django_db(transaction=True)
def test_orders_paid_before_the_workflow_are_confirmed_and_unpaid_ones_are_not(restore_latest):
    old = migrate(BEFORE)
    restaurant = old.get_model("cafe", "Restaurant").objects.create(name="Corner Kitchen", address="x")
    Order = old.get_model("cafe", "Order")
    paid = Order.objects.create(
        restaurant=restaurant, customer_name="Sam", payment_status="paid", status="pending"
    )
    unpaid = Order.objects.create(restaurant=restaurant, customer_name="Ann", status="pending")
    failed = Order.objects.create(
        restaurant=restaurant, customer_name="Lee", payment_status="failed", status="pending"
    )
    ready = Order.objects.create(
        restaurant=restaurant, customer_name="Jo", payment_status="paid", status="ready"
    )

    new = migrate(AFTER)

    NewOrder = new.get_model("cafe", "Order")
    assert NewOrder.objects.get(pk=paid.pk).status == "confirmed"
    assert NewOrder.objects.get(pk=unpaid.pk).status == "pending"
    assert NewOrder.objects.get(pk=failed.pk).status == "pending"
    assert NewOrder.objects.get(pk=ready.pk).status == "ready"


@pytest.mark.django_db(transaction=True)
def test_the_workflow_migration_can_be_reversed_without_losing_orders(restore_latest):
    new = migrate(AFTER)
    restaurant = new.get_model("cafe", "Restaurant").objects.create(name="Corner Kitchen", address="x")
    new.get_model("cafe", "Order").objects.create(
        restaurant=restaurant, customer_name="Sam", status="preparing"
    )

    old = migrate(BEFORE)

    assert old.get_model("cafe", "Order").objects.count() == 1
