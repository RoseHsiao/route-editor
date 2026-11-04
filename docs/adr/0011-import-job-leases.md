# 0011: Import job leases and atomic publication

**Status:** Accepted (2026-11-04)

## Context
Workers claim `import_jobs` with `FOR UPDATE SKIP LOCKED` (ADR 0001). A worker can stall or
die after claiming a job, so jobs must be reclaimable. A reclaimed job may still be in
progress on the original worker. Checking only that a row lock exists at publish time does
not prove ownership: the stale worker could lock the row after the new owner released it and
publish a duplicate or outdated result. A failed import must also never leave a partial
dataset behind.

## Decision
- Each claim issues a random `lease_token` and a `lease_expires_at`. A job is `PROCESSING`
  exactly when a lease is held (CHECK constraint). Expired leases can be reclaimed, which
  issues a new token.
- Every worker write (renewal, failure, publication) is conditional on its own token.
- Publication is one transaction: lock the job row, verify the token and that the lease has
  not expired, write every table of the dataset, and set `SUCCEEDED`, all or nothing.
- `import_jobs.dataset_id` is unique.
- Failures record structured errors with a `retryable` flag. Only retryable failures can be
  retried, by resetting the job to `PENDING` while it is still `FAILED`.

## Consequences
- A stale worker cannot publish or fail a job it no longer owns. Its work is discarded.
- A job that is slow beyond its lease may be processed twice. Only one result can ever be
  published.
- `WORKER_LEASE_S` must exceed the longest expected processing time. The worker renews the
  lease before publishing.
