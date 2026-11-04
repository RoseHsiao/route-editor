# Implementation plan

Approved 2026-11-03, with the adjustments listed below. Each milestone ends with:
type checking, linting, relevant tests, a production build where appropriate,
updated documentation, and a written summary of completed work and remaining risks.
Nothing is committed, pushed, deployed, or applied to production without explicit approval.
A milestone starts only after the previous one has been reviewed and approved.

## Adjustments from plan review

| Topic | Decision | Recorded in |
|---|---|---|
| Repository | Standalone repository at `~/route-editor`. No operations on the home-directory repository | [DEVELOPMENT.md](DEVELOPMENT.md) |
| Local database | Docker Compose, PostgreSQL + PostGIS, reproducible for contributors. No production resources | [ADR 0002](adr/0002-postgis-with-prisma.md) |
| Python tooling | uv with a project-local virtualenv. No global installs | [workers/geo-processing/README.md](../workers/geo-processing/README.md) |
| Demo data | Synthetic fixtures in the repository, plus an optional OSM import script with ODbL attribution. The TMBmap.com file stays private | [ADR 0003](adr/0003-data-provenance-and-licensing.md) |
| Code license | Apache-2.0, separate from data licences | [ADR 0010](adr/0010-code-license.md) |
| Authentication | Auth.js behind `getCurrentUser()`; development stub until M4, refused in production | [ADR 0004](adr/0004-authentication-seam.md) |
| Basemap | OpenFreeMap in development. Style URL from the environment; no provider hard-coded | [ADR 0005](adr/0005-basemap-provider.md) |
| Accommodation | Four reliability states. A POI is never assumed to be available | [ADR 0006](adr/0006-accommodation-reliability.md) |
| Manual edits | Editing a day locks it automatically. Locks are visible and can be removed explicitly | [ADR 0007](adr/0007-manual-edits-lock-days.md) |
| PDF | Deterministic SVG vector maps, no basemap tiles in the first version | [ADR 0008](adr/0008-pdf-vector-maps.md) |
| Elevation | Use elevation from source files, resampled and smoothed. Missing elevation is marked incomplete. DEM fallback deferred | [ADR 0009](adr/0009-elevation-processing.md) |
| Worker hosting | Deferred to M7; the worker stays independently deployable | [ADR 0001](adr/0001-modular-monolith-with-python-worker.md) |

## Milestones

### M1: Foundations ✅ (awaiting review)

- Next.js App Router, strict TypeScript, Tailwind, shadcn/ui on Base UI, Lucide
- Design system: tokens, typography, stage and POI palettes, reliability badges, `/design-system`
- Prisma schema with PostGIS, initial migration including CHECK constraints and a trigger
- Docker Compose (PostGIS) with a separate test database
- Storage interface with local and S3 adapters
- Authentication seam with a production-refusing development stub
- Python worker skeleton: config, storage, job queue (SKIP LOCKED), structured failures, Dockerfile
- Test infrastructure: Vitest (unit and integration), Playwright (desktop and mobile), pytest, ruff, mypy
- Repository documents and ADRs

### M2: Trail import and visualization

- Upload flow: presigned uploads (S3), development upload route (local), `StoredFile` + `ImportJob`
- Worker: GPX (`trk`, `rte`, `wpt`) and GeoJSON parsing; coordinate validation; detection of duplicates, spikes and gaps; CRS normalization; geodesic distance; segments; variants; resampled profile; validation report
- Synthetic fixtures (GPX, GeoJSON) and a fixture generator
- Trail map (MapLibre) with variant geometry
- Acceptance: synthetic fixtures and the private TMBmap file import correctly. Invalid or disconnected inputs fail with structured errors

### M3: POIs, elevation profile, trail detail

- CSV POI import; snapping POIs to variants (`PoiPosition`); season windows; reliability defaults
- Elevation smoothing per ADR 0009; profile chart (Recharts) synchronized with the map
- Trail detail and Explore pages with search and filters
- Optional OSM import script for TMB (ODbL, attributed, opt-in)
- Acceptance: fixture ascent and descent within the documented tolerance. Missing elevation is flagged, never filled in

### M4: Accounts and trek setup

- Auth.js sessions behind `getCurrentUser()`; the stub stays development-only
- Trek setup: trail, variant, direction, dates, fitness, limits, rest days, bookings, recommendations
- Booking validation: dates, order along the direction of travel, duplicates
- My Treks
- Acceptance: conflicting bookings are rejected with explanations

### M5: Auto-planning engine

- Pure TypeScript engine in `lib/planning` (see [PLANNING_ALGORITHM.md](PLANNING_ALGORITHM.md))
- Metrics, time model, hard-constraint filtering, weighted scoring, DP over pinned intervals, infeasibility explanations
- Acceptance: unit tests for every constraint and edge case. Integration test from the engine through to the database

### M6: Trek editor

- Daily stage list, map, and elevation panel kept in sync
- Move endpoints, change stops, rest days, split and merge, lock and unlock, personal POIs and notes
- Partial recalculation that preserves locked days and bookings (property-tested)

### M7: Export and production readiness

- GPX (whole trek, per day, waypoints), validated against the GPX 1.1 XSD
- PDF itinerary with SVG maps (ADR 0008); `ExportRecord` reproducibility via input hashes
- Playwright end-to-end journey: import → trek → auto-plan → edit → export
- Worker hosting decision, security review, observability, CI

## Major risks

1. **Data licensing for real trails.** Mitigation: synthetic data in the repository; OSM opt-in; database-enforced publication rule.
2. **Elevation quality** (noisy GPS heights inflate ascent). Mitigation: resampling, documented smoothing, recorded elevation source, fixture tolerances.
3. **Prisma has limited PostGIS support.** Mitigation: `Unsupported` columns, hand-written SQL in migrations, a single geometry helper module, real-database tests. See [DATA_MODEL.md](DATA_MODEL.md).
4. **Contract between TypeScript and Python** (shared tables, profile format). Mitigation: a versioned profile schema; worker tests run against the Prisma-migrated schema.
5. **PDF maps without a basemap** may look sparse. Mitigation: careful vector design; basemaps only after a licence review.
6. **Scope.** Mitigation: milestones are judged on verified, working behaviour, not on the number of features started.
