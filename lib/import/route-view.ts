/**
 * Presentation model for an imported route: what the map and the profile chart draw.
 * Pure: no I/O, no framework imports. Values come from the database as written by the
 * worker; nothing here computes distances or elevations (ARCHITECTURE.md, rule 2).
 */
import type { Issue, SourceKind } from "./contract";

export type Position = readonly number[];

export interface RouteSegmentView {
  sourcePartIndex: number;
  coordinates: readonly Position[];
  hasElevation: boolean;
  pointCount: number;
  /** Points with a valid source elevation. Equal to pointCount only when complete. */
  elevationPointCount: number;
  distanceKm: number;
}

export interface RouteProfileView {
  distancesKm: readonly number[];
  elevationsM: readonly number[];
  elevationComplete: boolean;
  elevationSource: "SOURCE_FILE" | "DEM" | "NONE";
  segmentStartIndices: readonly number[];
  sampleSpacingM: number;
  processingParams: Record<string, unknown>;
}

export interface RouteVariantView {
  id: string;
  name: string;
  sourceKind: SourceKind;
  sourceIndex: number;
  isMain: boolean;
  distanceKm: number | null;
  ascentM: number | null;
  descentM: number | null;
  segments: RouteSegmentView[];
  profile: RouteProfileView | null;
}

export interface WaypointView {
  sequence: number;
  name: string | null;
  description: string | null;
  symbol: string | null;
  sourceType: string | null;
  longitude: number;
  latitude: number;
  elevationM: number | null;
}

export const SOURCE_KIND_LABELS: Record<SourceKind, { label: string; description: string }> = {
  TRACK: { label: "Recorded track", description: "GPS points recorded while moving (GPX <trk>)." },
  ROUTE: {
    label: "Planned route",
    description: "Route points joined by straight lines (GPX <rte>). The path between them is not in the file.",
  },
  LINE: { label: "Line", description: "A GeoJSON line. The format does not say whether it was recorded or planned." },
};

/** Issue codes that have a place on the map, and how they are drawn. */
const MAPPED_ISSUES = {
  LARGE_GAP: "gap",
  GAP_TOO_LARGE: "gap",
  SEGMENT_DISCONTINUITY: "discontinuity",
  GPS_SPIKE: "spike",
  IMPLAUSIBLE_SPEED: "spike",
} as const;

export type MapIssueKind = (typeof MAPPED_ISSUES)[keyof typeof MAPPED_ISSUES];

type Feature = {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: Position[] } | { type: "Point"; coordinates: Position };
  properties: Record<string, string | number | boolean | null>;
};

export interface RouteMapData {
  routes: { type: "FeatureCollection"; features: Feature[] };
  waypoints: { type: "FeatureCollection"; features: Feature[] };
  issues: { type: "FeatureCollection"; features: Feature[] };
  bounds: [[number, number], [number, number]] | null;
}

function numberDetail(issue: Issue, key: string): number | null {
  const value = issue.details[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildMapData(
  variants: readonly RouteVariantView[],
  waypoints: readonly WaypointView[],
  issues: readonly Issue[],
): RouteMapData {
  const routes: Feature[] = [];
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const extend = (lon: number, lat: number) => {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  };

  for (const variant of variants) {
    for (const segment of variant.segments) {
      // One feature per source segment: segments are drawn separately, never joined.
      routes.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: segment.coordinates.map((p) => [p[0]!, p[1]!]) },
        properties: {
          variantId: variant.id,
          sourceIndex: variant.sourceIndex,
          sourceKind: variant.sourceKind,
          isMain: variant.isMain,
          name: variant.name,
          sourcePartIndex: segment.sourcePartIndex,
        },
      });
      for (const position of segment.coordinates) extend(position[0]!, position[1]!);
    }
  }

  const waypointFeatures: Feature[] = waypoints.map((waypoint) => {
    extend(waypoint.longitude, waypoint.latitude);
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [waypoint.longitude, waypoint.latitude] },
      properties: { sequence: waypoint.sequence, name: waypoint.name, symbol: waypoint.symbol },
    };
  });

  const issueFeatures: Feature[] = [];
  issues.forEach((issue, index) => {
    const kind = MAPPED_ISSUES[issue.code as keyof typeof MAPPED_ISSUES];
    const lon = issue.location?.lon;
    const lat = issue.location?.lat;
    if (!kind || lon === undefined || lat === undefined) return;
    const properties = { index, code: issue.code, kind, severity: issue.severity };
    issueFeatures.push({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties });
    // Gaps and discontinuities are also drawn as a dashed connector. It marks missing
    // data; it is not part of the route and is styled so it cannot be mistaken for one.
    const otherLon = numberDetail(issue, kind === "discontinuity" ? "fromLon" : "toLon");
    const otherLat = numberDetail(issue, kind === "discontinuity" ? "fromLat" : "toLat");
    if (kind !== "spike" && otherLon !== null && otherLat !== null) {
      issueFeatures.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[otherLon, otherLat], [lon, lat]] },
        properties,
      });
    }
  });

  return {
    routes: { type: "FeatureCollection", features: routes },
    waypoints: { type: "FeatureCollection", features: waypointFeatures },
    issues: { type: "FeatureCollection", features: issueFeatures },
    bounds: Number.isFinite(minLon) ? [[minLon, minLat], [maxLon, maxLat]] : null,
  };
}

