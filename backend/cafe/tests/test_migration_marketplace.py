import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

BEFORE = [("cafe", "0002_order_payment_status_order_paypal_order_id")]
AFTER = [("cafe", "0003_marketplace_fields")]


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
def test_existing_rows_survive_the_marketplace_migration(restore_latest):
    old = migrate(BEFORE)
    restaurant = old.get_model("cafe", "Restaurant").objects.create(
        name="Corner Kitchen", address="1 Main St"
    )
    old.get_model("cafe", "MenuItem").objects.create(
        restaurant=restaurant, name="Noodles", price="9.99"
    )

    new = migrate(AFTER)

    restaurant = new.get_model("cafe", "Restaurant").objects.get(name="Corner Kitchen")
    assert (restaurant.cuisine, restaurant.description, restaurant.image_url) == ("", "", "")
    assert new.get_model("cafe", "MenuItem").objects.get(name="Noodles").category is None


@pytest.mark.django_db(transaction=True)
def test_the_marketplace_migration_can_be_reversed(restore_latest):
    migrate(AFTER)
    old = migrate(BEFORE)

    assert not hasattr(old.get_model("cafe", "Restaurant"), "cuisine")
