# 0001: Modular monolith with a separate Python geo worker

**Status:** Accepted (2026-11-03)

## Context
RouteEditor needs an interactive web app and heavy geospatial processing (parsing, validation, geodesic distance, elevation smoothing). The Python geospatial ecosystem (gpxpy, Shapely, pyproj, GeoPandas, Rasterio) is mature but does not run well inside Vercel functions. Microservices would add operational cost the project does not need yet.

## Decision
- One Next.js application with a TypeScript service layer and pure domain modules.
- One Python worker for import processing, deployed separately as a container.
- The database is the only integration point. Jobs are queued in `import_jobs` and claimed with `FOR UPDATE SKIP LOCKED`. There is no message broker.
- The planning engine is TypeScript (pure, in `lib/planning`), so planning and editing stay interactive. It consumes profiles precomputed by the worker.
- The worker's production host is chosen in M7.

## Consequences
- Two languages share a schema. The worker's tests run against the Prisma-migrated schema to catch drift.
- Distances are computed only in Python, so the two languages never disagree about them.
- Several workers can run side by side safely. Retries are capped (`WORKER_MAX_ATTEMPTS`).
