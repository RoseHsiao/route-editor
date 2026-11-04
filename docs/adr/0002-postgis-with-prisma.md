# 0002: PostGIS with Prisma, using raw SQL for geometry

**Status:** Accepted (2026-11-03)

## Context
The stack mandates Prisma and PostGIS. Prisma has no geometry types.

## Decision
- Spatial columns are declared as `Unsupported(...)`. GIST indexes, the PostGIS extension, and partial unique indexes are declared in the schema (preview features `postgresqlExtensions` and `partialIndexes`).
- All geometry I/O goes through `lib/db/geometry.ts` using tagged-template raw SQL (bind parameters only).
- Invariants Prisma cannot express (CHECK constraints, triggers) are appended to migrations by hand. M1 verified that Prisma leaves them alone in later diffs.
- `trail_segments.geometry` is an untyped `geometry` column whose type, SRID, and dimension are enforced by CHECK constraints, because a PostGIS typmod would fix the dimension and reject 3D lines.
- Local development uses Docker Compose with PostgreSQL 17 + PostGIS 3.5 (multi-arch image). No production database resources are created during development milestones.

## Consequences
- Prisma does not diff inside `Unsupported` types. Spatial type changes need hand-written migrations (documented in DATA_MODEL.md).
- `@updatedAt` is set by the client, so raw SQL must set `updated_at` itself.
- Geometry behaviour is tested against real PostGIS, never mocked.
