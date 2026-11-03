import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

pytestmark = pytest.mark.django_db(transaction=True)


def migrate(targets):
    executor = MigrationExecutor(connection)
    executor.migrate(targets)
    return MigrationExecutor(connection).loader.project_state(targets).apps


def test_orders_keep_working_and_the_customer_group_comes_and_goes():
    old = migrate([("cafe", "0009_order_public_code")])
    try:
        Group = old.get_model("auth", "Group")
        assert not Group.objects.filter(name="customer").exists()
        Restaurant = old.get_model("cafe", "Restaurant")
        Order = old.get_model("cafe", "Order")
        restaurant = Restaurant.objects.create(name="Corner Kitchen", address="x")
        guest = Order.objects.create(restaurant=restaurant, customer_name="Guest", payment_status="paid", status="confirmed")

        new = migrate([("cafe", "0011_customer_group")])

        assert new.get_model("auth", "Group").objects.filter(name="customer").count() == 1
        kept = new.get_model("cafe", "Order").objects.get(pk=guest.pk)
        assert kept.customer_id is None and kept.public_code == guest.public_code
    finally:
        migrate(MigrationExecutor(connection).loader.graph.leaf_nodes())
