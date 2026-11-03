FROM python:3.14-slim

COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /usr/local/bin/uv

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY . .

# The admin's CSS and scripts, served by WhiteNoise (ADR-0014). A throwaway key lets the
# command start; it is not kept in the image's environment.
RUN DJANGO_SECRET_KEY=build-time-only python manage.py collectstatic --noinput

# Fixed numeric uid, so a Kubernetes runAsNonRoot check can verify it.
# A home directory is needed: gunicorn creates its control socket there and logs an error without it.
RUN useradd --system --uid 10001 --create-home app
USER 10001

EXPOSE 8000

# Two workers: a minikube node is small, and a fixed count keeps resources predictable.
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--access-logfile", "-"]
