# 0008: PDF maps as deterministic SVG without basemap tiles

**Status:** Accepted (2026-11-03)

## Context
Printed itineraries need maps. Rendering MapLibre on a server is hard in serverless environments, and printing third-party tiles needs licences we have not verified.

## Decision
- The first PDF version draws maps as SVG from our own geometry: route line, daily stage boundaries in stage colours, POI symbols, and elevation profiles. There are no basemap tiles.
- The output is deterministic for a given itinerary version (`export_records.input_hash`).
- The renderer is chosen at M7, favouring one that runs without a headless browser.

## Consequences
- Maps carry less context than a topographic map. The PDF says so and recommends carrying a proper map.
- OSM-derived geometry still requires ODbL attribution in the PDF.
