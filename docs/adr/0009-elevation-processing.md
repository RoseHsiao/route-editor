# 0009: Elevation from source files; DEM deferred

**Status:** Accepted (2026-11-03)

## Context
GPS altitude is noisy and inflates total ascent. A DEM gives more consistent values, but adds licensing, data volume, and processing complexity.

## Decision
- The initial pipeline uses elevation present in the source file only.
- Processing: resample to a fixed spacing along the line, smooth, then compute ascent and descent. The exact method and parameters are recorded per profile in `variant_profiles.processing_params` and tested against fixtures with known totals.
- *Update 2026-11-04 (M2, moved forward from M3 at the maintainer's request):* the method is fixed as 25 m resampling by linear interpolation along the geodesic distance, a centred 7-sample moving average with shrinking edges, and ascent/descent as sums of positive/negative differences, never across a break between source segments. Raw source elevation stays unchanged in the segment geometry; profiles hold derived values only and can be rebuilt from the stored parameters. Details and tolerances: [IMPORT_PIPELINE.md](../IMPORT_PIPELINE.md#distance-and-elevation).
- If any vertex lacks elevation, the segment is stored 2D, the profile is marked incomplete (`elevation_complete = false`, empty elevation array), and metrics that depend on elevation are `NULL`. No interpolation across gaps, no fabricated values.
- DEM fallback (`elevation_source = DEM`) is added only after this pipeline is verified, with a licence review of the DEM source.

## Consequences
- Some imported routes have no elevation profile, and the UI says so.
- Totals may differ from other tools. The method is documented so users can see why.
