"""ImportJob queue on Postgres with leases.

A claim issues a random `lease_token` and a `lease_expires_at`. Every later write by
the worker (success, failure, lease renewal) is conditional on that token, so a worker
whose lease expired and whose job was reclaimed by another worker can no longer change
the job or publish results. The final publish additionally locks the row and checks the
lease inside the same transaction as all dataset writes (see persist.py).

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
    """A structured, user-presentable error. `code` is stable; `message` is human-readable.

    `retryable` says whether trying again can succeed without changing the file
    (a storage outage can; a malformed file cannot).
    """

    code: str
    message: str
    details: dict[str, Any] = field(default_factory=dict)
    retryable: bool = False

    def to_json(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "message": self.message,
            "details": self.details,
            "retryable": self.retryable,
        }


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
    lease_token: str


class LeaseLostError(Exception):
    """This worker no longer owns the job. Nothing it computed may be written."""


_CLAIM_SQL = """
UPDATE import_jobs
SET status = 'PROCESSING',
    locked_by = %(worker_id)s,
    locked_at = clock_timestamp(),
    lease_token = gen_random_uuid()::text,
    lease_expires_at = clock_timestamp() + make_interval(secs => %(lease_s)s),
    started_at = COALESCE(started_at, clock_timestamp()),
    attempts = attempts + 1,
    updated_at = clock_timestamp()
WHERE id = (
    SELECT id FROM import_jobs
    WHERE attempts < %(max_attempts)s
      AND (status = 'PENDING' OR (status = 'PROCESSING' AND lease_expires_at < clock_timestamp()))
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
RETURNING id, kind::text, file_id, trail_id, owner_user_id, source_info, options, attempts, lease_token
"""

# Jobs whose lease expired after their last allowed attempt will never be claimed again.
_EXPIRE_SQL = """
UPDATE import_jobs
SET status = 'FAILED',
    errors = %(errors)s,
    lease_token = NULL, lease_expires_at = NULL, locked_by = NULL, locked_at = NULL,
    finished_at = clock_timestamp(), updated_at = clock_timestamp()
WHERE status = 'PROCESSING' AND lease_expires_at < clock_timestamp() AND attempts >= %(max_attempts)s
"""


def claim_next_job(
    conn: psycopg.Connection[Any], worker_id: str, max_attempts: int, lease_s: float = 300.0
) -> ClaimedJob | None:
    """Atomically claims the oldest pending job (or one whose lease expired)."""
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            _EXPIRE_SQL,
            {
                "max_attempts": max_attempts,
                "errors": Jsonb(
                    [
                        JobError(
                            "LEASE_EXPIRED",
                            "Processing did not finish in time on any attempt.",
                            {"attempts": max_attempts},
                            retryable=True,
                        ).to_json()
                    ]
                ),
            },
        )
        cur.execute(_CLAIM_SQL, {"worker_id": worker_id, "max_attempts": max_attempts, "lease_s": lease_s})
        row = cur.fetchone()
    if row is None:
        return None
    return ClaimedJob(*row)


def renew_lease(conn: psycopg.Connection[Any], job: ClaimedJob, lease_s: float) -> None:
    """Extends the lease. Raises LeaseLostError if the job is no longer ours."""
    with conn.transaction():
        cursor = conn.execute(
            """
            UPDATE import_jobs
            SET lease_expires_at = clock_timestamp() + make_interval(secs => %s),
                updated_at = clock_timestamp()
            WHERE id = %s AND status = 'PROCESSING' AND lease_token = %s
              AND lease_expires_at > clock_timestamp()
            """,
            (lease_s, job.id, job.lease_token),
        )
        if cursor.rowcount != 1:
            raise LeaseLostError(job.id)


def lock_owned_job(conn: psycopg.Connection[Any], job: ClaimedJob) -> None:
    """Inside a transaction: locks the job row and verifies the lease is still ours and unexpired."""
    row = conn.execute(
        """
        SELECT 1 FROM import_jobs
        WHERE id = %s AND status = 'PROCESSING' AND lease_token = %s AND lease_expires_at > clock_timestamp()
        FOR UPDATE
        """,
        (job.id, job.lease_token),
    ).fetchone()
    if row is None:
        raise LeaseLostError(job.id)


def mark_succeeded_in_transaction(
    conn: psycopg.Connection[Any],
    job: ClaimedJob,
    dataset_id: str,
    validation: dict[str, Any],
    contract_version: int,
) -> None:
    cursor = conn.execute(
        """
        UPDATE import_jobs
        SET status = 'SUCCEEDED', dataset_id = %s, validation = %s, errors = '[]'::jsonb,
            contract_version = %s, trail_id = (SELECT trail_id FROM trail_datasets WHERE id = %s),
            lease_token = NULL, lease_expires_at = NULL, locked_by = NULL, locked_at = NULL,
            finished_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE id = %s AND status = 'PROCESSING' AND lease_token = %s
        """,
        (dataset_id, Jsonb(validation), contract_version, dataset_id, job.id, job.lease_token),
    )
    if cursor.rowcount != 1:
        raise LeaseLostError(job.id)


def mark_failed(
    conn: psycopg.Connection[Any],
    job: ClaimedJob,
    errors: list[JobError],
    validation: dict[str, Any] | None = None,
    contract_version: int | None = None,
) -> bool:
    """Records a failure. Returns False (and writes nothing) if the lease was lost."""
    with conn.transaction():
        cursor = conn.execute(
            """
            UPDATE import_jobs
            SET status = 'FAILED', errors = %s, validation = %s, contract_version = %s,
                lease_token = NULL, lease_expires_at = NULL, locked_by = NULL, locked_at = NULL,
                finished_at = clock_timestamp(), updated_at = clock_timestamp()
            WHERE id = %s AND status = 'PROCESSING' AND lease_token = %s
            """,
            (
                Jsonb([error.to_json() for error in errors]),
                Jsonb(validation) if validation else None,
                contract_version,
                job.id,
                job.lease_token,
            ),
        )
        return cursor.rowcount == 1
