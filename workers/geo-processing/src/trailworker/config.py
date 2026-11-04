"""Worker configuration, read from environment variables."""

from __future__ import annotations

import os
import socket
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal


class ConfigError(ValueError):
    """The environment does not describe a usable worker configuration."""


@dataclass(frozen=True)
class S3Config:
    bucket: str
    region: str | None
    endpoint: str | None
    access_key_id: str | None
    secret_access_key: str | None = field(repr=False)
    force_path_style: bool


@dataclass(frozen=True)
class WorkerConfig:
    database_url: str = field(repr=False)
    worker_id: str
    poll_interval_s: float
    max_attempts: int
    #: How long a claim is valid without renewal. A job whose lease expires can be reclaimed.
    lease_s: float
    storage_driver: Literal["local", "s3"]
    storage_local_dir: str
    s3: S3Config | None = None

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
        s3: S3Config | None = None
        if driver == "s3":
            bucket = source.get("S3_BUCKET", "").strip()
            if not bucket:
                raise ConfigError("S3_BUCKET is required when STORAGE_DRIVER is s3")
            s3 = S3Config(
                bucket=bucket,
                region=source.get("S3_REGION") or None,
                endpoint=source.get("S3_ENDPOINT") or None,
                access_key_id=source.get("S3_ACCESS_KEY_ID") or None,
                secret_access_key=source.get("S3_SECRET_ACCESS_KEY") or None,
                force_path_style=source.get("S3_FORCE_PATH_STYLE", "false") == "true",
            )

        return cls(
            database_url=_without_prisma_params(database_url),
            worker_id=source.get("WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}",
            poll_interval_s=_positive_float(source, "WORKER_POLL_INTERVAL_S", 5.0),
            max_attempts=int(_positive_float(source, "WORKER_MAX_ATTEMPTS", 3)),
            lease_s=_positive_float(source, "WORKER_LEASE_S", 300.0),
            storage_driver="s3" if driver == "s3" else "local",
            storage_local_dir=_resolve_local_dir(source.get("STORAGE_LOCAL_DIR", ".data/storage")),
            s3=s3,
        )


def _resolve_local_dir(raw: str, cwd: Path | None = None) -> str:
    """The web app resolves a relative STORAGE_LOCAL_DIR from the repository root, while
    the worker runs from workers/geo-processing. Resolve relative paths against the
    repository root (the nearest directory with pnpm-workspace.yaml) so both use the same
    folder; refuse to guess when there is none. The local driver is development-only.
    """
    path = Path(raw)
    if path.is_absolute():
        return str(path)
    start = (cwd or Path.cwd()).resolve()
    for directory in (start, *start.parents):
        if (directory / "pnpm-workspace.yaml").is_file():
            return str(directory / path)
    raise ConfigError(
        "STORAGE_LOCAL_DIR is relative but the repository root was not found; use an absolute path"
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
