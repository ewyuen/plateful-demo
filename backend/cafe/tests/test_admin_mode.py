import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APIClient

from cafe.models import MenuCategory, MenuItem, Order, Restaurant
from cafe.roles import ADMIN, FULFILMENT
from cafe.tests.conftest import PASSWORD

# Every test in this file touches the database.
pytestmark = pytest.mark.django_db

User = get_user_model()


@pytest.fixture
def boss(make_user):
    return make_user("boss", ADMIN, is_staff=True)


@pytest.fixture
def boss_client(client, boss):
    client.force_login(boss)
    return client


def index(client):
    return client.get(reverse("admin:index"))


# Who may use the admin


def test_anonymous_visitors_are_sent_to_the_login(client):
    response = index(client)

    assert response.status_code == 302 and "/admin/login/" in response["Location"]


def test_an_admin_with_the_staff_flag_gets_in(boss_client):
    assert index(boss_client).status_code == 200


def test_a_superuser_gets_in(admin_client):
    assert index(admin_client).status_code == 200


def test_a_fulfilment_user_does_not_get_in(client, make_user, restaurant):
    client.force_login(make_user("cook", FULFILMENT, restaurants=[restaurant]))

    assert index(client).status_code == 302


def test_a_fulfilment_user_with_the_staff_flag_still_does_not_get_in(client, make_user):
    client.force_login(make_user("cook", FULFILMENT, is_staff=True))

    response = index(client)

    assert response.status_code == 302 and "/admin/login/" in response["Location"]


def test_a_user_with_no_role_but_the_staff_flag_does_not_get_in(client, make_user):
    client.force_login(make_user("plain", is_staff=True))

    assert index(client).status_code == 302


def test_an_admin_without_the_staff_flag_does_not_get_in(client, make_user):
    client.force_login(make_user("boss2", ADMIN))

    assert index(client).status_code == 302


def test_an_inactive_admin_does_not_get_in(client, make_user):
    client.force_login(make_user("old", ADMIN, is_staff=True))
    User.objects.filter(username="old").update(is_active=False)

    assert index(client).status_code == 302


def test_every_admin_page_is_closed_to_a_fulfilment_user(client, make_user, restaurant):
    client.force_login(make_user("cook", FULFILMENT, is_staff=True))

    for name in ("admin:cafe_restaurant_changelist", "admin:auth_user_changelist", "admin:cafe_order_changelist"):
        assert client.get(reverse(name)).status_code == 302


# The catalogue


def test_an_admin_lists_restaurants_menus_and_orders(boss_client, restaurant):
    for name in (
        "admin:cafe_restaurant_changelist", "admin:cafe_menucategory_changelist",
        "admin:cafe_menuitem_changelist", "admin:cafe_order_changelist",
        "admin:cafe_checkoutdraft_changelist", "admin:auth_user_changelist",
    ):
        assert boss_client.get(reverse(name)).status_code == 200, name


def test_an_admin_sets_a_restaurants_delivery_offer_and_fee(boss_client, restaurant):
    response = boss_client.post(
        reverse("admin:cafe_restaurant_change", args=[restaurant.pk]),
        {"name": "Corner Kitchen", "address": "1 Main St", "cuisine": "", "description": "",
         "image_url": "", "offers_delivery": "on", "delivery_fee": "2.50"},
    )

    assert response.status_code == 302
    restaurant.refresh_from_db()
    assert restaurant.offers_delivery and str(restaurant.delivery_fee) == "2.50"


def test_an_admin_adds_a_restaurant_a_category_and_a_dish(boss_client, restaurant):
    added = boss_client.post(
        reverse("admin:cafe_restaurant_add"),
        {"name": "Noodle Bar", "address": "2 Side St", "cuisine": "", "description": "", "image_url": "",
         "delivery_fee": "0"},
    )
    category = boss_client.post(
        reverse("admin:cafe_menucategory_add"),
        {"restaurant": restaurant.pk, "name": "Soups", "position": "1"},
    )
    dish = boss_client.post(
        reverse("admin:cafe_menuitem_add"),
        {"restaurant": restaurant.pk, "name": "Tea", "price": "3.00", "is_available": "on", "description": ""},
    )

    assert (added.status_code, category.status_code, dish.status_code) == (302, 302, 302)
    assert Restaurant.objects.filter(name="Noodle Bar").exists()
    assert MenuCategory.objects.filter(name="Soups").exists() and MenuItem.objects.filter(name="Tea").exists()


