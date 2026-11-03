import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

pytestmark = pytest.mark.django_db(transaction=True)


def migrate(targets):
    executor = MigrationExecutor(connection)
    executor.migrate(targets)
    return MigrationExecutor(connection).loader.project_state(targets).apps


def test_orders_from_before_checkout_first_payment_stay_valid():
    old = migrate([("cafe", "0005_delivery")])
    try:
        restaurant = old.get_model("cafe", "Restaurant").objects.create(name="Corner Kitchen", address="x")
        Order = old.get_model("cafe", "Order")
        Order.objects.create(restaurant=restaurant, customer_name="Ann", status="pending")
        Order.objects.create(
            restaurant=restaurant, customer_name="Bo", status="confirmed",
            payment_status="paid", paypal_order_id="PP-OLD",
        )

        new = migrate([("cafe", "0006_checkout_drafts_and_payer")])

        orders = list(new.get_model("cafe", "Order").objects.order_by("id"))
        assert [o.status for o in orders] == ["pending", "confirmed"]
        assert [(o.payer_email, o.payer_id, o.paypal_capture_id) for o in orders] == [("", "", "")] * 2
        assert orders[1].paypal_order_id == "PP-OLD"
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
