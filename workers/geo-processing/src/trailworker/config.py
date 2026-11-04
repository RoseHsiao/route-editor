"""Worker configuration, read from environment variables."""

from __future__ import annotations

import os
import socket
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal


class ConfigError(ValueError):
    """The environment does not describe a usable worker configuration."""


@dataclass(frozen=True)
class WorkerConfig:
    database_url: str
    worker_id: str
    poll_interval_s: float
    max_attempts: int
    storage_driver: Literal["local", "s3"]
    storage_local_dir: str

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> WorkerConfig:
        source = os.environ if env is None else env

        database_url = source.get("DATABASE_URL", "").strip()
        if not database_url.startswith(("postgresql://", "postgres://")):
            # Do not echo the value: it may contain credentials.
            raise ConfigError("DATABASE_URL must be set to a postgresql:// URL")

        driver = source.get("STORAGE_DRIVER", "local")
        if driver not in ("local", "s3"):
            raise ConfigError("STORAGE_DRIVER must be 'local' or 's3'")
        if driver == "s3":
            # S3 reads arrive with the import pipeline in Milestone 2.
            raise ConfigError("STORAGE_DRIVER=s3 is not supported by the worker yet")

        return cls(
            database_url=_without_prisma_params(database_url),
            worker_id=source.get("WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}",
            poll_interval_s=_positive_float(source, "WORKER_POLL_INTERVAL_S", 5.0),
            max_attempts=int(_positive_float(source, "WORKER_MAX_ATTEMPTS", 3)),
            storage_driver="local",
            storage_local_dir=source.get("STORAGE_LOCAL_DIR", ".data/storage"),
        )


def _positive_float(source: Mapping[str, str], name: str, default: float) -> float:
    raw = source.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = float(raw)
    except ValueError as error:
        raise ConfigError(f"{name} must be a number") from error
    if value <= 0:
        raise ConfigError(f"{name} must be positive")
    return value


def _without_prisma_params(url: str) -> str:
    """Prisma accepts `?schema=public`; libpq rejects unknown parameters."""
    base, _, query = url.partition("?")
    kept = [part for part in query.split("&") if part and not part.startswith("schema=")]
    return f"{base}?{'&'.join(kept)}" if kept else base
