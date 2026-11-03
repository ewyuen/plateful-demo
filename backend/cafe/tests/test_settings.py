import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[2]


def load_settings(expression="s.SECRET_KEY", **env):
    """Import config.settings in a fresh Python with a controlled environment.

    A subprocess is needed because this pytest process already loaded the
    settings. The key, debug and CORS variables are removed first, so the values
    that pytest-env and the developer's shell put in this process do not leak
    into the child. `expression` is what the child prints, built from `s` (the
    settings module) and `json`.
    """
    child_env = {
        name: value
        for name, value in os.environ.items()
        if name
        not in (
            "DJANGO_SECRET_KEY",
            "DJANGO_DEBUG",
            "CORS_ALLOWED_ORIGINS",
            "PAYPAL_CLIENT_ID",
            "PAYPAL_CLIENT_SECRET",
            "PAYPAL_API_BASE",
            "ANTHROPIC_API_KEY",
            "ASSISTANT_MODEL",
            "ASSISTANT_RATE",
        )
    }
    child_env.update(env)
    return subprocess.run(
        [sys.executable, "-c", f"import json, config.settings as s; print({expression})"],
        cwd=BACKEND_DIR,
        env=child_env,
        capture_output=True,
        text=True,
    )


def test_missing_key_without_debug_fails_and_names_the_variable():
    result = load_settings()

    assert result.returncode != 0
    assert "DJANGO_SECRET_KEY" in result.stderr


def test_missing_key_in_debug_uses_a_development_key():
    result = load_settings(DJANGO_DEBUG="true")

    assert result.returncode == 0
    assert result.stdout.strip() != ""


@pytest.mark.parametrize("debug_env", [{}, {"DJANGO_DEBUG": "true"}])
def test_supplied_key_is_used_whatever_debug_is(debug_env):
    result = load_settings(DJANGO_SECRET_KEY="the-supplied-key", **debug_env)

    assert result.returncode == 0
    assert result.stdout.strip() == "the-supplied-key"


def cors_origins(value=None):
    env = {"DJANGO_SECRET_KEY": "test-key"}
    if value is not None:
        env["CORS_ALLOWED_ORIGINS"] = value
    result = load_settings("json.dumps(s.CORS_ALLOWED_ORIGINS)", **env)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_cors_origins_default_to_the_two_local_frontends():
    assert cors_origins() == ["http://localhost:5173", "http://127.0.0.1:5173"]


@pytest.mark.parametrize(
    "value",
    [
        "http://a.example,http://b.example",
        "http://a.example, http://b.example",
        " http://a.example , http://b.example ",
        "http://a.example,,http://b.example,",
    ],
)
def test_cors_origins_ignore_spaces_and_empty_entries(value):
    assert cors_origins(value) == ["http://a.example", "http://b.example"]


def test_cors_origins_never_allow_all_when_the_value_is_blank():
    assert cors_origins("  ,  ") == []


def paypal_settings(**env):
    env.setdefault("DJANGO_SECRET_KEY", "test-key")
    result = load_settings(
        "json.dumps([s.PAYPAL_API_BASE, s.PAYPAL_CLIENT_ID, s.PAYPAL_CLIENT_SECRET])", **env
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_paypal_base_url_defaults_to_the_sandbox():
    base, _, _ = paypal_settings()

    assert base == "https://api-m.sandbox.paypal.com"


def test_paypal_missing_credentials_do_not_stop_the_app_starting():
    _, client_id, secret = paypal_settings()

    assert client_id == ""
    assert secret == ""


def test_paypal_values_come_from_the_environment_and_drop_a_trailing_slash():
    base, client_id, secret = paypal_settings(
        PAYPAL_API_BASE="https://paypal.example/", PAYPAL_CLIENT_ID="id", PAYPAL_CLIENT_SECRET="s3"
    )

    assert (base, client_id, secret) == ("https://paypal.example", "id", "s3")


def assistant_settings(**env):
    env.setdefault("DJANGO_SECRET_KEY", "test-key")
    result = load_settings(
        "json.dumps([s.ANTHROPIC_API_KEY, s.ASSISTANT_MODEL, s.ASSISTANT_RATE,"
        " s.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']['assistant']])",
        **env,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_assistant_defaults_to_the_small_model_and_twenty_requests_a_minute():
    key, model, rate, throttle = assistant_settings()

    assert key == ""
    assert model == "claude-haiku-5-5"
    assert rate == "20/min"
    assert throttle == "20/min"


def test_assistant_missing_key_does_not_stop_the_app_starting():
    key, _, _, _ = assistant_settings()

    assert key == ""


def test_assistant_values_come_from_the_environment():
    key, model, rate, throttle = assistant_settings(
        ANTHROPIC_API_KEY="k", ASSISTANT_MODEL="claude-sonnet-5-5", ASSISTANT_RATE="5/min"
    )

    assert (key, model, rate, throttle) == ("k", "claude-sonnet-5-5", "5/min", "5/min")
