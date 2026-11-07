from rest_framework.permissions import BasePermission

from .roles import CUSTOMER, OWNER, STAFF_ROLES, role_of


class IsStaff(BasePermission):
    """Signed in with a staff role (fulfilment or admin), as ADR-0014 defines them.

    A customer has a role too, but is not staff. Which restaurants a staff member may touch is
    checked where the orders are read or changed, not here.
    """

    message = "Staff only."

    def has_permission(self, request, view):
        return role_of(request.user) in STAFF_ROLES


class IsCustomer(BasePermission):
    """Signed in as a customer: the account that keeps its own orders."""

    message = "Customers only."

    def has_permission(self, request, view):
        return role_of(request.user) == CUSTOMER


class IsOwner(BasePermission):
    """Signed in as an owner (ADR-0020). An admin is refused too: the dashboard is the owner's."""

    message = "Owners only."

    def has_permission(self, request, view):
        return role_of(request.user) == OWNER
