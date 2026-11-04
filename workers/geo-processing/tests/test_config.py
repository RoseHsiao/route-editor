from __future__ import annotations

from pathlib import Path

import pytest

from trailworker.config import ConfigError, WorkerConfig, _resolve_local_dir

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


def test_s3_requires_a_bucket() -> None:
    with pytest.raises(ConfigError, match="S3_BUCKET"):
        WorkerConfig.from_env({**BASE, "STORAGE_DRIVER": "s3"})


def test_s3_configuration_hides_secrets_from_repr() -> None:
    config = WorkerConfig.from_env(
        {
            **BASE,
            "STORAGE_DRIVER": "s3",
            "S3_BUCKET": "uploads",
            "S3_ENDPOINT": "http://localhost:9000",
            "S3_SECRET_ACCESS_KEY": "very-secret",
            "S3_FORCE_PATH_STYLE": "true",
        }
    )
    assert config.storage_driver == "s3"
    assert config.s3 is not None and config.s3.bucket == "uploads" and config.s3.force_path_style
    assert "very-secret" not in repr(config)
    assert "u:p@" not in repr(config)


def test_lease_default_and_validation() -> None:
    assert WorkerConfig.from_env(BASE).lease_s == 300.0
    with pytest.raises(ConfigError):
        WorkerConfig.from_env({**BASE, "WORKER_LEASE_S": "0"})


def test_relative_local_storage_resolves_from_the_repository_root(tmp_path: Path) -> None:
    (tmp_path / "pnpm-workspace.yaml").write_text("packages: []\n")
    worker_dir = tmp_path / "workers" / "geo-processing"
    worker_dir.mkdir(parents=True)
    assert _resolve_local_dir(".data/storage", cwd=worker_dir) == str(tmp_path / ".data" / "storage")
    assert _resolve_local_dir("/srv/storage", cwd=worker_dir) == "/srv/storage"


def test_relative_local_storage_without_a_repository_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="absolute"):
        _resolve_local_dir(".data/storage", cwd=tmp_path)


def test_repository_default_matches_the_web_app() -> None:
    expected = Path(__file__).resolve().parents[3] / ".data" / "storage"
    assert WorkerConfig.from_env(BASE).storage_local_dir == str(expected)
