# Architecture

TrailPlanner is a **modular monolith** (a Next.js application with a TypeScript
service layer) plus **one separately deployable Python worker** for geospatial
processing. The PostgreSQL/PostGIS database is the only integration point between
the two. See [ADR 0001](adr/0001-modular-monolith-with-python-worker.md).

```
Browser ── Next.js App Router (React, MapLibre, Recharts)
              │
              ├─ app/api/**  route handlers (thin: validate input, call a service, map errors)
              │      │
              │      └─ services/  domain services (TrailDataService, TrekPlanningService, …)
              │             ├─ lib/planning   pure planning engine (no I/O)
              │             ├─ lib/db         Prisma client + parameterized geometry SQL
              │             └─ lib/storage    StorageAdapter (local | S3)
              │
              └─ uploads go directly to object storage (presigned URLs)

PostgreSQL + PostGIS  ◄──────  Python geo worker (workers/geo-processing)
   import_jobs (queue)            claims jobs with FOR UPDATE SKIP LOCKED,
   trail_segments, profiles, …    reads raw files from storage, writes normalized data
```

## Domains and where they live

| Domain | Code |
|---|---|
| Trail management, trail data import | `lib/trail`, `lib/import`, `services/TrailDataService` (M2), worker |
| Geospatial processing | `workers/geo-processing` (heavy work), `lib/geo` (pure helpers), `lib/db/geometry.ts` (SQL) |
| Points of interest | `lib/trail`, worker (M3) |
| Trek management and planning | `lib/trek`, `lib/planning`, `services/TrekPlanningService` (M4–M6) |
| Accommodation | `lib/accommodation`, `components/accommodation` |
| GPX and PDF export | `lib/export`, `services/ExportService` (M7) |
| Users | `lib/auth` (`getCurrentUser()`) |

## Module boundaries

These are enforced by ESLint (`eslint.config.mjs`):

- **Pure modules** (`lib/planning`, `lib/geo`, `lib/accommodation`) must not import Next.js, React,
  Prisma, `lib/db`, `lib/storage`, services, or Node I/O. They are deterministic and unit-tested
  without a database.
- **UI code** (`app/**`, `components/**`) must not import the generated Prisma client directly.
- `server-only` marks modules that must never be bundled for the browser (`lib/db/client.ts`,
  `lib/storage/index.ts`, `lib/auth/current-user.ts`).

## Key design rules

1. **Route geometry is stored once**, in `trail_segments`. Variants are ordered lists of segments.
   Day routes are cut from the variant line with `ST_LineSubstring` between trek-km positions.
   They always follow the trail; endpoints are never joined with straight lines.
2. **Distances are computed once, in Python**, with geodesic calculations. The result is stored
   in `variant_profiles`. TypeScript never recomputes distances from coordinates, so the two
   languages cannot drift apart.
3. **Route km vs trek km.** Profiles and POI positions use *route km* in the variant's stored
   direction. Treks use *trek km*, measured from where the trek starts. Reverse treks map
   `trekKm = totalKm − routeKm` (`lib/geo/trek-distance.ts`), so there is no reversed copy of the data.
4. **Metrics are always derived.** Trek day metrics are computed on the server from the profile.
   APIs accept positions (km, POI ids), never distances or times.
5. **Every itinerary change increments `treks.itinerary_version`.** Exports record the version
   and a hash of their inputs, so an export can be reproduced exactly.
6. **Honest data.** Missing elevation stays missing. Recommendations never look like bookings
   (ADR 0006). Synthetic data is labelled.

## Rendering model

Next.js 16 with Cache Components. Pages are prerendered where possible. Database reads are
dynamic: they sit inside `<Suspense>` and call `await connection()` first, so they run per
request and never at build time. `GET /api/health` reports database and PostGIS availability
without exposing any configuration.

## Background work

The worker polls `import_jobs`. Claiming a job is a single `UPDATE … WHERE id = (SELECT …
FOR UPDATE SKIP LOCKED)`, so several workers can run safely side by side. Failures are
recorded as structured `{code, message, details}` objects that the UI can show. Unexpected
exceptions are reported as `INTERNAL_ERROR`, and their stack traces stay in the worker logs.
No Redis or separate queue is needed at this scale.

## Deployment

The web app targets Vercel. The worker is a container image (`workers/geo-processing/Dockerfile`)
with no secrets baked in. Its production host is decided in M7.
