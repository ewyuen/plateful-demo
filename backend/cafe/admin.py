from django import forms
from django.contrib import admin, messages
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin
from django.contrib.auth.forms import UserChangeForm
from django.contrib.auth.models import Group

from .models import (
    CheckoutDraft,
    CheckoutDraftItem,
    MenuCategory,
    MenuItem,
    Order,
    OrderItem,
    Restaurant,
)
from .roles import ADMIN, CUSTOMER, FULFILMENT, OWNER, ROLE_GROUPS, role_of

User = get_user_model()


# The admin site is the admin mode (ADR-0014): who may use it is decided by the role, not by
# per-model Django permissions, so there are no permission rows to grant or lose.
def is_admin(user):
    return user.is_active and role_of(user) == ADMIN


def admin_site_access(request):
    # Active, flagged as staff and in the admin role. The flag follows the role (see
    # StaffUserAdmin), so setting it by hand on a fulfilment user opens nothing.
    return is_admin(request.user) and request.user.is_staff


admin.site.has_permission = admin_site_access


class AdminRoleMixin:
    """Every page of every model is for the admin role."""

    def has_module_permission(self, request):
        return is_admin(request.user)

    def has_view_permission(self, request, obj=None):
        return is_admin(request.user)

    def has_add_permission(self, request, *args, **kwargs):
        return is_admin(request.user)

    def has_change_permission(self, request, obj=None):
        return is_admin(request.user)

    def has_delete_permission(self, request, obj=None):
        return is_admin(request.user)


@admin.register(Restaurant)
class RestaurantAdmin(AdminRoleMixin, admin.ModelAdmin):
    list_display = ("name", "address", "cuisine", "offers_delivery", "delivery_fee")
    list_filter = ("offers_delivery",)
    search_fields = ("name", "cuisine")
    # Who works for the restaurant, and so may see and move its orders.
    filter_horizontal = ("staff",)

    def formfield_for_manytomany(self, db_field, request, **kwargs):
        if db_field.name == "staff":
            # Only active fulfilment users can be assigned; admins see every restaurant anyway.
            kwargs["queryset"] = User.objects.filter(
                is_active=True, groups__name=FULFILMENT
            ).order_by("username")
        return super().formfield_for_manytomany(db_field, request, **kwargs)


@admin.register(MenuCategory)
class MenuCategoryAdmin(AdminRoleMixin, admin.ModelAdmin):
    list_display = ("name", "restaurant", "position")
    search_fields = ("name", "restaurant__name")
    list_select_related = ("restaurant",)


@admin.register(MenuItem)
class MenuItemAdmin(AdminRoleMixin, admin.ModelAdmin):
    list_display = ("name", "restaurant", "category", "price", "is_available")
    search_fields = ("name", "restaurant__name")
    # category shows as "Restaurant: Category", so both joins are needed
    list_select_related = ("restaurant", "category", "category__restaurant")

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "category":
            # the dropdown labels each option with its restaurant; join it once
            kwargs["queryset"] = MenuCategory.objects.select_related("restaurant")
        return super().formfield_for_foreignkey(db_field, request, **kwargs)


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0


@admin.register(Order)
class OrderAdmin(AdminRoleMixin, admin.ModelAdmin):
    list_display = ("id", "restaurant_name", "customer_name", "fulfilment_type", "status", "created_at")
    # An administrator can find an order by the code the guest quotes (ADR-0014).
    search_fields = ("restaurant__name", "customer_name", "public_code")
    readonly_fields = ("public_code",)
    # Only an admin moves an order to another customer account (ADR-0014).
    autocomplete_fields = ("customer",)
    inlines = [OrderItemInline]
    # restaurant_name reads obj.restaurant, which the admin does not select
    # automatically for a method column, so it must be listed here.
    list_select_related = ("restaurant",)

    @admin.display(description="Restaurant", ordering="restaurant__name")
    def restaurant_name(self, obj):
        return obj.restaurant.name

    # An order exists only because a payment succeeded (ADR-0011), so nobody makes one by
    # hand, and one that was paid for is not deleted.
    def has_add_permission(self, request, *args, **kwargs):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class CheckoutDraftItemInline(admin.TabularInline):
    model = CheckoutDraftItem
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(CheckoutDraft)
class CheckoutDraftAdmin(AdminRoleMixin, admin.ModelAdmin):
    """Unfinished checkouts, to look at only: an order appears when PayPal confirms the payment."""

    list_display = ("paypal_order_id", "restaurant", "customer_name", "total", "created_at")
    list_select_related = ("restaurant",)
    inlines = [CheckoutDraftItemInline]

    def has_add_permission(self, request, *args, **kwargs):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


# Users, their role and their restaurants. The role is the group; the Groups page itself is
# not offered, so group permissions are never edited by hand.
admin.site.unregister(Group)
admin.site.unregister(User)


class StaffUserChangeForm(UserChangeForm):
    def clean_groups(self):
        groups = self.cleaned_data["groups"]
        if sum(1 for group in groups if group.name in ROLE_GROUPS) > 1:
            raise forms.ValidationError("Choose one role: fulfilment, admin, owner or customer.")
        return groups


@admin.register(User)
class StaffUserAdmin(AdminRoleMixin, UserAdmin):
    form = StaffUserChangeForm
    list_display = ("username", "email", "role", "restaurants", "is_active")
    list_filter = ("is_active", "groups")
    search_fields = ("username", "email", "first_name", "last_name")
    ordering = ("username",)
    readonly_fields = ("is_staff", "last_login", "date_joined")
    fieldsets = (
        (None, {"fields": ("username", "password")}),
        ("Personal", {"fields": ("first_name", "last_name", "email")}),
        (
            "Role",
            {
                "fields": ("is_active", "groups", "is_staff"),
                "description": (
                    "The role is the group: fulfilment (works for the restaurants that list "
                    "them as staff), admin (this admin site, all restaurants), owner (the orders dashboard, "
                    "view only) or customer (keeps orders under their own account). Choose at most one. "
                    "Staff access follows the role."
                ),
            },
        ),
        ("History", {"fields": ("last_login", "date_joined")}),
    )

    def get_queryset(self, request):
        return super().get_queryset(request).prefetch_related("groups", "staffed_restaurants")

    @admin.display(description="Role")
    def role(self, obj):
        # Read from the prefetched groups, so the list does not query per row.
        names = {group.name for group in obj.groups.all()}
        if obj.is_superuser or ADMIN in names:
            return ADMIN
        if OWNER in names:
            return OWNER
        if FULFILMENT in names:
            return FULFILMENT
        return CUSTOMER if CUSTOMER in names else "-"

    @admin.display(description="Restaurants")
    def restaurants(self, obj):
        return ", ".join(restaurant.name for restaurant in obj.staffed_restaurants.all()) or "-"

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        # The staff flag follows the role (set after the groups are saved), so the admin site
        # opens for admins and closes for everyone else.
        user = form.instance
        should_be_staff = is_admin(user)
        if user.is_staff != should_be_staff:
            user.is_staff = should_be_staff
            user.save(update_fields=["is_staff"])

    def has_delete_permission(self, request, obj=None):
        # An admin cannot delete their own account from here.
        if obj is not None and obj.pk == request.user.pk:
            return False
        return is_admin(request.user)

    def delete_model(self, request, obj):
        if obj.pk == request.user.pk:
            messages.error(request, "You cannot delete your own account.")
            return
        super().delete_model(request, obj)
