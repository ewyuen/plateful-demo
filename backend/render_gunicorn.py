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

from django.urls import get_resolver

get_resolver().url_patterns  # imports every view module, and with it the Anthropic SDK
