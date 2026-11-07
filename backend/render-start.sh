#!/bin/sh
# Start script for the Render deployment (see Dockerfile.render and docs/deploy-render.md).
# Free Render services have no pre-deploy step and no shell, so the database is prepared here.
# The database steps themselves run in render_gunicorn.py; each is safe to repeat.
set -eu

# The database comes from one connection string: NEON_DATABASE_URL when it is set (after the move to
# Neon), otherwise DATABASE_URL (Render's own database). The settings read the pieces, so split it.
url="${NEON_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$url" ]; then
  echo "render-start: set DATABASE_URL or NEON_DATABASE_URL" >&2
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

# The address Render gave the service (Django checks the Host header and the CSRF origin).
export DJANGO_ALLOWED_HOSTS="${RENDER_EXTERNAL_HOSTNAME:-localhost},localhost"
export CSRF_TRUSTED_ORIGINS="${RENDER_EXTERNAL_URL:-http://localhost:8000}"

# Preparing the database and warming the app happen once, in render_gunicorn.py (see why there). One worker
# (Render sets WEB_CONCURRENCY=1), the app loaded in the master (--preload), and a generous timeout.
exec gunicorn config.wsgi:application --config /app/render_gunicorn.py --bind "0.0.0.0:${PORT:-8000}" --workers "${WEB_CONCURRENCY:-1}" --preload --timeout 120 --access-logfile -
