"""ImportJob queue on Postgres: claim with FOR UPDATE SKIP LOCKED, then record the outcome.

The table is owned by the Prisma schema (prisma/schema.prisma, model ImportJob).
Prisma's @updatedAt is set client-side, so every UPDATE here sets updated_at itself.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import psycopg
from psycopg.types.json import Jsonb


@dataclass(frozen=True)
class JobError:
    """A structured, user-presentable error. `code` is stable; `message` is human-readable."""

    code: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "details": self.details}


@dataclass(frozen=True)
class ClaimedJob:
    id: str
    kind: str
    file_id: str
    trail_id: str | None
    owner_user_id: str | None
    source_info: dict[str, Any]
    options: dict[str, Any]
    attempts: int


_CLAIM_SQL = """
UPDATE import_jobs
SET status = 'PROCESSING',
    locked_by = %(worker_id)s,
    locked_at = now(),
    started_at = COALESCE(started_at, now()),
    attempts = attempts + 1,
    updated_at = now()
WHERE id = (
    SELECT id FROM import_jobs
    WHERE status = 'PENDING' AND attempts < %(max_attempts)s
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
RETURNING id, kind::text, file_id, trail_id, owner_user_id, source_info, options, attempts
"""


def claim_next_job(conn: psycopg.Connection[Any], worker_id: str, max_attempts: int) -> ClaimedJob | None:
    """Atomically claims the oldest pending job, or returns None when the queue is empty."""
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(_CLAIM_SQL, {"worker_id": worker_id, "max_attempts": max_attempts})
        row = cur.fetchone()
    if row is None:
        return None
    return ClaimedJob(*row)


def mark_succeeded(
    conn: psycopg.Connection[Any], job_id: str, dataset_id: str, validation: dict[str, Any]
) -> None:
    with conn.transaction():
        conn.execute(
            """
            UPDATE import_jobs
            SET status = 'SUCCEEDED', dataset_id = %s, validation = %s, errors = '[]'::jsonb,
                locked_by = NULL, locked_at = NULL, finished_at = now(), updated_at = now()
            WHERE id = %s AND status = 'PROCESSING'
            """,
            (dataset_id, Jsonb(validation), job_id),
        )


def mark_failed(
    conn: psycopg.Connection[Any],
    job_id: str,
    errors: list[JobError],
    validation: dict[str, Any] | None = None,
) -> None:
    with conn.transaction():
        conn.execute(
            """
            UPDATE import_jobs
            SET status = 'FAILED', errors = %s, validation = %s,
                locked_by = NULL, locked_at = NULL, finished_at = now(), updated_at = now()
            WHERE id = %s AND status = 'PROCESSING'
            """,
            (Jsonb([error.to_json() for error in errors]), Jsonb(validation) if validation else None, job_id),
        )
