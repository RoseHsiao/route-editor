"""Queue behaviour against the real PostGIS test database (schema from Prisma migrations)."""

from __future__ import annotations

import uuid
from typing import Any

import psycopg
import pytest

from trailworker.config import WorkerConfig
from trailworker.jobs import claim_next_job
from trailworker.main import run_once

pytestmark = pytest.mark.integration


def _enqueue(conn: psycopg.Connection[Any], kind: str = "TRAIL_GEOMETRY") -> str:
    file_id, job_id = f"file-{uuid.uuid4()}", f"job-{uuid.uuid4()}"
    conn.execute(
        """
        INSERT INTO stored_files (id, storage_key, mime_type, size_bytes, sha256)
        VALUES (%s, %s, 'application/gpx+xml', 6, %s)
        """,
        (file_id, f"uploads/test/{file_id}.gpx", "0" * 64),
    )
    conn.execute(
        """
        INSERT INTO import_jobs (id, kind, file_id, source_info, updated_at)
        VALUES (%s, %s::import_kind, %s, '{"sourceName": "synthetic test"}', now())
        """,
        (job_id, kind, file_id),
    )
    return job_id


def _job(conn: psycopg.Connection[Any], job_id: str) -> tuple[Any, ...]:
    row = conn.execute(
        "SELECT status::text, attempts, locked_by, errors, finished_at FROM import_jobs WHERE id = %s",
        (job_id,),
    ).fetchone()
    assert row is not None
    return tuple(row)


def test_claims_oldest_pending_job_once(conn: psycopg.Connection[Any]) -> None:
    job_id = _enqueue(conn)

    claimed = claim_next_job(conn, "worker-a", max_attempts=3)
    assert claimed is not None
    assert claimed.id == job_id
    assert claimed.attempts == 1
    assert claimed.source_info == {"sourceName": "synthetic test"}

    status, attempts, locked_by, *_ = _job(conn, job_id)
    assert (status, attempts, locked_by) == ("PROCESSING", 1, "worker-a")
    assert claim_next_job(conn, "worker-b", max_attempts=3) is None


def test_concurrent_workers_never_claim_the_same_job(conn: psycopg.Connection[Any], db_url: str) -> None:
    first, second = _enqueue(conn), _enqueue(conn)
    # Hold a lock on the first job in another session, as a busy worker would.
    with psycopg.connect(db_url, autocommit=True) as other, other.transaction():
        other.execute("SELECT id FROM import_jobs WHERE id = %s FOR UPDATE", (first,))
        claimed = claim_next_job(conn, "worker-b", max_attempts=3)
    assert claimed is not None
    assert claimed.id == second


def test_respects_max_attempts(conn: psycopg.Connection[Any]) -> None:
    job_id = _enqueue(conn)
    conn.execute("UPDATE import_jobs SET attempts = 3 WHERE id = %s", (job_id,))
    assert claim_next_job(conn, "worker-a", max_attempts=3) is None


def test_unimplemented_kinds_fail_with_a_structured_error(conn: psycopg.Connection[Any], db_url: str) -> None:
    job_id = _enqueue(conn, kind="POI")
    config = WorkerConfig.from_env({"DATABASE_URL": db_url, "WORKER_ID": "worker-a"})

    assert run_once(conn, config) is True
    status, _, locked_by, errors, finished_at = _job(conn, job_id)
    assert status == "FAILED"
    assert locked_by is None
    assert finished_at is not None
    assert errors == [
        {
            "code": "PROCESSOR_NOT_IMPLEMENTED",
            "message": "Imports of kind POI are not supported yet.",
            "details": {"kind": "POI"},
        }
    ]
    assert run_once(conn, config) is False
