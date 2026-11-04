# Development guide

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 22 or later (developed on 24) | |
| pnpm | 10 | `corepack enable` or `npm i -g pnpm` |
| Docker + Compose | any recent version | Docker Desktop, OrbStack, or Colima |
| uv | 0.13 or later | Python toolchain for the worker. Creates a project-local `.venv` |

**macOS without Docker Desktop:** `brew install colima docker docker-compose`, then
`colima start --cpu 2 --memory 4`. Homebrew's Compose is a standalone `docker-compose` binary.
Either register it as a CLI plugin (see `brew info docker-compose`) so that `pnpm db:up` works,
or run `docker-compose up -d --wait` directly.

**Apple Silicon:** the default database image is `imresamu/postgis:17-3.5`, a multi-arch
(amd64/arm64) build of the official docker-postgis sources. The official `postgis/postgis` images
are amd64-only. To use them anyway, set `POSTGIS_IMAGE=postgis/postgis:17-3.5`.

## First run

```sh
pnpm install
cp .env.example .env
pnpm db:up && pnpm db:deploy
pnpm worker:sync
pnpm dev
```

`GET /api/health` should return `{"status":"ok","database":"ok","postgis":"3.5.x"}`.

## Repository safety

- This is a standalone git repository. Check with `git rev-parse --show-toplevel` before running
  git commands, especially if your home directory is itself a git repository.
- `.env*` files are ignored (except `.env.example`). So are `.data/` (local storage),
  `fixtures/private/`, and `lib/generated/`.

## Databases

Docker Compose starts one PostgreSQL server (port **5433**) with two databases:

| Database | Used by | Created by |
|---|---|---|
| `trailplanner` | `pnpm dev`, end-to-end tests | `POSTGRES_DB` |
| `trailplanner_test` | integration tests, worker tests | `docker/postgres/init/01-test-database.sql` |

The init script runs only when the volume is **first** created. PostGIS is enabled by the first
Prisma migration, not by the init script.

Useful commands:

```sh
pnpm db:migrate --name <change>     # create and apply a migration (development database)
pnpm db:deploy                      # apply pending migrations
pnpm db:studio                      # browse data
docker-compose down -v              # delete the local databases entirely (destructive)
```

To rebuild only the test schema from scratch (destroys data in `trailplanner_test`):

```sh
DATABASE_URL="$TEST_DATABASE_URL" pnpm exec prisma migrate reset
```

## Testing

| Suite | Command | Needs |
|---|---|---|
| Unit | `pnpm test` | nothing |
| Integration | `pnpm test:integration` | PostGIS running |
| Worker | `pnpm worker:test` | PostGIS running for queue tests (skipped otherwise) |
| End to end | `pnpm test:e2e` | PostGIS running, migrated development database. First run: `pnpm exec playwright install chromium` |

**Test database safety.** Integration and worker tests truncate tables. They refuse to run
unless the database name contains `test`, it differs from `DATABASE_URL`, and it is local
(outside CI). Integration setup applies pending migrations with `prisma migrate deploy`, which
never drops data, and each test starts from truncated tables.

**End-to-end tests** run against `next dev` until M4, because production builds (correctly)
refuse the development user stub. They use the development database.

## Authentication in development

With `AUTH_DEV_STUB=true`, `getCurrentUser()` returns a real `users` row for
`AUTH_DEV_STUB_EMAIL`. Starting a production build (`next start`) or deploying on Vercel with
the stub enabled fails at startup. This is intentional. Remove the variable to run
`pnpm build && pnpm start` locally.

## Design system

Tokens live in `app/globals.css` and are shown at `/design-system`.

- **Type:** Source Serif 4 for headings, Inter for interface text, JetBrains Mono for coordinates. Use the `.metric` class for numbers (tabular figures).
- **Colour:** warm paper neutrals and ink foreground. Pine `primary`, glacier `info`, ochre `caution`, rust `destructive`.
- **Stages:** `--stage-1` to `--stage-8` for daily segments. They repeat after day 8, and adjacent days always differ.
- **POIs:** `--poi-*` per POI type.
- **Accommodation status** is always rendered with `<ReliabilityBadge>`, never with an ad-hoc colour.
- Dark tokens exist under `.dark`. The theme switch is not wired up yet.

## Worker

See [workers/geo-processing/README.md](../workers/geo-processing/README.md).
`pnpm worker:lint` runs ruff (lint and format check) and `mypy --strict`.

## Next.js version notes

This project uses Next.js 16 with Cache Components and Partial Prefetching. Bundled docs are in
`node_modules/next/dist/docs/` (see `AGENTS.md`). Uncached reads (database) belong inside
`<Suspense>` and call `await connection()`.
