import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { normalizedImportSchema, type NormalizedImport } from "@/lib/import/contract";
import {
  buildMapData,
  elevationCoverage,
  groupIssues,
  profileBreaksKm,
  profileChartPoints,
  type RouteVariantView,
  type WaypointView,
} from "@/lib/import/route-view";

function example(name: string): NormalizedImport {
  const file = path.join(import.meta.dirname, "../../../contracts/geo/v1/examples", `${name}.json`);
  return normalizedImportSchema.parse((JSON.parse(readFileSync(file, "utf8")) as { normalized: unknown }).normalized);
}

function views(document: NormalizedImport): { variants: RouteVariantView[]; waypoints: WaypointView[] } {
  return {
    variants: document.lines.map((line, index) => ({
      id: `v${index}`,
      name: line.name,
      sourceKind: line.sourceKind,
      sourceIndex: line.sourceIndex,
      isMain: line.isMain,
      distanceKm: line.distanceKm,
      ascentM: line.ascentM,
      descentM: line.descentM,
      segments: line.segments.map((segment) => ({
        sourcePartIndex: segment.sourcePartIndex,
        coordinates: segment.coordinates,
        hasElevation: segment.hasElevation,
        pointCount: segment.pointCount,
        elevationPointCount: segment.elevationPointCount,
        distanceKm: segment.distanceKm,
      })),
      profile: line.profile,
    })),
    waypoints: document.waypoints,
  };
}

describe("map data", () => {
  const mixed = example("mixed-trk-rte-wpt");
  const { variants, waypoints } = views(mixed);
  const data = buildMapData(variants, waypoints, mixed.report.issues);

  it("draws each source segment separately, never joined", () => {
    const track = data.routes.features.filter((feature) => feature.properties.sourceKind === "TRACK");
    expect(track.map((feature) => feature.properties.sourcePartIndex)).toEqual([0, 1]);
    expect(data.routes.features.filter((feature) => feature.properties.sourceKind === "ROUTE")).toHaveLength(1);
  });

  it("keeps tracks, routes and waypoints distinguishable", () => {
    expect(new Set(data.routes.features.map((feature) => feature.properties.sourceKind))).toEqual(
      new Set(["TRACK", "ROUTE"]),
    );
    expect(data.waypoints.features.map((feature) => feature.properties.name)).toEqual([
      "Synthetic spring",
      "Synthetic hut",
      "Synthetic viewpoint",
    ]);
  });

  it("marks the discontinuity between track segments as an issue, not as route", () => {
    const discontinuity = data.issues.features.filter((feature) => feature.properties.code === "SEGMENT_DISCONTINUITY");
    expect(discontinuity.map((feature) => feature.geometry.type).sort()).toEqual(["LineString", "Point"]);
    // Route long-leg notes are informational and do not clutter the map.
    expect(data.issues.features.some((feature) => feature.properties.code === "ROUTE_LONG_LEG")).toBe(false);
  });

  it("computes bounds over routes and waypoints", () => {
    expect(data.bounds).not.toBeNull();
    const [[west, south], [east, north]] = data.bounds!;
    for (const waypoint of waypoints) {
      expect(waypoint.longitude).toBeGreaterThanOrEqual(west);
      expect(waypoint.longitude).toBeLessThanOrEqual(east);
      expect(waypoint.latitude).toBeGreaterThanOrEqual(south);
      expect(waypoint.latitude).toBeLessThanOrEqual(north);
    }
  });

  it("has nothing to draw for nothing", () => {
    expect(buildMapData([], [], []).bounds).toBeNull();
  });
});

describe("profile chart", () => {
  it("inserts a break at every segment start after the first", () => {
    const track = example("mixed-trk-rte-wpt").lines.find((line) => line.sourceKind === "TRACK")!;
    const points = profileChartPoints(track.profile)!;
    expect(points).toHaveLength(track.profile.distancesKm.length + 1);
    const breakIndex = points.findIndex((point) => point.elevationM === null);
    expect(breakIndex).toBe(track.profile.segmentStartIndices[1]);
  });

  it("returns nothing when elevation is incomplete, instead of zeros", () => {
    const line = example("track-quality-issues").lines[0]!;
    expect(line.profile.elevationComplete).toBe(false);
    expect(profileChartPoints(line.profile)).toBeNull();
  });
});

describe("elevation coverage", () => {
  it("counts points, so partial elevation is not reported as none", () => {
    const { variants } = views(example("track-quality-issues"));
    expect(elevationCoverage(variants[0]!)).toEqual({ points: 201, withElevation: 196 });
  });

  it("lists the km of every profile break", () => {
    const track = example("mixed-trk-rte-wpt").lines.find((line) => line.sourceKind === "TRACK")!;
    expect(profileBreaksKm(track.profile)).toEqual([track.profile.distancesKm[82]]);
  });
});

describe("issue grouping", () => {
  it("orders by severity and keeps every occurrence", () => {
    const groups = groupIssues(example("track-quality-issues").report.issues);
    expect(groups[0]!.severity).toBe("warning");
    expect(groups.at(-1)!.severity).toBe("info");
    expect(groups.find((group) => group.code === "INVALID_ELEVATION")!.items).toHaveLength(2);
  });
});
