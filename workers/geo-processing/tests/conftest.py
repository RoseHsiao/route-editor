from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import psycopg
import pytest

from trailworker.config import _without_prisma_params

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "fixtures" / "synthetic"
CONTRACT = REPO_ROOT / "contracts" / "geo" / "v1"


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def _test_database_url() -> str | None:
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        return url
    # Convenience for local runs: read the repository's .env without adding a dependency.
    env_file = REPO_ROOT / ".env"
    if env_file.is_file():
        for line in env_file.read_text().splitlines():
            key, _, value = line.partition("=")
            if key.strip() == "TEST_DATABASE_URL":
                return value.strip().strip('"').strip("'") or None
    return None


def _assert_safe(url: str) -> None:
    """Same rules as tests/integration/test-database.ts: never touch a non-test database."""
    parsed = urlparse(url)
    database = parsed.path.lstrip("/")
    if "test" not in database.lower():
        raise RuntimeError(f"Refusing to use {database!r} for tests: the name must contain 'test'.")
    if parsed.hostname not in ("localhost", "127.0.0.1", "::1", "db") and not os.environ.get("CI"):
        raise RuntimeError("Refusing to use a non-local database outside CI.")


@pytest.fixture
def db_url() -> str:
    url = _test_database_url()
    if not url:
        pytest.skip("TEST_DATABASE_URL is not set")
    _assert_safe(url)
    return _without_prisma_params(url)


@pytest.fixture
def conn(db_url: str) -> Iterator[psycopg.Connection[Any]]:
    try:
        connection = psycopg.connect(db_url, autocommit=True, connect_timeout=3)
    except psycopg.OperationalError:
        pytest.skip("Test database is not reachable (run `pnpm db:up`)")
    with connection:
        exists = connection.execute("SELECT to_regclass('public.import_jobs') IS NOT NULL").fetchone()
        if not exists or not exists[0]:
            pytest.skip("Test database has no schema (run `pnpm test:integration` once to migrate it)")
        connection.execute("TRUNCATE import_jobs, stored_files, trails, users CASCADE")
        yield connection
