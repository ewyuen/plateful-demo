"""Login (ADR-0014): who am I, sign in, sign out, and register a customer.

The session is a cookie. Signing in needs the CSRF token like any other change, so the
page first asks `me`, which sets the CSRF cookie. Every failure to sign in answers alike,
so the response never says which usernames exist.
"""

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.models import Group
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .roles import CUSTOMER, restaurants_of, role_of

WRONG_CREDENTIALS = "Wrong username or password."


def user_payload(user):
    return {
        "username": user.get_username(),
        "role": role_of(user),
        "restaurants": [
            {"id": restaurant.pk, "name": restaurant.name}
            for restaurant in restaurants_of(user).order_by("name", "id")
        ],
    }


@method_decorator(ensure_csrf_cookie, name="dispatch")
class MeView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        if not request.user.is_authenticated:
            return Response({"user": None})
        return Response({"user": user_payload(request.user)})


# DRF views are exempt from Django's CSRF middleware; signing in is a change that a
# stranger's page could forge, so the check is put back here.
@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        username = request.data.get("username")
        password = request.data.get("password")
        if not isinstance(username, str) or not isinstance(password, str):
            return Response({"detail": WRONG_CREDENTIALS}, status=status.HTTP_400_BAD_REQUEST)

        user = authenticate(request._request, username=username, password=password)
        if user is None:
            # Wrong password, unknown username and inactive account look the same.
            return Response({"detail": WRONG_CREDENTIALS}, status=status.HTTP_400_BAD_REQUEST)
        if role_of(user) is None:
            return Response(
                {"detail": "This account cannot use the staff pages."},
                status=status.HTTP_403_FORBIDDEN,
            )
        login(request._request, user)
        return Response(user_payload(user))


class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        logout(request._request)
        return Response(status=status.HTTP_204_NO_CONTENT)


@method_decorator(csrf_protect, name="dispatch")
class RegisterView(APIView):
    """Make a customer account (ADR-0014). Only ever a customer, never staff.

    A taken username is refused (ignoring letter case): that is the one thing this reveals.
    """

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "register"

    def post(self, request):
        username = request.data.get("username") if hasattr(request.data, "get") else None
        password = request.data.get("password") if hasattr(request.data, "get") else None
        if not isinstance(username, str) or not isinstance(password, str):
            return Response(
                {"detail": "Enter a username and a password."}, status=status.HTTP_400_BAD_REQUEST
            )
        username = username.strip()
        User = get_user_model()
        field = User._meta.get_field("username")
        try:
            field.run_validators(username)
            if not username or len(username) > field.max_length:
                raise ValidationError("Enter a username of up to 150 characters.")
            validate_password(password, user=User(username=username))
        except ValidationError as error:
            return Response(
                {"detail": " ".join(error.messages)}, status=status.HTTP_400_BAD_REQUEST
            )

        taken = Response(
            {"detail": "That username is taken."}, status=status.HTTP_400_BAD_REQUEST
        )
        if User.objects.filter(username__iexact=username).exists():
            return taken
        try:
            with transaction.atomic():
                user = User.objects.create_user(username, password=password)
                user.groups.add(Group.objects.get(name=CUSTOMER))
        except IntegrityError:
            return taken
        login(request._request, user)
        return Response(user_payload(user), status=status.HTTP_201_CREATED)
