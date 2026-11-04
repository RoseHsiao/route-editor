# 0003: Data provenance and licensing

**Status:** Accepted (2026-11-03)

## Context
Trail data is often publicly accessible but not licensed for reuse. RouteEditor is a public repository and may become a public service.

## Decision
- Every dataset records its source category, URL, licence, attribution, commercial-use and redistribution permissions (tri-state: `NULL` = unknown = not allowed), verification date, version, and the raw file.
- Raw uploaded files are kept unchanged in storage, separately from normalized data.
- The repository contains synthetic data only, labelled `SYNTHETIC`. Real-world demo data (TMB) comes from OpenStreetMap through an opt-in local script, under the ODbL with attribution.
- The database refuses to make a dataset public unless redistribution is explicitly allowed.
- Third-party files used for local testing (e.g. the TMBmap.com GPX) stay in gitignored `fixtures/private/`.

## Consequences
- Publishing a curated trail requires a recorded licence review.
- ODbL share-alike applies to any OSM-derived database we redistribute. Attribution appears on maps and exports.
