# Data model

The source of truth is [`prisma/schema.prisma`](../prisma/schema.prisma), together with the
hand-written SQL in [`prisma/migrations/`](../prisma/migrations/). Postgres tables and columns
use snake_case; Prisma names use camelCase.

## Entities

```
users ─┬─< stored_files ─< import_jobs >─ trail_datasets
       ├─< trails ─< trail_datasets ─┬─< trail_segments ─< variant_segments >─┐
       │                             ├─< trail_variants ─────────────────────┘
       │                             │        ├── variant_profiles (1:1)
       │                             │        └─< poi_positions >─ trail_pois
       │                             └─< trail_pois
       └─< treks ─┬─< trek_days ── overnight_stop ──> trek_stops
                  ├─< trek_stops ──> trail_pois (optional)
                  └─< export_records ──> stored_files
```

| Table | Purpose |
|---|---|
| `users` | Account. Auth.js tables are added in M4 |
| `stored_files` | Index of objects in storage: raw uploads and generated exports, with SHA-256 |
| `trails` | A long-distance trail. Totals are a cache of the active dataset's main variant |
| `trail_datasets` | One imported version of a trail's data, with **provenance and licence** |
| `trail_segments` | **The only place route geometry is stored** (PostGIS LineString, optional Z) |
| `trail_variants` | A named route through the dataset (main route, alternatives) |
| `variant_segments` | Ordered segments of a variant, with direction and km range |
| `variant_profiles` | Resampled km and elevation arrays: the planning engine's input (derived data) |
| `trail_pois` | Points of interest, with verification status and accommodation reliability |
| `poi_positions` | Linear reference of a POI on each variant (km, offset from the trail) |
| `treks` | A user's plan: trail, dataset, variant, direction, dates, limits, itinerary version |
| `trek_days` | One day: km range in trek km, derived metrics, lock state, overnight stop |
| `trek_stops` | Bookings, recommendations, personal POIs, notes |
| `import_jobs` | Work queue for the geo worker, with validation report and structured errors |
| `export_records` | Generated GPX and PDF files, tied to an itinerary version and an input hash |

### Differences from the original specification

| Change | Reason |
|---|---|
| Variant geometry is assembled from shared segments (`variant_segments`) instead of a geometry column on `trail_variants` | Variants that diverge and rejoin share segments, so geometry is never stored twice |
| A variant belongs to a dataset, not directly to a trail | Re-importing a trail cannot silently change existing treks |
| `routeDistanceKm` lives in `poi_positions`, not `trail_pois` | The same hut has a different km on each variant |
| `trail_segments.start/end_distance_km` live in `variant_segments` | A segment's km range depends on the variant |
| `treks.variant_id`, `target_days`, `max_distance_km`, `max_moving_hours`, `itinerary_version` added | Needed for planning and reproducible exports |
| `trek_days.overnight_stop_id` points to `trek_stops` rather than a POI | Bookings may be at places that are not in our POI data |
| `trek_stops.reliability` replaces `bookingStatus` | ADR 0006 defines four states (see below) |
| `trail_datasets` adds `source_category`, `attribution_text`, `license_verified_at`, `visibility`, `owner_user_id`, `raw_file_id` | Provenance (ADR 0003) |
| `commercial_use_allowed` and `redistribution_allowed` are nullable | `NULL` means *unknown*, which is treated as *not allowed* |

### Accommodation reliability (ADR 0006)

`USER_BOOKED` · `VERIFIED_AVAILABILITY` · `VERIFIED_AVAILABILITY_UNKNOWN` · `UNVERIFIED`

- `trail_pois.accommodation_reliability`: required for `ACCOMMODATION` POIs, forbidden for every
  other type, and never `USER_BOOKED`.
- `trek_stops.reliability`: required for overnight stops. A `SYSTEM_RECOMMENDATION` can never
  be `USER_BOOKED`.

## Units and positions

- Distances in kilometres (`*_km`), elevations in metres (`*_m`), durations in minutes.
- Coordinates in WGS 84 (SRID 4326), GeoJSON order `[lon, lat, ele?]`.
- Route km is measured along a variant in its stored direction. Trek km is measured from the
  trek's start (see [ARCHITECTURE.md](ARCHITECTURE.md#key-design-rules)).
