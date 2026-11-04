# Architecture Decision Records

Short records of decisions with significant consequences. Status is one of: Proposed, Accepted, Superseded.

| # | Decision | Status |
|---|---|---|
| [0001](0001-modular-monolith-with-python-worker.md) | Modular monolith with a separate Python geo worker | Accepted |
| [0002](0002-postgis-with-prisma.md) | PostGIS with Prisma, using raw SQL for geometry | Accepted |
| [0003](0003-data-provenance-and-licensing.md) | Data provenance and licensing | Accepted |
| [0004](0004-authentication-seam.md) | Auth.js behind `getCurrentUser()`, with a development stub | Accepted |
| [0005](0005-basemap-provider.md) | Configurable basemap, OpenFreeMap for development | Accepted |
| [0006](0006-accommodation-reliability.md) | Accommodation reliability states | Accepted |
| [0007](0007-manual-edits-lock-days.md) | Manual edits lock days automatically | Accepted |
| [0008](0008-pdf-vector-maps.md) | PDF maps as deterministic SVG without basemap tiles | Accepted |
| [0009](0009-elevation-processing.md) | Elevation from source files; DEM deferred | Accepted |
| [0010](0010-code-license.md) | Apache-2.0 for code, separate from data | Accepted |
| [0011](0011-import-job-leases.md) | Import job leases and atomic publication | Accepted |

To add a record, copy the structure of an existing one: Context, Decision, Consequences.
