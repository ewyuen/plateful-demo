from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError
from django.db.models import ProtectedError

from cafe.models import MenuCategory, MenuItem, Order, OrderItem, Restaurant

# Every test in this file touches the database.
pytestmark = pytest.mark.django_db


def test_menu_item_default_is_available(menu_item):
    assert menu_item.is_available is True

def test_menu_item_default_description_is_empty(menu_item):
    assert menu_item.description == ""

def test_order_default_status(order):
    assert order.status == Order.Status.PENDING

def test_order_restaurant(order, restaurant):
    assert order.restaurant == restaurant

def test_order_customer_name(order):
    assert order.customer_name == "Sam"

def test_order_created_at(order):
    assert order.created_at is not None

def test_order_item_str(order, menu_item):
    order_item = OrderItem.objects.create(
        order=order, menu_item=menu_item, quantity=2, unit_price=menu_item.price
    )
    assert str(order_item) == f"{order_item.quantity} x {order_item.menu_item_id}"

def test_order_item_unit_price(order, menu_item):
    order_item = OrderItem.objects.create(
        order=order, menu_item=menu_item, quantity=2, unit_price=menu_item.price
    )
    assert order_item.unit_price == menu_item.price

def test_order_item_quantity_constraint(order, menu_item):
    with pytest.raises(IntegrityError):
        OrderItem.objects.create(
            order=order, menu_item=menu_item, quantity=0, unit_price=menu_item.price
        )

def test_order_item_unique_constraint(order, menu_item):
    OrderItem.objects.create(
        order=order, menu_item=menu_item, quantity=2, unit_price=menu_item.price
    )
    with pytest.raises(IntegrityError):
        OrderItem.objects.create(
            order=order, menu_item=menu_item, quantity=1, unit_price=menu_item.price
        )

def test_restaurant_with_orders_cannot_be_deleted(restaurant, order):
    with pytest.raises(ProtectedError):
        restaurant.delete()
    assert Restaurant.objects.filter(pk=restaurant.pk).exists()
    assert Order.objects.filter(pk=order.pk).exists()

def test_ordered_menu_item_cannot_be_deleted(order, menu_item):
    OrderItem.objects.create(
        order=order, menu_item=menu_item, quantity=1, unit_price=menu_item.price
    )
    with pytest.raises(ProtectedError):
        menu_item.delete()
    assert MenuItem.objects.filter(pk=menu_item.pk).exists()

def test_deleting_restaurant_deletes_its_menu_items(restaurant, menu_item):
    restaurant.delete()
    assert not MenuItem.objects.filter(pk=menu_item.pk).exists()

def test_deleting_order_deletes_its_items(order, menu_item):
    OrderItem.objects.create(
        order=order, menu_item=menu_item, quantity=2, unit_price=menu_item.price
    )
    order.delete()
    assert OrderItem.objects.count() == 0
    assert MenuItem.objects.filter(pk=menu_item.pk).exists()

def test_order_item_keeps_price_when_menu_price_changes(order, menu_item):
    order_item = OrderItem.objects.create(
        order=order, menu_item=menu_item, quantity=1, unit_price=menu_item.price
    )
    menu_item.price = Decimal("12.50")
    menu_item.save()
    order_item.refresh_from_db()
    assert order_item.unit_price == Decimal("9.99")



# Marketplace fields and menu categories


def test_restaurant_profile_fields_default_to_empty(restaurant):
    assert restaurant.cuisine == ""
    assert restaurant.description == ""
    assert restaurant.image_url == ""

def test_menu_item_category_is_optional(menu_item):
    menu_item.full_clean()
    assert menu_item.category is None

def test_category_names_are_unique_within_a_restaurant(restaurant):
    MenuCategory.objects.create(restaurant=restaurant, name="Soups")
    with pytest.raises(IntegrityError):
        MenuCategory.objects.create(restaurant=restaurant, name="Soups")

def test_two_restaurants_can_share_a_category_name(restaurant):
    other = Restaurant.objects.create(name="Noodle Bar", address="2 Side St")
    MenuCategory.objects.create(restaurant=restaurant, name="Soups")
    MenuCategory.objects.create(restaurant=other, name="Soups")
    assert MenuCategory.objects.filter(name="Soups").count() == 2

def test_categories_are_ordered_by_position_then_name(restaurant):
    MenuCategory.objects.create(restaurant=restaurant, name="Desserts", position=3)
    MenuCategory.objects.create(restaurant=restaurant, name="Soups", position=1)
    MenuCategory.objects.create(restaurant=restaurant, name="Appetizers", position=1)
    names = [c.name for c in restaurant.categories.all()]
    assert names == ["Appetizers", "Soups", "Desserts"]

def test_deleting_a_category_keeps_its_items(restaurant, menu_item):
    category = MenuCategory.objects.create(restaurant=restaurant, name="Soups")
    menu_item.category = category
    menu_item.save()

    category.delete()

    menu_item.refresh_from_db()
    assert menu_item.category is None

def test_category_of_another_restaurant_is_refused(menu_item):
    other = Restaurant.objects.create(name="Noodle Bar", address="2 Side St")
    menu_item.category = MenuCategory.objects.create(restaurant=other, name="Soups")
    with pytest.raises(ValidationError) as excinfo:
        menu_item.full_clean()
    assert "category" in excinfo.value.message_dict

def test_category_of_the_same_restaurant_is_accepted(restaurant, menu_item):
    menu_item.category = MenuCategory.objects.create(restaurant=restaurant, name="Soups")
    menu_item.full_clean()

def test_category_str_names_its_restaurant(restaurant):
    category = MenuCategory.objects.create(restaurant=restaurant, name="Soups")
    assert str(category) == "Corner Kitchen: Soups"
