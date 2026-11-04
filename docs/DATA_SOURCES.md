# Data sources and licensing

The application code is Apache-2.0. **Data is licensed separately**, and each dataset carries
its own licence in `trail_datasets`. Publicly accessible data is not assumed to be free to
reuse. See [ADR 0003](adr/0003-data-provenance-and-licensing.md).

## Source categories

| `source_category` | Meaning | Default visibility |
|---|---|---|
| `OFFICIAL` | Published by the trail's managing body | Private until the licence is verified |
| `OPEN_DATA` | Under an open licence (e.g. OpenStreetMap, ODbL) | Public only with attribution and confirmed redistribution |
| `THIRD_PARTY` | Commercial or community sites with their own terms | Private unless written permission exists |
| `USER_UPLOAD` | Uploaded by a user | Private to that user |
| `SYNTHETIC` | Generated for development, tests, and demos | Public. Always labelled synthetic |

## What we record for every dataset

`source_name`, `source_url`, `license` (SPDX identifier where possible), `attribution_text`,
`commercial_use_allowed`, `redistribution_allowed`, `license_verified_at`, `version`,
`imported_at`, `raw_file_id` (the original file, stored unchanged), and the import job's
validation report.

`commercial_use_allowed` and `redistribution_allowed` are **tri-state**. `NULL` means unknown,
and unknown is treated as not allowed. The database refuses to make a dataset public unless
`redistribution_allowed` is true.

## Data in this repository

- **Synthetic only.** Fixtures and demo data are generated and labelled `SYNTHETIC`. They are
  never presented as a real trail, even when they resemble one.
- **No third-party files.** For example, the TMBmap.com GPX used for local testing lives in the
  gitignored `fixtures/private/` folder. It must never be committed, seeded, or redistributed.
  `.gitignore` also blocks any file with "tmbmap" in its name.

## User imports (M2)

Uploaders declare the origin of each file: their own recording (`USER_UPLOAD`), another
website or app (`THIRD_PARTY`), or open data (`OPEN_DATA`, attribution required). `OFFICIAL`
and `SYNTHETIC` cannot be declared at upload. Imported datasets are always `PRIVATE`, the raw
file is kept unchanged with its SHA-256, and the route page says that imported data is not
official trail data. See [IMPORT_PIPELINE.md](IMPORT_PIPELINE.md#provenance).

## OpenStreetMap (planned, M3)

An opt-in script will import the Tour du Mont Blanc route relation and nearby huts, springs,
and passes via Overpass:

- It runs on the developer's machine. OSM extracts are not committed.
- The data is recorded as `OPEN_DATA`, licence `ODbL-1.0`, with attribution
  "© OpenStreetMap contributors". The attribution is shown wherever the data appears: map, trail
  page, exports.
- A database built from OSM is a derivative database under the ODbL. If we redistribute it, it
  must be offered under the ODbL. Documents produced from it (maps, PDFs) must carry the
  attribution.
- OSM tags say a hut exists, not that a bed is free. Imported huts get the reliability
  `UNVERIFIED` (ADR 0006).

## Basemaps

The basemap is configured per deployment (`NEXT_PUBLIC_MAP_STYLE_URL`, ADR 0005).

- **Development:** [OpenFreeMap](https://openfreemap.org/), which needs no API key. Its tiles are
  built from OpenStreetMap data, so the map must show OSM attribution (the style's attribution
  control does this).
- **Production:** not decided yet. Before choosing a provider, review its terms for traffic
  limits, commercial use, required attribution, and whether tiles may be cached or printed.
  `tile.openstreetmap.org` is not suitable for application traffic under its usage policy.
- **PDF exports** use no basemap tiles in the first version (ADR 0008).

## Elevation

Elevation comes from the source file, resampled and smoothed (ADR 0009). DEM sources such as
Copernicus GLO-30 or SRTM are deferred. Their licences will be reviewed and recorded here before
use.

## Last verified

| Source | Licence | Verified |
|---|---|---|
| Synthetic fixtures (RouteEditor, `fixtures/synthetic/`) | CC0-1.0 | n/a, generated |
| OpenStreetMap | ODbL-1.0 | to be verified at M3 |
| OpenFreeMap (development basemap) | OSM data, ODbL; see provider terms | to be verified before production |
