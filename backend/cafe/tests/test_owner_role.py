"""The owner role (S35, ADR-0020): who it is, what it may not do, and how it is given."""

from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.urls import reverse

from cafe.models import Order
from cafe.roles import ADMIN, CUSTOMER, FULFILMENT, OWNER, ROLE_GROUPS, STAFF_ROLES, role_of
from cafe.tests.test_admin_mode import index, user_form

# Every test in this file touches the database.
pytestmark = pytest.mark.django_db

User = get_user_model()


# The role


def test_the_owner_group_exists_after_migrating():
    assert Group.objects.filter(name=OWNER).count() == 1


def test_the_group_gives_the_owner_role(make_user):
    assert role_of(make_user("the-owner", OWNER)) == OWNER


def test_an_owner_is_not_staff():
    assert OWNER in ROLE_GROUPS
    assert OWNER not in STAFF_ROLES


def test_a_superuser_is_still_an_admin(make_user):
    assert role_of(make_user("root", is_superuser=True)) == ADMIN


def test_an_inactive_owner_has_no_role(make_user):
    assert role_of(make_user("gone", OWNER, is_active=False)) is None


def test_the_first_role_wins_when_an_account_holds_two_groups(make_user):
    user = make_user("both", ADMIN)
    user.groups.add(Group.objects.get(name=OWNER), Group.objects.get(name=FULFILMENT), Group.objects.get(name=CUSTOMER))
    assert role_of(user) == ADMIN

    user.groups.remove(Group.objects.get(name=ADMIN))
    assert role_of(user) == OWNER

    user.groups.remove(Group.objects.get(name=OWNER))
    assert role_of(user) == FULFILMENT


# What an owner may not do


def test_an_owner_cannot_move_an_order_or_read_the_queue(owner_api, restaurant):
    order = Order.objects.create(
        restaurant=restaurant, customer_name="Sam", status=Order.Status.CONFIRMED,
        payment_status=Order.PaymentStatus.PAID,
    )

    move = owner_api.post(reverse("order-transition", args=[order.pk]), {"status": "preparing"}, format="json")

    assert move.status_code == 403
    order.refresh_from_db()
    assert order.status == Order.Status.CONFIRMED
    for name in ("fulfilment-orders", "order-list"):
        assert owner_api.get(reverse(name)).status_code == 403
    assert owner_api.get(reverse("order-detail", args=[order.pk])).status_code == 403


def test_an_owner_cannot_use_the_admin_site(client, make_user):
    client.force_login(make_user("the-owner", OWNER))

    response = index(client)

    assert response.status_code == 302 and "/admin/login/" in response["Location"]


def test_an_owner_account_has_the_staff_flag_off(make_user):
    assert make_user("the-owner", OWNER).is_staff is False


# Giving the role in the admin


@pytest.fixture
def boss_client(client, make_user):
    client.force_login(make_user("boss", ADMIN, is_staff=True))
    return client


def test_an_admin_makes_someone_an_owner(boss_client, make_user):
    user = make_user("deputy", FULFILMENT)

    boss_client.post(
        reverse("admin:auth_user_change", args=[user.pk]),
        user_form(username="deputy", groups=[Group.objects.get(name=OWNER).pk]),
    )

    user.refresh_from_db()
    assert role_of(user) == OWNER
    assert user.is_staff is False
    other = type(boss_client)()
    other.force_login(user)
    assert index(other).status_code == 302


def test_an_owner_cannot_also_be_an_admin(boss_client, make_user):
    user = make_user("deputy", FULFILMENT)
    both = [Group.objects.get(name=name).pk for name in (OWNER, ADMIN)]

    response = boss_client.post(reverse("admin:auth_user_change", args=[user.pk]), user_form(username="deputy", groups=both))

    assert response.status_code == 200
    assert "Choose one role" in response.content.decode()
    assert list(user.groups.values_list("name", flat=True)) == [FULFILMENT]


def test_the_user_list_shows_an_owner_as_an_owner(boss_client, make_user):
    make_user("the-owner", OWNER)

    html = boss_client.get(reverse("admin:auth_user_changelist")).content.decode()

    assert 'field-role">owner</td>' in html


# The demo user


def test_the_seed_creates_an_owner_whose_printed_password_works(restaurant):
    out = StringIO()
    call_command("seed_demo_users", stdout=out)
    printed = dict(line.split() for line in out.getvalue().splitlines() if line.startswith("  "))

    user = User.objects.get(username="owner")
    assert role_of(user) == OWNER
    assert user.check_password(printed["owner"])
    assert user.is_staff is False
