"""Gunicorn settings for the Render deployment (see render-start.sh and docs/deploy-render.md).

A free Render instance has about 0.1 CPU, so every Python start-up and every heavy import is slow
(importing the Anthropic SDK alone took about 40 seconds there). Everything is therefore done ONCE,
in this one process, before the workers exist:

1. prepare the database (migrations, starter data, demo users); every step is safe to repeat;
2. import the URLconf now (it pulls in the Anthropic SDK), so the first request is not slow.

Gunicorn runs this file before it loads the app; with --preload the workers are forked afterwards and
share what was imported here.
"""
import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.core.management import call_command

call_command("migrate", interactive=False)
call_command("loaddata", "seed")
demo_password = os.environ.get("DEMO_PASSWORD")
call_command("seed_demo_users", *(["--password", demo_password] if demo_password else []))

# seed_demo_users never changes the password of a user that already exists, so a deployment that first started
# without DEMO_PASSWORD (random passwords) or with another value (or a database restored from a dump) would keep
# passwords nobody knows. On Render the demo accounts therefore always take DEMO_PASSWORD. Only the exact demo
# usernames are touched (never a customer who registered, or any other account). A password hash is slow on a
# 0.1 CPU instance, so hash once, give every demo user that same hash, and skip all of it when they already match.
if demo_password:
    from django.contrib.auth import get_user_model
    from django.contrib.auth.hashers import make_password
    from django.utils.text import slugify

    from cafe.models import Restaurant

    demo_names = {"admin", "owner", "demo-customer"}
    demo_names |= {f"staff-{slugify(restaurant.name)}"[:150] for restaurant in Restaurant.objects.all()}
    demo_users = get_user_model().objects.filter(username__in=demo_names)
    hashes = set(demo_users.values_list("password", flat=True))
    probe = demo_users.first()
    if probe is not None and (len(hashes) != 1 or not probe.check_password(demo_password)):
        demo_users.update(password=make_password(demo_password))
        print("render: the demo accounts now use DEMO_PASSWORD (%d users)" % demo_users.count(), flush=True)

from django.urls import get_resolver

get_resolver().url_patterns  # imports every view module, and with it the Anthropic SDK
