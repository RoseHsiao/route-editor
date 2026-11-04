# Import pipeline (GPX / GeoJSON)

Upload → `ImportJob` → worker → validation → normalization → persistence → completion.

```
Browser ──► POST /api/imports/uploads        presign (S3) or { mode: "server" } (local)
   │            └─► PUT <presigned URL>       S3 verifies the signed SHA-256
   ├──────► POST /api/imports/uploads/complete  HEAD: size + SHA-256 must match → job
   └──────► POST /api/imports (multipart)    local driver: app stores the file → job

services/trail-data/imports.ts   StoredFile (raw bytes, SHA-256) + ImportJob (PENDING)
        │
        ▼  import_jobs, claimed with FOR UPDATE SKIP LOCKED + lease token
workers/geo-processing           checksum → parse → validate/normalize → publish (1 transaction)
        │
        ▼
trails, trail_datasets, trail_segments, trail_variants, variant_segments,
variant_profiles, dataset_waypoints          (all or nothing)
        │
        ▼
/imports/[id]  services/trail-data/route-view.ts → map, distance, profile, data-quality issues
```

## Raw input and normalized output

- The uploaded file is stored **unchanged** under an application-generated key
  (`uploads/<userId>/<uuid>.<ext>`), never derived from the file name. `stored_files.sha256`
  records its checksum. The dataset links back to it (`trail_datasets.raw_file_id`).
- The worker refuses to process bytes whose size or SHA-256 differ from the record
  (`CHECKSUM_MISMATCH`).
- Normalized geometry lives in `trail_segments`; derived profiles in `variant_profiles`. The
  raw file is never modified, and the normalized tables never hold anything the raw file
  does not support.

## Source semantics

| Source | Becomes | Notes |
|---|---|---|
| GPX `<trk>` | variant, `source_kind = TRACK` | each `<trkseg>` is one segment; segments are never joined |
| GPX `<rte>` | variant, `source_kind = ROUTE` | one segment; legs between `<rtept>` are planned straight lines |
| GPX `<wpt>` | `dataset_waypoints` row | name, desc, cmt, sym, type kept verbatim; not a POI |
| GeoJSON LineString | variant, `source_kind = LINE` | GeoJSON cannot say whether a line is recorded or planned |
| GeoJSON MultiLineString | variant, `LINE`, one segment per part | parts are never joined |
| GeoJSON Point / MultiPoint | `dataset_waypoints` rows | |
| GeoJSON Polygon, MultiPolygon | skipped, `UNSUPPORTED_GEOMETRY` warning | the import fails if no line remains |

`<trk>` and `<rte>` share one index space in file order (`trail_variants.source_index`). The
main variant is the first track, else the first route, else the first line. Source metadata
(GPX `desc`, `cmt`, `src`, `type`, `number`, links; GeoJSON properties up to 16 KB) is kept in
`source_metadata`.

## Coordinates and CRS

- GPX is WGS 84 by definition.
- **GeoJSON (RFC 7946)** has no `crs` member: positions are WGS 84 `[longitude, latitude, elevation?]`.
- **Legacy GeoJSON (2008) `crs` members** are supported on the top-level object only:
  - `{"type": "name", "properties": {"name": …}}` with OGC CRS84 or EPSG:4326 (`EPSG:4326`,
    `urn:ogc:def:crs:EPSG::4326`, `http://www.opengis.net/def/crs/EPSG/0/4326`, …): accepted as is.
  - The same form, or `{"type": "EPSG", "properties": {"code": N}}`, with any other EPSG code
    that PROJ knows and that is a 2D geographic or projected CRS: reprojected to WGS 84 with
    pyproj. `validation.source.crs` records `declared`, `source`, `target` and `reprojected`.
  - Anything else is `UNSUPPORTED_CRS`: unknown codes, `link` CRSs, 3D/compound/vertical CRSs,
    a `crs` on a nested object.
- Positions are always read as x, y (easting/longitude first), as both GeoJSON specifications
  require, including EPSG:4326. **Axes are never swapped.** When an out-of-range coordinate
  would be valid with its axes swapped, the error carries `details.hint = "AXIS_ORDER"`.
- A third value is elevation in metres, carried through reprojection unchanged.
- Out-of-range or non-numeric coordinates on a line fail the import (`INVALID_COORDINATE`).
  An unusable standalone waypoint is skipped with a warning; it does not affect the route.

## Validation rules

Thresholds are in `contracts/geo/v1/constants.json`. Gap thresholds can be set per import.

| Check | Rule | Severity |
|---|---|---|
| Duplicate points | consecutive points with identical coordinates; the first is kept | info, removed |
| GPS spike | interior point with both legs ≥ 50 m and an out-and-back detour ≥ 4 × the direct distance (tracks, lines) | warning, **kept** |
| Implausible speed | > 60 m/s between timestamped track points | warning |
| Gap inside a segment | leg > 100 m (tracks, lines) | warning `LARGE_GAP` |
| Gap inside a segment | leg > 1000 m (tracks, lines) | **error** `GAP_TOO_LARGE` |
| Route leg | leg > 1000 m between `<rtept>`s | info `ROUTE_LONG_LEG` (planned connections, never an error) |
| Between segments | distance between separate `<trkseg>`s or MultiLineString parts | `SEGMENT_DISCONTINUITY`, warning above 100 m, otherwise info; **never an error, never counted in distance** |
| Too short | segment with fewer than 2 distinct points | warning, segment skipped |
| Elevation | non-numeric, non-finite, or outside [−500, 9000] m | warning `INVALID_ELEVATION`, treated as missing |
| Elevation coverage | some points without valid elevation | warning `ELEVATION_INCOMPLETE` |
| No elevation | no point has elevation | info `ELEVATION_MISSING` |
| Size | > 25 MB or > 1,000,000 points | error |
| Unsafe XML | DTDs, entities, external references (defusedxml) | error `UNSAFE_XML` |

