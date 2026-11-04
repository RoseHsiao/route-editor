# Independently deployable geo worker. Build from this directory:
#   docker build -t trailplanner-geo-worker workers/geo-processing
# Configure with environment variables (see README.md); no secrets are baked in.

FROM python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
RUN uv sync --frozen --no-dev

RUN useradd --system --uid 10001 worker
USER worker

CMD ["/app/.venv/bin/python", "-m", "trailworker"]
