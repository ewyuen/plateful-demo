#!/bin/sh
# Start script for the Render deployment (see Dockerfile.render and docs/deploy-render.md).
# Free Render services have no pre-deploy step and no shell, so the database is prepared here.
# The database steps themselves run in render_gunicorn.py; each is safe to repeat.
set -eu

# The database comes from one connection string: EXTERNAL_DATABASE_URL when it is set (after the move to an
# external Postgres), otherwise DATABASE_URL (Render's own database). The settings read the pieces, so split it.
url="${EXTERNAL_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$url" ]; then
  echo "render-start: set DATABASE_URL or EXTERNAL_DATABASE_URL" >&2
  exit 1
fi
eval "$(DB_URL="$url" python - <<'PY'
import os, shlex, urllib.parse as u

p = u.urlparse(os.environ["DB_URL"])
pieces = (
    ("POSTGRES_HOST", p.hostname),
    ("POSTGRES_PORT", p.port or 5432),
    ("POSTGRES_DB", p.path[1:]),
    ("POSTGRES_USER", u.unquote(p.username or "")),
    ("POSTGRES_PASSWORD", u.unquote(p.password or "")),
)
for key, value in pieces:
    print("export %s=%s" % (key, shlex.quote(str(value))))
PY
)"
# Never fall back to SQLite by accident: without these the settings would ignore Postgres.
if [ -z "${POSTGRES_DB:-}" ] || [ -z "${POSTGRES_HOST:-}" ]; then
  echo "render-start: could not read the database address from the connection string" >&2
  exit 1
fi

# The addresses Django must trust (the Host header, and the CSRF origin of the page's form posts):
# the API's own address, and PUBLIC_ORIGIN, the address the browser uses when the page is a separate
# Render static site that forwards /api and /admin here (for example https://plateful-web.onrender.com).
public_origin="${PUBLIC_ORIGIN:-}"   # unset until the page's address is known (set -u would stop on it)
public_host="${public_origin#*://}"
export DJANGO_ALLOWED_HOSTS="${RENDER_EXTERNAL_HOSTNAME:-localhost},${public_host:-localhost},localhost"
export CSRF_TRUSTED_ORIGINS="${RENDER_EXTERNAL_URL:-http://localhost:8000},${public_origin:-http://localhost:8000}"

# Preparing the database and warming the app happen once, in render_gunicorn.py (see why there). One worker
# (Render sets WEB_CONCURRENCY=1), the app loaded in the master (--preload), and a generous timeout.
exec gunicorn config.wsgi:application --config /app/render_gunicorn.py --bind "0.0.0.0:${PORT:-8000}" --workers "${WEB_CONCURRENCY:-1}" --preload --timeout 120 --access-logfile -
