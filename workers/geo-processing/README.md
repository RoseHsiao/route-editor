# TrailPlanner geo worker

Python service that processes trail data imports. It claims `ImportJob` rows from
Postgres (`FOR UPDATE SKIP LOCKED`), reads the raw file from object storage, and
writes normalized geometry, profiles and a validation report.

**Milestone 1 status:** the queue, configuration, storage access and failure path
are implemented and tested. No processors exist yet, so every job fails with the
structured error `PROCESSOR_NOT_IMPLEMENTED`. GPX/GeoJSON processing arrives in
Milestone 2, CSV POI import in Milestone 3.

## Run locally

```sh
pnpm worker:sync                  # creates workers/geo-processing/.venv (project-local)
pnpm worker:test                  # unit tests + queue tests against TEST_DATABASE_URL
pnpm worker:lint                  # ruff + mypy --strict

cd workers/geo-processing
uv run --env-file ../../.env python -m trailworker --once
```

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | required | Same database as the web app. A Prisma `?schema=` parameter is ignored. |
| `WORKER_ID` | `<hostname>-<pid>` | Recorded in `import_jobs.locked_by`. |
| `WORKER_POLL_INTERVAL_S` | `5` | Sleep between polls when the queue is empty. |
| `WORKER_MAX_ATTEMPTS` | `3` | Jobs that have been tried this many times are not claimed again. |
| `STORAGE_DRIVER` | `local` | Only `local` so far; S3 arrives with the import pipeline. |
| `STORAGE_LOCAL_DIR` | `.data/storage` | Must point at the same directory as the web app. |

## Contract with the web app

The database schema is owned by `prisma/schema.prisma`. The worker uses plain SQL
against it. `tests/test_jobs.py` runs against the real migrated schema, so schema
changes that break the worker fail its tests. Storage key rules are mirrored in
`src/trailworker/storage.py` and `lib/storage/keys.ts`, with matching test cases.

## Deployment

The `Dockerfile` builds a standalone image. Where it runs in production is decided
in Milestone 7 (ADR 0001).