At most 20 issues per code are listed, plus a truncation note with the total. Every issue
has a stable `code`, a `severity`, a human-readable `message`, and where possible a
`location` (line, part and point index in the source file, lon/lat, route km).

## Distance and elevation

- **Distance** is geodesic on WGS 84 (pyproj `Geod`), summed over each segment's vertices. A
  variant's distance is the sum of its segments; the space between separate segments is not
  counted. `variant_segments.start/end_distance_km` are continuous along the variant even
  though the geometry is not. Distances are computed only in Python (ADR 0001).
- **Raw elevation** is the Z value of the stored segment geometry: the source value, never
  smoothed, never replaced. A segment is stored 3D only when every kept vertex has a valid
  elevation (`elevation_point_count = point_count`); otherwise it is 2D.
- **Profile** (`variant_profiles`), per segment, then concatenated:
  1. resample every 25 m along the geodesic distance, always including the segment end;
  2. linear interpolation of the raw elevation at each sample;
  3. centred moving average over 7 samples (175 m), window shrinking at the segment ends;
  4. ascent / descent = sum of positive / negative differences of the smoothed series.
  Nothing is interpolated, smoothed or summed across a segment break.
  `segment_start_indices` records where each segment starts; the distance repeats there.
- The exact method is stored in `processing_params`. `trailworker.profile.rebuild_from_params`
  recomputes a stored profile from the stored geometry and refuses parameters describing a
  method it does not implement. `tests/test_pipeline.py` rebuilds profiles from the database
  and checks they match.
- If any segment of a variant lacks complete elevation, the profile has no elevation
  (`elevation_complete = false`, `elevation_source = NONE`, empty array) and the variant's
  ascent and descent are `NULL`. The UI says how many points have elevation and shows the
  values as unavailable, never as zero.
- **Tolerance.** On the 10 km synthetic fixture (true ascent 600 m, descent 400 m) the method
  gives 592 m and 392 m: smoothing lowers the peak by about 4 m and raises each end sample by
  about 4 m. Tests allow ±10 m on that fixture. Totals can differ from other tools.
  This verifies the method on synthetic data only. It says nothing about the accuracy of real
  GPS or barometric elevation, which depends on the source.

## Jobs, leases and atomicity

- Claiming a job sets `status = PROCESSING`, a random `lease_token` and `lease_expires_at`
  (`WORKER_LEASE_S`, default 300 s). A job whose lease expired can be claimed again by any
  worker, which issues a new token. A job that expires on its last allowed attempt is failed
  with `LEASE_EXPIRED`. A CHECK constraint enforces `PROCESSING ⇔ lease held`.
- Every write by a worker is conditional on its token: lease renewal, failure, and the final
  publish. The publish is **one transaction** that first locks the job row and checks the
  token and expiry, then writes the trail, dataset, segments, variants, profiles, waypoints and
  the `SUCCEEDED` status. A stale worker whose job was reclaimed raises `LeaseLostError` and
  writes nothing (ADR 0011).
- Any failure rolls back the whole publish, then the job is marked `FAILED` with structured
  errors `{code, message, details, retryable}` and, where available, the validation report.
- `import_jobs.dataset_id` is unique: one job publishes at most one dataset.
- **Retry.** A job can be retried from the UI only if every error is `retryable` (storage
  unavailable, lease expired, unexpected internal error). Retrying resets it to `PENDING`,
  conditionally on it still being `FAILED`, so concurrent retries enqueue it once. Malformed
  files are not retryable: the same file would fail the same way.
- Importing into an existing trail (a new dataset version) is not supported yet
  (`UNSUPPORTED_TARGET`). Each import creates a new private trail owned by the uploader.

## Provenance

Uploaders declare where the data comes from (ADR 0003): their own recording, a third-party
website or app, or open data. `OFFICIAL` and `SYNTHETIC` cannot be chosen when uploading.
Open data requires attribution text. Permissions are tri-state (unknown = not allowed).
Imported datasets are always `PRIVATE`. The route page states that imported data is not
official trail data.

## Contract between TypeScript and Python

`contracts/geo/v1/` is the versioned contract (see its README). Python writes the shapes,
TypeScript reads them through Zod parsers, and both languages run the same example corpus.
A stored report or error list the app cannot parse is shown as a contract mismatch, never
silently reinterpreted.

## Running it locally

```sh
pnpm db:up && pnpm db:deploy
pnpm dev                 # web app
pnpm worker:run          # geo worker, polls import_jobs
```

Then open `/imports`. `pnpm worker:inspect <path>` runs parse and validation on a local file
without writing anything; use it for private files in `fixtures/private/`, such as the
TMBmap GPX. That inspection is optional, manual and local-only. It is not an M2 acceptance
criterion, and no test depends on it.

## Known limitations

Recorded at the M2 review for future work; none block M2.

- S3 direct uploads are unit-tested with mocks only, not against a real bucket. Multipart
  uploads (files over the single-PUT limit) are not supported; the 25 MB limit stays below it.
- Lines crossing the antimeridian are measured correctly but drawn incorrectly on the map.
- Large files are sent to the browser in full; there is no simplification for display.
- Vertical datums are not converted: GeoJSON elevations are taken as given.
- GPS spikes are reported, not removed, so a real spike still adds to the distance. The stored
  distance is the *source distance*. A validated distance is to be designed before M5 and is
  not approximated in the meantime.
