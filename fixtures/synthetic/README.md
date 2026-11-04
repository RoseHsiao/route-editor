# Synthetic fixtures

Generated test data, dedicated to the public domain (**CC0-1.0**). Every file is labelled
SYNTHETIC and depicts no real trail, even where coordinates fall in a real region.

Regenerate (deterministic) from `workers/geo-processing`:

```sh
uv run python scripts/generate_fixtures.py
uv run python scripts/generate_contract_examples.py   # worker output → contracts/geo/v1/examples
```

| File | Purpose | Expected outcome |
|---|---|---|
| `track-basic.gpx` | 10 km track, 25 m spacing, elevation 1000 → 1600 → 1200 m | succeeds; 10.000 km, ascent 600 m and descent 400 m within ±10 m |
| `mixed-trk-rte-wpt.gpx` | waypoints, a planned route with 1.2 km legs, a track with two `<trkseg>` 1.5 km apart | succeeds; tracks, routes and waypoints kept apart; segments not joined |
| `track-quality-issues.gpx` | duplicate point, GPS spike, 325 m gap, missing and invalid elevation | succeeds with warnings; elevation incomplete |
| `track-no-elevation.gpx` | 2D track | succeeds; no elevation profile |
| `track-large-gap.gpx` | 2 km jump inside one `<trkseg>` | fails `GAP_TOO_LARGE` |
| `invalid-coordinates.gpx` | latitude 95.1 | fails `INVALID_COORDINATE` |
| `malformed.gpx` | truncated XML | fails `MALFORMED_XML` |
| `unsafe-entity.gpx` | DTD with entity expansion | fails `UNSAFE_XML` |
| `lines-wgs84.geojson` | LineString (3D), MultiLineString (2 parts), Point, Polygon | succeeds; polygon skipped with a warning |
| `line-epsg2056.geojson` | legacy `crs` EPSG:2056 (Swiss LV95) | succeeds; reprojected to WGS 84 and recorded |
| `unknown-crs.geojson` | legacy `crs` EPSG:999999 | fails `UNSUPPORTED_CRS` |
| `swapped-axes.geojson` | `[lat, lon]` positions | fails `INVALID_COORDINATE` with an axis-order hint |
| `unsupported-only.geojson` | Polygon only | fails `NO_ROUTE_GEOMETRY` |

Real-world files without redistribution rights belong in `fixtures/private/` (gitignored),
never here.
