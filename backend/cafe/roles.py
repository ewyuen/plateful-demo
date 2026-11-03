"""Who is staff or a customer, and for which restaurants (ADR-0014).

Roles are Django groups. A user's role is the group they belong to; a superuser counts as
admin. The groups are created by a migration, so every database has them.
"""

from .models import Restaurant

FULFILMENT = "fulfilment"
ADMIN = "admin"
CUSTOMER = "customer"
STAFF_ROLES = (FULFILMENT, ADMIN)
ROLE_GROUPS = (FULFILMENT, ADMIN, CUSTOMER)


def role_of(user):
    """'admin', 'fulfilment', 'customer' or None for a user with no role (or nobody signed in)."""
    if user is None or not user.is_authenticated or not user.is_active:
        return None
    if user.is_superuser:
        return ADMIN
    names = set(user.groups.filter(name__in=ROLE_GROUPS).values_list("name", flat=True))
    if ADMIN in names:
        return ADMIN
    if FULFILMENT in names:
        return FULFILMENT
    if CUSTOMER in names:
        return CUSTOMER
    return None


def restaurants_of(user):
    """The restaurants this user works for: all of them for an admin, their own otherwise."""
    role = role_of(user)
    if role == ADMIN:
        return Restaurant.objects.all()
    if role == FULFILMENT:
        return user.staffed_restaurants.all()
    return Restaurant.objects.none()