export interface ProfilePoint {
  km: number;
  /** Null marks a break between source segments; the chart does not draw across it. */
  elevationM: number | null;
}

/** Chart points for a complete profile, with explicit breaks between segments. */
export function profileChartPoints(profile: RouteProfileView): ProfilePoint[] | null {
  if (!profile.elevationComplete || profile.elevationsM.length !== profile.distancesKm.length) return null;
  const starts = new Set(profile.segmentStartIndices.filter((index) => index > 0));
  const points: ProfilePoint[] = [];
  profile.distancesKm.forEach((km, index) => {
    if (starts.has(index)) points.push({ km, elevationM: null });
    points.push({ km, elevationM: profile.elevationsM[index]! });
  });
  return points;
}

/** How much of a line's source elevation is present, counted in points (not segments). */
export function elevationCoverage(variant: Pick<RouteVariantView, "segments">): {
  points: number;
  withElevation: number;
} {
  return variant.segments.reduce(
    (total, segment) => ({
      points: total.points + segment.pointCount,
      withElevation: total.withElevation + segment.elevationPointCount,
    }),
    { points: 0, withElevation: 0 },
  );
}

/** Route km where the profile restarts because source segments are not connected. */
export function profileBreaksKm(profile: RouteProfileView): number[] {
  return profile.segmentStartIndices.filter((index) => index > 0).map((index) => profile.distancesKm[index]!);
}

export function elevationRange(profile: RouteProfileView): { min: number; max: number } | null {
  if (!profile.elevationComplete || profile.elevationsM.length === 0) return null;
  return { min: Math.min(...profile.elevationsM), max: Math.max(...profile.elevationsM) };
}

export const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

/** Groups issues by code for display, most severe first, keeping every location. */
export function groupIssues(issues: readonly Issue[]): { code: string; severity: Issue["severity"]; items: Issue[] }[] {
  const groups = new Map<string, { code: string; severity: Issue["severity"]; items: Issue[] }>();
  for (const issue of issues) {
    const group = groups.get(issue.code) ?? { code: issue.code, severity: issue.severity, items: [] };
    if (SEVERITY_ORDER[issue.severity] < SEVERITY_ORDER[group.severity]) group.severity = issue.severity;
    group.items.push(issue);
    groups.set(issue.code, group);
  }
  return [...groups.values()].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.code.localeCompare(b.code),
  );
}

/** Plain-language titles for issue codes. Unknown codes fall back to the worker's message. */
export const ISSUE_TITLES: Record<string, string> = {
  LARGE_GAP: "Gaps in the recording",
  GAP_TOO_LARGE: "Gap too large",
  SEGMENT_DISCONTINUITY: "Separate segments",
  GPS_SPIKE: "Possible GPS spikes",
  IMPLAUSIBLE_SPEED: "Implausible speed",
  ROUTE_LONG_LEG: "Long straight route legs",
  DUPLICATE_POINTS_REMOVED: "Duplicate points removed",
  INVALID_ELEVATION: "Invalid elevation values",
  ELEVATION_INCOMPLETE: "Elevation incomplete",
  ELEVATION_MISSING: "No elevation",
  INVALID_COORDINATE: "Invalid coordinates",
  UNSUPPORTED_GEOMETRY: "Unsupported geometries skipped",
  UNSUPPORTED_CRS: "Unsupported coordinate system",
  CRS_REPROJECTED: "Coordinates reprojected",
  SEGMENT_TOO_SHORT: "Segments too short",
  LINE_SKIPPED: "Lines skipped",
  NO_ROUTE_GEOMETRY: "No route in the file",
  MALFORMED_XML: "Not valid XML",
  MALFORMED_JSON: "Not valid JSON",
  UNSAFE_XML: "Unsafe XML",
  NOT_GPX: "Not a GPX file",
  NOT_GEOJSON: "Not a GeoJSON file",
  INVALID_GEOMETRY: "Invalid geometry",
  EMPTY_GEOMETRY: "Features without geometry",
  EXTRA_COORDINATE_VALUES: "Extra coordinate values ignored",
  METADATA_TRUNCATED: "Large properties not kept",
  TOO_MANY_POINTS: "Too many points",
};

export function formatKm(km: number | null | undefined): string {
  if (km === null || km === undefined) return "unavailable";
  return km < 10 ? `${km.toFixed(2)} km` : `${km.toFixed(1)} km`;
}

export function formatMetres(metres: number | null | undefined): string {
  if (metres === null || metres === undefined) return "unavailable";
  return `${Math.round(metres).toLocaleString("en")} m`;
}