# Orders


def test_an_admin_opens_an_order_and_finds_it_by_code(boss_client, order, restaurant):
    Order.objects.create(restaurant=restaurant, customer_name="Someone else")
    page = boss_client.get(reverse("admin:cafe_order_change", args=[order.pk]))
    found = boss_client.get(reverse("admin:cafe_order_changelist"), {"q": order.public_code})

    assert page.status_code == 200 and order.public_code in page.content.decode()
    assert found.status_code == 200
    assert reverse("admin:cafe_order_change", args=[order.pk]) in found.content.decode()
    assert "Someone else" not in found.content.decode()


def test_nobody_adds_an_order_in_the_admin(boss_client, admin_client):
    assert boss_client.get(reverse("admin:cafe_order_add")).status_code == 403
    assert admin_client.get(reverse("admin:cafe_order_add")).status_code == 403


def test_nobody_deletes_an_order_in_the_admin(boss_client, admin_client, order):
    url = reverse("admin:cafe_order_delete", args=[order.pk])

    assert boss_client.post(url, {"post": "yes"}).status_code == 403
    assert admin_client.post(url, {"post": "yes"}).status_code == 403
    assert Order.objects.filter(pk=order.pk).exists()


def test_checkout_drafts_can_only_be_looked_at(boss_client):
    assert boss_client.get(reverse("admin:cafe_checkoutdraft_add")).status_code == 403


# Users, roles and restaurants


def user_form(**overrides):
    data = {
        "username": "cook", "first_name": "", "last_name": "", "email": "",
        "is_active": "on", "groups": [],
    }
    data.update(overrides)
    return data


def test_the_user_list_shows_role_and_restaurants(boss_client, make_user, restaurant):
    make_user("cook", FULFILMENT, restaurants=[restaurant])

    html = boss_client.get(reverse("admin:auth_user_changelist")).content.decode()

    assert "cook" in html and "Corner Kitchen" in html and "fulfilment" in html


def test_the_user_list_does_not_query_per_row(boss_client, make_user, restaurant):
    url = reverse("admin:auth_user_changelist")
    make_user("first", FULFILMENT, restaurants=[restaurant])

    def queries():
        with CaptureQueriesContext(connection) as ctx:
            assert boss_client.get(url).status_code == 200
        return len(ctx)

    few = queries()
    for i in range(10):
        make_user(f"more{i}", FULFILMENT, restaurants=[restaurant])

    assert queries() == few


def test_an_admin_adds_a_user(boss_client):
    response = boss_client.post(
        reverse("admin:auth_user_add"),
        {"username": "newcook", "password1": PASSWORD, "password2": PASSWORD, "usable_password": "true"},
    )

    assert response.status_code == 302
    assert User.objects.filter(username="newcook").exists()


def test_giving_the_fulfilment_group_makes_a_fulfilment_user_without_admin_access(boss_client, make_user, client):
    user = make_user("cook")

    boss_client.post(
        reverse("admin:auth_user_change", args=[user.pk]),
        user_form(groups=[Group.objects.get(name=FULFILMENT).pk]),
    )

    user.refresh_from_db()
    assert list(user.groups.values_list("name", flat=True)) == [FULFILMENT]
    assert user.is_staff is False


def test_putting_a_user_in_the_admin_group_lets_them_use_the_admin(boss_client, make_user):
    user = make_user("cook", FULFILMENT)

    boss_client.post(
        reverse("admin:auth_user_change", args=[user.pk]),
        user_form(groups=[Group.objects.get(name=ADMIN).pk]),
    )

    user.refresh_from_db()
    assert user.is_staff is True
    other = type(boss_client)()
    other.force_login(user)
    assert index(other).status_code == 200


