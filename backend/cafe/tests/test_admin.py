import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse

from cafe.models import MenuCategory, MenuItem, Order, OrderItem, Restaurant

# Every test in this file touches the database.
pytestmark = pytest.mark.django_db

def test_restaurants_list_load(admin_client, restaurant):
    response = admin_client.get("/admin/cafe/restaurant/")
    assert response.status_code == 200
    assert "Corner Kitchen" in response.content.decode()

def test_menu_items_add(admin_client, restaurant):
    response = admin_client.post("/admin/cafe/menuitem/add/", {
        "name": "New Menu Item",
        "restaurant": restaurant.pk,
        "price": "9.99",
        "is_available": True
    })
    assert response.status_code == 302
    assert MenuItem.objects.filter(name="New Menu Item", restaurant_id=restaurant.pk).exists()

def test_order_page_shows_its_items(admin_client, order, menu_item):
    OrderItem.objects.create(
        order=order, menu_item=menu_item, quantity=2, unit_price=menu_item.price
    )
    url = reverse("admin:cafe_order_change", args=[order.pk])
    response = admin_client.get(url)
    assert response.status_code == 200
    assert "Noodles" in response.content.decode()

def test_order_list_query_count_does_not_grow(admin_client, restaurant):
    url = reverse("admin:cafe_order_changelist")

    def count_queries():
        with CaptureQueriesContext(connection) as ctx:
            response = admin_client.get(url)
        assert response.status_code == 200
        return len(ctx)

    Order.objects.create(restaurant=restaurant, customer_name="Sam")
    with_one = count_queries()

    for _ in range(9):
        Order.objects.create(restaurant=restaurant, customer_name="Sam")
    with_ten = count_queries()

    assert with_ten == with_one

def test_restaurant_with_orders_cannot_be_deleted_in_admin(admin_client, restaurant, order):
    url = reverse("admin:cafe_restaurant_delete", args=[restaurant.pk])
    response = admin_client.post(url, {"post": "yes"})
    assert response.status_code == 200
    assert Restaurant.objects.filter(pk=restaurant.pk).exists()
    # Nobody may delete an order in the admin (it was paid for), so the page names orders
    # as what stands in the way.
    assert "order" in response.content.decode().lower()

def test_ordered_menu_item_cannot_be_deleted_in_admin(admin_client, order, menu_item):
    order_item = OrderItem.objects.create(
        order=order, menu_item=menu_item, quantity=1, unit_price=menu_item.price
    )
    url = reverse("admin:cafe_menuitem_delete", args=[menu_item.pk])
    response = admin_client.post(url, {"post": "yes"})
    assert response.status_code == 200
    assert MenuItem.objects.filter(pk=menu_item.pk).exists()
    assert str(order_item) in response.content.decode()

def test_admin_redirects_anonymous_user_to_login(client, restaurant):
    response = client.get(reverse("admin:cafe_restaurant_changelist"))
    assert response.status_code == 302
    assert response.url.startswith(reverse("admin:login"))


# Menu categories

def test_category_is_created_in_admin(admin_client, restaurant):
    response = admin_client.post("/admin/cafe/menucategory/add/", {
        "restaurant": restaurant.pk,
        "name": "Soups",
        "position": 2,
    })
    assert response.status_code == 302
    assert MenuCategory.objects.filter(restaurant=restaurant, name="Soups", position=2).exists()

def test_category_list_shows_restaurant_and_position(admin_client, restaurant):
    MenuCategory.objects.create(restaurant=restaurant, name="Soups", position=4)
    response = admin_client.get(reverse("admin:cafe_menucategory_changelist"))
    page = response.content.decode()
    assert response.status_code == 200
    assert "Soups" in page and "Corner Kitchen" in page and ">4<" in page

def test_item_gets_a_category_of_its_own_restaurant(admin_client, restaurant, menu_item):
    category = MenuCategory.objects.create(restaurant=restaurant, name="Soups")
    response = admin_client.post(
        reverse("admin:cafe_menuitem_change", args=[menu_item.pk]),
        {
            "restaurant": restaurant.pk,
            "category": category.pk,
            "name": menu_item.name,
            "price": "9.99",
            "is_available": "on",
        },
    )
    assert response.status_code == 302
    menu_item.refresh_from_db()
    assert menu_item.category == category
    changelist = admin_client.get(reverse("admin:cafe_menuitem_changelist"))
    assert "Corner Kitchen: Soups" in changelist.content.decode()

def test_category_of_another_restaurant_is_refused_in_admin(admin_client, restaurant, menu_item):
    other = Restaurant.objects.create(name="Noodle Bar", address="2 Side St")
    foreign = MenuCategory.objects.create(restaurant=other, name="Soups")
    response = admin_client.post(
        reverse("admin:cafe_menuitem_change", args=[menu_item.pk]),
        {
            "restaurant": restaurant.pk,
            "category": foreign.pk,
            "name": menu_item.name,
            "price": "9.99",
            "is_available": "on",
        },
    )
    assert response.status_code == 200
    assert "must belong to the item" in response.content.decode()
    menu_item.refresh_from_db()
    assert menu_item.category is None

def test_restaurant_list_shows_the_cuisine(admin_client):
    Restaurant.objects.create(name="Golden Wok", address="x", cuisine="Cantonese")
    response = admin_client.get(reverse("admin:cafe_restaurant_changelist"))
    assert "Cantonese" in response.content.decode()

def test_category_and_item_lists_do_not_query_per_row(admin_client, restaurant):
    def count_queries(url):
        with CaptureQueriesContext(connection) as ctx:
            response = admin_client.get(url)
        assert response.status_code == 200
        return len(ctx)

    def add_rows(start, stop):
        for n in range(start, stop):
            category = MenuCategory.objects.create(restaurant=restaurant, name=f"Cat {n}")
            MenuItem.objects.create(
                restaurant=restaurant, category=category, name=f"Dish {n}", price="1.00"
            )

    categories = reverse("admin:cafe_menucategory_changelist")
    items = reverse("admin:cafe_menuitem_changelist")

    add_rows(0, 1)
    with_one = (count_queries(categories), count_queries(items))
    add_rows(1, 10)
    with_ten = (count_queries(categories), count_queries(items))

    assert with_ten == with_one

def test_item_form_category_choices_do_not_query_per_option(admin_client, restaurant, menu_item):
    def count_queries():
        with CaptureQueriesContext(connection) as ctx:
            response = admin_client.get(reverse("admin:cafe_menuitem_change", args=[menu_item.pk]))
        assert response.status_code == 200
        return len(ctx)

    MenuCategory.objects.create(restaurant=restaurant, name="Cat 0")
    with_one = count_queries()
    for n in range(1, 10):
        other = Restaurant.objects.create(name=f"R{n}", address="x")
        MenuCategory.objects.create(restaurant=other, name=f"Cat {n}")

    assert count_queries() == with_one
