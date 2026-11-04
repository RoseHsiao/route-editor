# RouteEditor geo worker

Python service that processes trail data imports. It claims `ImportJob` rows from
Postgres (`FOR UPDATE SKIP LOCKED`, with a lease token), reads the raw file from object
storage, verifies its checksum, parses and validates it, and publishes normalized
geometry, profiles, waypoints and a validation report in one transaction.

**Milestone 2 status:** `TRAIL_GEOMETRY` imports (GPX `trk`/`rte`/`wpt`, GeoJSON) are
implemented; see [docs/IMPORT_PIPELINE.md](../../docs/IMPORT_PIPELINE.md). POI imports
(CSV, Milestone 3) fail with `PROCESSOR_NOT_IMPLEMENTED`.

## Layout

| Module | Responsibility |
|---|---|
| `parsing/gpx.py`, `parsing/geojson.py` | Read the source format; report invalid coordinates and elevations; CRS handling |
| `normalize.py` | Duplicates, spikes, gaps, segment discontinuities, elevation completeness, main variant |
| `geodesy.py` | Geodesic distances (WGS 84). The only place distances are computed |
| `profile.py` | Resampling, smoothing, ascent/descent; rebuild from stored parameters |
| `persist.py` | Atomic, lease-checked publication |
| `jobs.py` | Claim, lease renewal, failure; all conditional on the lease token |
| `importer.py` | The `TRAIL_GEOMETRY` processor; `evaluate()` runs the pipeline without I/O |
| `contract.py`, `contract_checks.py` | Contract v1 constants and semantic rules (`contracts/geo/v1`) |

## Run locally

```sh
pnpm worker:sync                  # creates workers/geo-processing/.venv (project-local)
pnpm worker:test                  # unit tests + database tests against TEST_DATABASE_URL
pnpm worker:lint                  # ruff + mypy --strict
pnpm worker:run                   # process jobs continuously (uses the repository .env)
pnpm worker:once                  # process at most one job
pnpm worker:inspect <file>        # validate a local file; writes nothing
```

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | required | Same database as the web app. A Prisma `?schema=` parameter is ignored. |
| `WORKER_ID` | `<hostname>-<pid>` | Recorded in `import_jobs.locked_by`. |
| `WORKER_POLL_INTERVAL_S` | `5` | Sleep between polls when the queue is empty. |
| `WORKER_MAX_ATTEMPTS` | `3` | Jobs that have been tried this many times are not claimed again. |
| `WORKER_LEASE_S` | `300` | Lease length. A job whose lease expires can be reclaimed by another worker (ADR 0011). |
| `STORAGE_DRIVER` | `local` | `local` (development) or `s3`. |
| `STORAGE_LOCAL_DIR` | `.data/storage` | A relative path is resolved from the repository root (nearest `pnpm-workspace.yaml`), the same folder the web app uses. |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | | Same variables as the web app. Read-only access is enough. |

## Contract with the web app

The database schema is owned by `prisma/schema.prisma`. The worker uses plain SQL
against it; `tests/test_pipeline.py` and `tests/test_jobs.py` run against the real migrated
schema, so schema changes that break the worker fail its tests. JSON written to the
database follows `contracts/geo/v1` (see `contracts/geo/README.md`); `tests/test_contract.py`
checks the worker's output against it. Storage key rules are mirrored in
`src/trailworker/storage.py` and `lib/storage/keys.ts`, with matching test cases.

## Deployment

The `Dockerfile` builds a standalone image. Where it runs in production is decided
in Milestone 7 (ADR 0001).
