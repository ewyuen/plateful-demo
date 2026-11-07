import secrets

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand
from django.utils.text import slugify

from cafe.models import Restaurant
from cafe.roles import ADMIN, CUSTOMER, FULFILMENT, OWNER


class Command(BaseCommand):
    help = (
        "Create demo users: one fulfilment user for each restaurant, one admin, one owner and one customer, each with a "
        "random password printed once, or all with the same password given by --password. Existing "
        "users keep their password. For local and sandbox demos only; real staff are made in the "
        "Django admin."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--password",
            help="Give every demo user this password instead of a random one (for a public demo "
            "where the password is in the README; never use it on a real deployment).",
        )
        parser.add_argument(
            "--reset-passwords",
            action="store_true",
            help="Give existing demo users a new random password too.",
        )

    def handle(self, *args, **options):
        User = get_user_model()
        groups = {name: Group.objects.get_or_create(name=name)[0] for name in (FULFILMENT, ADMIN, OWNER, CUSTOMER)}
        created = []

        def make(username, group, **extra):
            user, is_new = User.objects.get_or_create(username=username, defaults=extra)
            if is_new or options["reset_passwords"]:
                password = options["password"] or secrets.token_urlsafe(9)
                user.set_password(password)
                user.is_active = True
                for field, value in extra.items():
                    setattr(user, field, value)
                user.save()
                created.append((username, password))
            user.groups.set([groups[group]])
            return user

        make("admin", ADMIN, is_staff=True)
        make("owner", OWNER)
        make("demo-customer", CUSTOMER)
        for restaurant in Restaurant.objects.order_by("id"):
            username = f"staff-{slugify(restaurant.name)}"[:150]
            user = make(username, FULFILMENT)
            restaurant.staff.add(user)

        if not created:
            self.stdout.write("Every demo user already exists; no password was changed.")
            return
        if options["password"]:
            self.stdout.write("Demo users (all with the password you gave):")
        else:
            self.stdout.write("Demo users (shown once, change them in the Django admin):")
        for username, password in created:
            self.stdout.write(f"  {username}  {password}")