def test_taking_the_admin_group_away_shuts_the_admin_for_that_user(boss_client, make_user):
    user = make_user("deputy", ADMIN, is_staff=True)

    boss_client.post(reverse("admin:auth_user_change", args=[user.pk]), user_form(username="deputy", groups=[]))

    user.refresh_from_db()
    assert user.is_staff is False
    other = type(boss_client)()
    other.force_login(user)
    assert index(other).status_code == 302


def test_two_roles_are_refused_and_nothing_changes(boss_client, make_user):
    user = make_user("cook", FULFILMENT)
    both = [Group.objects.get(name=name).pk for name in (FULFILMENT, ADMIN)]

    response = boss_client.post(reverse("admin:auth_user_change", args=[user.pk]), user_form(groups=both))

    assert response.status_code == 200
    assert "Choose one role" in response.content.decode()
    assert list(user.groups.values_list("name", flat=True)) == [FULFILMENT]


def test_the_staff_flag_cannot_be_set_by_hand(boss_client, make_user):
    user = make_user("cook", FULFILMENT)

    boss_client.post(reverse("admin:auth_user_change", args=[user.pk]), user_form(is_staff="on", groups=[Group.objects.get(name=FULFILMENT).pk]))

    user.refresh_from_db()
    assert user.is_staff is False


def test_the_superuser_flag_and_permissions_are_not_on_the_user_page(boss_client, make_user):
    user = make_user("cook", FULFILMENT)

    html = boss_client.get(reverse("admin:auth_user_change", args=[user.pk])).content.decode()

    assert "is_superuser" not in html and "user_permissions" not in html


def test_the_superuser_flag_cannot_be_sent_either(boss_client, make_user):
    user = make_user("cook", FULFILMENT)

    boss_client.post(reverse("admin:auth_user_change", args=[user.pk]), user_form(is_superuser="on", groups=[Group.objects.get(name=FULFILMENT).pk]))

    user.refresh_from_db()
    assert user.is_superuser is False


def test_an_admin_cannot_delete_their_own_account(boss_client, boss):
    response = boss_client.post(reverse("admin:auth_user_delete", args=[boss.pk]), {"post": "yes"})

    assert response.status_code == 403
    assert User.objects.filter(pk=boss.pk).exists()


def test_an_admin_can_delete_another_user(boss_client, make_user):
    user = make_user("gone")

    boss_client.post(reverse("admin:auth_user_delete", args=[user.pk]), {"post": "yes"})

    assert not User.objects.filter(pk=user.pk).exists()


def test_there_is_no_groups_page(boss_client):
    assert boss_client.get("/admin/auth/group/").status_code == 404
    assert "Groups" not in index(boss_client).content.decode()


# Staff assignment


def test_only_active_fulfilment_users_can_be_assigned(boss_client, make_user, restaurant):
    make_user("cook", FULFILMENT)
    make_user("retired", FULFILMENT, is_active=False)
    make_user("other-boss", ADMIN, is_staff=True)
    make_user("plain")

    html = boss_client.get(reverse("admin:cafe_restaurant_change", args=[restaurant.pk])).content.decode()

    assert ">cook<" in html
    for excluded in ("retired", "other-boss", "plain"):
        assert f">{excluded}<" not in html


def test_an_assigned_cook_sees_the_restaurants_orders_in_the_queue(boss_client, make_user, restaurant, order):
    cook = make_user("cook", FULFILMENT)
    Order.objects.filter(pk=order.pk).update(status="confirmed", payment_status="paid")

    boss_client.post(
        reverse("admin:cafe_restaurant_change", args=[restaurant.pk]),
        {"name": "Corner Kitchen", "address": "1 St", "cuisine": "", "description": "", "image_url": "",
         "delivery_fee": "0", "staff": [cook.pk]},
    )

    api = APIClient()
    api.force_authenticate(cook)
    assert [row["id"] for row in api.get(reverse("fulfilment-orders")).json()["results"]] == [order.pk]
