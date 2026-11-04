from __future__ import annotations

import pytest

from trailworker.config import ConfigError, WorkerConfig

BASE = {"DATABASE_URL": "postgresql://u:p@localhost:5433/trailplanner"}


def test_defaults() -> None:
    config = WorkerConfig.from_env(BASE)
    assert config.poll_interval_s == 5.0
    assert config.max_attempts == 3
    assert config.storage_driver == "local"
    assert config.worker_id


def test_requires_postgres_url_without_echoing_it() -> None:
    with pytest.raises(ConfigError) as error:
        WorkerConfig.from_env({"DATABASE_URL": "mysql://user:secret-password@host/db"})
    assert "secret-password" not in str(error.value)


def test_strips_prisma_only_schema_parameter() -> None:
    config = WorkerConfig.from_env(
        {"DATABASE_URL": "postgresql://u:p@localhost:5433/tp?schema=public&sslmode=disable"}
    )
    assert config.database_url == "postgresql://u:p@localhost:5433/tp?sslmode=disable"
    assert (
        WorkerConfig.from_env({"DATABASE_URL": "postgresql://h/tp?schema=public"}).database_url
        == "postgresql://h/tp"
    )


@pytest.mark.parametrize("value", ["0", "-1", "soon"])
def test_rejects_invalid_poll_interval(value: str) -> None:
    with pytest.raises(ConfigError):
        WorkerConfig.from_env({**BASE, "WORKER_POLL_INTERVAL_S": value})


def test_s3_is_not_supported_yet() -> None:
    with pytest.raises(ConfigError, match="not supported"):
        WorkerConfig.from_env({**BASE, "STORAGE_DRIVER": "s3"})
