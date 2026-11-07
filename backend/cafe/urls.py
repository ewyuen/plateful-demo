from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .auth_views import LoginView, LogoutView, MeView, RegisterView
from .views import (
    AssistantView,
    CheckoutCaptureView,
    CheckoutStartView,
    DashboardOrderList,
    FulfilmentOrderList,
    MenuItemViewSet,
    MyOrdersAttachView,
    MyOrdersView,
    OrderLookupView,
    OrderViewSet,
    RestaurantViewSet,
    live,
    ready,
)

router = DefaultRouter()
router.register("restaurants", RestaurantViewSet, basename="restaurant")
router.register("menu-items", MenuItemViewSet, basename="menuitem")
router.register("orders", OrderViewSet, basename="order")

urlpatterns = [
    path("health/live/", live, name="health-live"),
    path("health/ready/", ready, name="health-ready"),
    path("auth/me/", MeView.as_view(), name="auth-me"),
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    path("auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("auth/register/", RegisterView.as_view(), name="auth-register"),
    path("my-orders/", MyOrdersView.as_view(), name="my-orders"),
    path("my-orders/attach/", MyOrdersAttachView.as_view(), name="my-orders-attach"),
    # Before the router, so "lookup" is not read as an order id.
    path("orders/lookup/", OrderLookupView.as_view(), name="order-lookup"),
    path("assistant/", AssistantView.as_view(), name="assistant"),
    path("checkout/paypal/create/", CheckoutStartView.as_view(), name="checkout-start"),
    path("checkout/paypal/capture/", CheckoutCaptureView.as_view(), name="checkout-capture"),
    path("fulfilment/orders/", FulfilmentOrderList.as_view(), name="fulfilment-orders"),
    path("dashboard/orders/", DashboardOrderList.as_view(), name="dashboard-orders"),
    path("", include(router.urls)),
]