- `trek_days` store trek km. A day's date is `start_date + day_number − 1`.

## Elevation

- A segment stores a **3D line only when every vertex has elevation**. Otherwise it is 2D, and
  `ascent_m`/`descent_m` are `NULL`. Partial elevation is never stored as if it were complete.
- `variant_profiles.elevations_m` is either empty (`elevation_complete = false`) or parallel to
  `distances_km`. `elevation_source` records where values came from (ADR 0009).
- Day metrics that need elevation (ascent, descent, maximum elevation, time) are `NULL` when the
  route's elevation is incomplete. The UI shows them as unavailable, never as zero.

## Database-enforced invariants

Prisma cannot express CHECK constraints or triggers, so they are appended by hand to the
migration SQL. Prisma ignores both when it diffs, so later migrations do not remove them
(verified: a fresh `migrate dev` after applying them produces an empty migration).

| Constraint / trigger | Rule |
|---|---|
| `trail_datasets_public_requires_redistribution` | A public dataset must have `redistribution_allowed = true` |
| `trail_datasets_one_active_per_trail` (partial unique index) | At most one active dataset per trail |
| `trail_variants_one_main_per_dataset` (partial unique index) | At most one main variant per dataset |
| `trail_segments_geometry_linestring` | Valid LINESTRING, SRID 4326, at least 2 points |
| `trail_segments_elevation_dims` | `has_elevation` ⇔ geometry is 3D |
| `trail_segments_elevation_metrics_need_elevation` | No ascent or descent without elevation |
| `variant_profiles_*` | Positive spacing; at least 2 samples; elevation array empty or parallel; `NONE` source means incomplete |
| `trail_pois_*` | Coordinate ranges; reliability rules; `MM-DD` season format |
| `trail_pois_sync_location` (trigger) | `location` point kept in sync with `latitude`/`longitude` |
| `trek_days_*` | Ordered km range; non-negative metrics; rest days cover no distance |
| `trek_stops_*` | Coordinate ranges; recommendations are never booked; reliability only on overnight stops |
| `export_records_day_number_for_day_exports` | `day_number` set exactly for per-day GPX |

Some rules span several rows (for example, a trek's variant must belong to its dataset, and
its dataset to its trail). These are validated in the service layer from M4 onwards.

## Prisma and PostGIS: limitations and conventions

- Spatial columns are declared as `Unsupported("geometry…")`. Prisma cannot read or write them;
  all geometry I/O goes through [`lib/db/geometry.ts`](../lib/db/geometry.ts) using
  `$queryRaw`/`$executeRaw` **tagged templates** (bind parameters). Never use
  `$queryRawUnsafe` with input. The only `$executeRawUnsafe` call is the test helper that
  truncates tables whose names come from the system catalogue.
- `trail_segments.geometry` is an **untyped** `geometry` column. A typmod such as
  `geometry(Geometry, 4326)` fixes the coordinate dimension and would reject 3D lines (this
  happened during M1 and was fixed in migration `segment_geometry_allow_z`). Type, SRID, and
  dimension are enforced with CHECK constraints instead.
- **Prisma does not diff inside `Unsupported(...)`.** Changing a spatial column's type produces
  an empty migration, so write the `ALTER` by hand.
- GIST indexes (`@@index([...], type: Gist)`), the `postgis` extension
  (`postgresqlExtensions`), and partial unique indexes (`partialIndexes`) are declared in the
  schema. Both preview features are enabled.
- `@updatedAt` is set by the Prisma client, not by the database. Raw SQL updates, including all
  of the worker's, must set `updated_at = now()` themselves.
- The PostGIS extension is created by the first migration, not by the Docker init script, so
  Prisma does not report drift.

## Making schema changes

1. Edit `prisma/schema.prisma`.
2. Run `pnpm db:migrate --name <change> --create-only` and review the SQL.
3. Add any CHECK constraints, triggers, or spatial type changes by hand, then run `pnpm db:migrate`.
4. Update this document and add integration tests for new invariants.
5. If the worker reads or writes the table, update its SQL and run `pnpm worker:test`.
