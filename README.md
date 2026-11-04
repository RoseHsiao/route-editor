# TrailPlanner

TrailPlanner is an open-source planner for multi-day hikes and long-distance treks.
It starts from existing trail data, not from routes you draw yourself. It splits a
trail into daily stages that fit your limits and your accommodation bookings, and
then lets you shape each day yourself.

> **Status: early development (Milestone 1 of 7).** The foundations are in place:
> database schema, design system, storage, worker skeleton, and test infrastructure.
> Trail import, planning and export are not implemented yet. See the [roadmap](#roadmap).

## Features

Planned features. ✅ marks what works today.

- ✅ PostGIS data model for trails, variants, POIs, treks, and data provenance
- ✅ Design system: editorial typography, stage palette, accommodation reliability states
- Browse curated trails, or import your own GPX, GeoJSON, and CSV (POIs)
- Map with trail geometry, variants, POIs, and a synchronized elevation profile
- Auto-plan: a deterministic, explainable split of a trail into daily stages
- Manual planning: move endpoints, split and merge days, rest days, lock days, partial recalculation
- Accommodation: your bookings, recommendations, or a mix. A recommendation is never shown as a booking
- GPX export (whole trek or per day) and a printable PDF itinerary

The first demonstration trail will be the Tour du Mont Blanc, built from
OpenStreetMap data with proper attribution (see [Data licensing](#data-licensing)).
Nothing in the planning engine is specific to TMB.

## Screenshots

_Placeholder: screenshots will be added once the trek editor exists (Milestone 6)._

## Technology

| Area | Choice |
|---|---|
| Web app | Next.js (App Router), React, TypeScript (strict), Tailwind CSS, shadcn/ui with Base UI, Lucide |
| Maps and charts | MapLibre GL JS with a configurable style URL; Recharts |
| Data | PostgreSQL + PostGIS, Prisma ORM (with parameterized SQL for geometry) |
| Geo processing | Python worker: gpxpy, Shapely, pyproj (GeoPandas and Rasterio when needed) |
| Storage | S3-compatible object storage; filesystem adapter for development |
| Quality | Vitest, Playwright, ESLint, `tsc`, pytest, ruff, mypy |

The architecture is explained in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Local setup

Prerequisites: Node.js 22 or later, pnpm 10, Docker with Compose, and [uv](https://docs.astral.sh/uv/) for the Python worker.

```sh
pnpm install                 # also generates the Prisma client
cp .env.example .env         # local-only defaults; never commit .env
pnpm db:up                   # PostgreSQL 17 + PostGIS 3.5 on localhost:5433
pnpm db:deploy               # apply migrations
pnpm worker:sync             # create the worker's project-local virtualenv
pnpm dev                     # http://localhost:3000
```

The [development guide](docs/DEVELOPMENT.md) covers Apple Silicon notes, Colima,
resetting databases, and troubleshooting.

## Environment variables

All variables are documented in [`.env.example`](.env.example). The main ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Application database (PostGIS) |
| `TEST_DATABASE_URL` | Separate database for integration tests. Its name must contain `test` |
| `STORAGE_DRIVER` | `local` (development only) or `s3` |
| `NEXT_PUBLIC_MAP_STYLE_URL` | MapLibre style. The code has no default provider |
| `AUTH_DEV_STUB` | Development-only stub user. The app refuses to start in production with it set |

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js development, production build, production server |
| `pnpm typecheck` | Route type generation + `tsc --noEmit` |
| `pnpm lint` | ESLint, including module-boundary rules |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:integration` | Integration tests against the PostGIS test database |
| `pnpm test:e2e` | Playwright end-to-end tests (desktop and mobile) |
| `pnpm check` | typecheck + lint + unit tests |
| `pnpm db:up` / `db:down` | Start or stop local PostGIS |
| `pnpm db:migrate` / `db:deploy` | Create a migration in development / apply migrations |
| `pnpm worker:test` / `worker:lint` | Worker pytest / ruff + mypy |

## Testing

- **Unit tests** cover pure domain modules: coordinates, distance mapping, storage, auth guard, accommodation rules.
- **Integration tests** run against a real PostGIS database. No geometry is mocked. They cover schema invariants, geometry round-trips, and licensing constraints.
- **Worker tests** cover configuration and storage, and run queue behaviour against the same migrated schema.
- **End-to-end tests** (Playwright) cover the main pages on desktop and mobile.

The [development guide](docs/DEVELOPMENT.md#testing) explains the test databases and their safety checks.

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| 1 | Project setup, design system, schema, documentation, test infrastructure | ✅ awaiting review |
| 2 | Trail import (GPX, GeoJSON), processing pipeline, trail map | |
| 3 | POIs, elevation profile, trail detail page | |
| 4 | Accounts, trek creation, constraints, accommodation | |
| 5 | Auto-planning engine | |
| 6 | Manual editor, locking, partial recalculation | |
| 7 | GPX and PDF export, end-to-end journey, production readiness | |

Full plan: [docs/PLAN.md](docs/PLAN.md). Decisions: [docs/adr/](docs/adr/).

## Data licensing

The application code is licensed under Apache-2.0. **Trail and map data are licensed
separately**, and each dataset records its own licence:

- The repository contains **synthetic** test and demo data only, clearly labelled as such.
- OpenStreetMap-derived data (such as the optional TMB import) is © OpenStreetMap contributors under the [ODbL](https://opendatacommons.org/licenses/odbl/), and is attributed wherever it is shown.
- Publicly accessible data is not assumed to be reusable. A dataset can only be made public when its redistribution rights are confirmed, and the database enforces this.
- Do not commit third-party GPX files or other data without redistribution rights.

See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE). See [ADR 0010](docs/adr/0010-code-license.md).
