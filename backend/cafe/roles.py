"""Who is staff, an owner or a customer, and for which restaurants (ADR-0014, ADR-0020).

Roles are Django groups. A user's role is the group they belong to; a superuser counts as
admin. The groups are created by migrations, so every database has them. The owner is not
staff: it sees the orders dashboard and can do nothing to an order.
"""

from .models import Restaurant

FULFILMENT = "fulfilment"
ADMIN = "admin"
OWNER = "owner"
CUSTOMER = "customer"
STAFF_ROLES = (FULFILMENT, ADMIN)
ROLE_GROUPS = (FULFILMENT, ADMIN, OWNER, CUSTOMER)


def role_of(user):
    """'admin', 'owner', 'fulfilment', 'customer' or None for a user with no role (or nobody signed in).

    A user has one role. If an account holds several role groups (the admin form refuses that),
    the first of admin, owner, fulfilment, customer wins."""
    if user is None or not user.is_authenticated or not user.is_active:
        return None
    if user.is_superuser:
        return ADMIN
    names = set(user.groups.filter(name__in=ROLE_GROUPS).values_list("name", flat=True))
    if ADMIN in names:
        return ADMIN
    if OWNER in names:
        return OWNER
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
