# 0005: Configurable basemap, OpenFreeMap for development

**Status:** Accepted (2026-11-03)

## Context
MapLibre needs a vector style and tiles. Providers differ in terms, limits, attribution, and cost, and `tile.openstreetmap.org` is not meant for application traffic.

## Decision
- The style URL comes from `NEXT_PUBLIC_MAP_STYLE_URL`. The code has no default provider (`lib/map/config.ts` returns `null`, and the UI must show a configuration message).
- Development uses OpenFreeMap (`https://tiles.openfreemap.org/styles/liberty`).
- The production provider is chosen later, after a review of its terms, documented in DATA_SOURCES.md.

## Consequences
- Attribution comes from the style's sources and must stay visible.
- Self-hosting (e.g. Protomaps PMTiles) remains possible without code changes.
