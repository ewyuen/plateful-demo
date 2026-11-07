import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

pytestmark = pytest.mark.django_db(transaction=True)


def migrate(targets):
    executor = MigrationExecutor(connection)
    executor.migrate(targets)
    return MigrationExecutor(connection).loader.project_state(targets).apps


def test_the_owner_group_comes_and_goes_and_no_user_changes_role():
    old = migrate([("cafe", "0011_customer_group")])
    try:
        Group = old.get_model("auth", "Group")
        User = old.get_model("auth", "User")
        # An earlier test that flushed the database may have removed the groups; make what is needed.
        Group.objects.filter(name="owner").delete()
        cook = User.objects.create(username="cook")
        cook.groups.add(Group.objects.get_or_create(name="fulfilment")[0])
        boss = User.objects.create(username="boss", is_staff=True)
        boss.groups.add(Group.objects.get_or_create(name="admin")[0])

        new = migrate([("cafe", "0012_owner_group")])

        NewGroup = new.get_model("auth", "Group")
        NewUser = new.get_model("auth", "User")
        assert NewGroup.objects.filter(name="owner").count() == 1
        assert list(NewUser.objects.get(username="cook").groups.values_list("name", flat=True)) == ["fulfilment"]
        assert list(NewUser.objects.get(username="boss").groups.values_list("name", flat=True)) == ["admin"]
        assert not NewGroup.objects.get(name="owner").user_set.exists()

        # Running forwards twice changes nothing, and going back removes only the empty group.
        migrate([("cafe", "0011_customer_group")])
        assert not old.get_model("auth", "Group").objects.filter(name="owner").exists()
        migrate([("cafe", "0012_owner_group")])
        assert new.get_model("auth", "Group").objects.filter(name="owner").count() == 1
    finally:
        migrate(MigrationExecutor(connection).loader.graph.leaf_nodes())
