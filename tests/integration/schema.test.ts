import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { InvalidGeometryError, insertTrailSegment, postgisVersion, readDatasetSegments } from "@/lib/db/geometry";

import { testDb, truncateAll } from "./test-database";

const db = testDb();

async function createTrailWithDataset(overrides: { visibility?: "PUBLIC" | "PRIVATE"; redistributionAllowed?: boolean | null } = {}) {
  const trail = await db.trail.create({ data: { name: "Synthetic Ridge Traverse", slug: `synthetic-${crypto.randomUUID()}` } });
  const dataset = await db.trailDataset.create({
    data: {
      trailId: trail.id,
      sourceCategory: "SYNTHETIC",
      sourceName: "RouteEditor test fixture",
      fileType: "GEOJSON",
      license: "CC0-1.0",
      version: 1,
      visibility: overrides.visibility ?? "PRIVATE",
      redistributionAllowed: overrides.redistributionAllowed === undefined ? true : overrides.redistributionAllowed,
    },
  });
  return { trail, dataset };
}

async function createTrek() {
  const { trail, dataset } = await createTrailWithDataset();
  const variant = await db.trailVariant.create({
    data: { datasetId: dataset.id, name: "Main", isMain: true, sourceKind: "LINE", sourceIndex: 0 },
  });
  const user = await db.user.create({ data: { email: `${crypto.randomUUID()}@example.test` } });
  const trek = await db.trek.create({
    data: {
      userId: user.id,
      trailId: trail.id,
      datasetId: dataset.id,
      variantId: variant.id,
      name: "Test trek",
      startDate: new Date("2027-07-01"),
    },
  });
  return { trail, dataset, variant, user, trek };
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("PostGIS", () => {
  it("is installed", async () => {
    expect(await postgisVersion(db)).toMatch(/^3\./);
  });
});

describe("trail segments", () => {
  it("round-trips a 3D line through PostGIS", async () => {
    const { dataset } = await createTrailWithDataset();
    const coordinates = [
      [6.8, 45.9, 1010],
      [6.81, 45.91, 1100.5],
      [6.82, 45.915, 1180],
    ] as const;
    await insertTrailSegment(db, {
      datasetId: dataset.id,
      sequence: 0,
      line: { type: "LineString", coordinates },
      distanceKm: 2.1,
      ascentM: 170,
      descentM: 0,
    });

    const [segment] = await readDatasetSegments(db, dataset.id);
    expect(segment?.hasElevation).toBe(true);
    expect(segment?.geometry.coordinates).toEqual(coordinates);
  });

  it("stores a 2D line without inventing elevation", async () => {
    const { dataset } = await createTrailWithDataset();
    await insertTrailSegment(db, {
      datasetId: dataset.id,
      sequence: 0,
      line: { type: "LineString", coordinates: [[6.8, 45.9], [6.81, 45.91]] },
      distanceKm: 1.3,
    });
    const [segment] = await readDatasetSegments(db, dataset.id);
    expect(segment?.hasElevation).toBe(false);
    expect(segment?.geometry.coordinates[0]).toHaveLength(2);
  });

  it("rejects mixed 2D/3D lines before they reach the database", async () => {
    const { dataset } = await createTrailWithDataset();
    await expect(
      insertTrailSegment(db, {
        datasetId: dataset.id,
        sequence: 0,
        line: { type: "LineString", coordinates: [[6.8, 45.9, 1000], [6.81, 45.91]] },
        distanceKm: 1,
      }),
    ).rejects.toBeInstanceOf(InvalidGeometryError);
  });

  it("rejects ascent on a segment without elevation (CHECK)", async () => {
    const { dataset } = await createTrailWithDataset();
    await expect(
      db.$executeRaw`
        INSERT INTO trail_segments (id, dataset_id, sequence, source_part_index, point_count, elevation_point_count,
                                    geometry, has_elevation, distance_km, ascent_m)
        VALUES ('s1', ${dataset.id}, 0, 0, 2, 0, ST_GeomFromText('LINESTRING(6.8 45.9, 6.81 45.91)', 4326), false, 1, 50)`,
    ).rejects.toThrow(/trail_segments_elevation_metrics_need_elevation/);
  });

  it("rejects a has_elevation flag that contradicts the geometry (CHECK)", async () => {
    const { dataset } = await createTrailWithDataset();
    await expect(
      db.$executeRaw`
        INSERT INTO trail_segments (id, dataset_id, sequence, source_part_index, point_count, elevation_point_count,
                                    geometry, has_elevation, distance_km)
        VALUES ('s1', ${dataset.id}, 0, 0, 2, 2, ST_GeomFromText('LINESTRING(6.8 45.9, 6.81 45.91)', 4326), true, 1)`,
    ).rejects.toThrow(/trail_segments_elevation_dims/);
  });

  it("rejects a point count that does not match the geometry (CHECK)", async () => {
    const { dataset } = await createTrailWithDataset();
    await expect(
      db.$executeRaw`
        INSERT INTO trail_segments (id, dataset_id, sequence, source_part_index, point_count, elevation_point_count,
                                    geometry, has_elevation, distance_km)
        VALUES ('s1', ${dataset.id}, 0, 0, 3, 0, ST_GeomFromText('LINESTRING(6.8 45.9, 6.81 45.91)', 4326), false, 1)`,
    ).rejects.toThrow(/trail_segments_point_count_matches_geometry/);
  });

  it("rejects partial elevation presented as complete (CHECK)", async () => {
    const { dataset } = await createTrailWithDataset();
    await expect(
      db.$executeRaw`
        INSERT INTO trail_segments (id, dataset_id, sequence, source_part_index, point_count, elevation_point_count,
                                    geometry, has_elevation, distance_km)
        VALUES ('s1', ${dataset.id}, 0, 0, 2, 1,
                ST_GeomFromText('LINESTRING Z(6.8 45.9 1000, 6.81 45.91 1010)', 4326), true, 1)`,
    ).rejects.toThrow(/trail_segments_elevation_complete_iff_all_points/);
  });
});

describe("M2 import tables", () => {
  it("keeps waypoint locations in sync and validates their coordinates", async () => {
    const { dataset } = await createTrailWithDataset();
    await db.datasetWaypoint.create({ data: { datasetId: dataset.id, sequence: 0, latitude: 45.9, longitude: 6.8 } });
    const [row] = await db.$queryRaw<{ x: number; y: number }[]>`
      SELECT ST_X(location) AS x, ST_Y(location) AS y FROM dataset_waypoints`;
    expect(row).toEqual({ x: 6.8, y: 45.9 });
    await expect(
      db.datasetWaypoint.create({ data: { datasetId: dataset.id, sequence: 1, latitude: 95, longitude: 6.8 } }),
    ).rejects.toThrow(/dataset_waypoints_latitude_range/);
  });

  it("requires profiles to list their segment starts from 0", async () => {
    const { dataset } = await createTrailWithDataset();
    const variant = await db.trailVariant.create({
      data: { datasetId: dataset.id, name: "Main", isMain: true, sourceKind: "TRACK", sourceIndex: 0 },
    });
    await expect(
      db.variantProfile.create({
        data: {
          variantId: variant.id,
          schemaVersion: 1,
          processorVersion: "test",
          sampleSpacingM: 25,
          distancesKm: [0, 0.025],
          elevationsM: [],
          elevationSource: "NONE",
          elevationComplete: false,
          segmentStartIndices: [1],
          processingParams: {},
        },
      }),
    ).rejects.toThrow(/variant_profiles_segment_starts/);
  });

  it("only lets a job be PROCESSING while a lease is held", async () => {
    const file = await db.storedFile.create({
      data: { storageKey: "uploads/t/f.gpx", mimeType: "application/gpx+xml", sizeBytes: 1, sha256: "0".repeat(64) },
    });
    await expect(
      db.importJob.create({ data: { kind: "TRAIL_GEOMETRY", status: "PROCESSING", fileId: file.id, sourceInfo: {} } }),
    ).rejects.toThrow(/import_jobs_lease_iff_processing/);
  });
});

describe("dataset licensing", () => {
  it("refuses a public dataset whose redistribution rights are unknown", async () => {
    await expect(createTrailWithDataset({ visibility: "PUBLIC", redistributionAllowed: null })).rejects.toThrow(
      /trail_datasets_public_requires_redistribution/,
    );
  });

  it("allows only one active dataset per trail", async () => {
    const { trail, dataset } = await createTrailWithDataset();
    await db.trailDataset.update({ where: { id: dataset.id }, data: { isActive: true } });
    await expect(
      db.trailDataset.create({
        data: {
          trailId: trail.id,
          sourceCategory: "SYNTHETIC",
          sourceName: "Second version",
          fileType: "GPX",
          license: "CC0-1.0",
          version: 2,
          isActive: true,
        },
      }),
    ).rejects.toThrow();
  });
});

describe("points of interest", () => {
  it("keeps the PostGIS point in sync with latitude and longitude", async () => {
    const { trail } = await createTrailWithDataset();
    const poi = await db.trailPoi.create({
      data: {
        trailId: trail.id,
        name: "Synthetic spring",
        type: "WATER",
        latitude: 45.9,
        longitude: 6.8,
        sourceCategory: "SYNTHETIC",
      },
    });
    await db.trailPoi.update({ where: { id: poi.id }, data: { latitude: 46.0 } });
    const [row] = await db.$queryRaw<{ x: number; y: number }[]>`
      SELECT ST_X(location) AS x, ST_Y(location) AS y FROM trail_pois WHERE id = ${poi.id}`;
    expect(row).toEqual({ x: 6.8, y: 46.0 });
  });

  it("never stores a POI as user-booked", async () => {
    const { trail } = await createTrailWithDataset();
    await expect(
      db.trailPoi.create({
        data: {
          trailId: trail.id,
          name: "Synthetic hut",
          type: "ACCOMMODATION",
          latitude: 45.9,
          longitude: 6.8,
          sourceCategory: "SYNTHETIC",
          accommodationReliability: "USER_BOOKED",
        },
      }),
    ).rejects.toThrow(/trail_pois_reliability_not_user_booked/);
  });

  it("requires a reliability for accommodation", async () => {
    const { trail } = await createTrailWithDataset();
    await expect(
      db.trailPoi.create({
        data: { trailId: trail.id, name: "Hut", type: "ACCOMMODATION", latitude: 45.9, longitude: 6.8, sourceCategory: "SYNTHETIC" },
      }),
    ).rejects.toThrow(/trail_pois_reliability_only_for_accommodation/);
  });
});

describe("treks", () => {
  it("never stores a system recommendation as booked", async () => {
    const { trek } = await createTrek();
    await expect(
      db.trekStop.create({
        data: {
          trekId: trek.id,
          name: "Suggested hut",
          stopType: "OVERNIGHT",
          source: "SYSTEM_RECOMMENDATION",
          reliability: "USER_BOOKED",
          routeDistanceKm: 12,
          latitude: 45.9,
          longitude: 6.8,
        },
      }),
    ).rejects.toThrow(/trek_stops_recommendation_not_booked/);
  });

  it("requires rest days to cover no distance", async () => {
    const { trek } = await createTrek();
    await expect(
      db.trekDay.create({
        data: { trekId: trek.id, dayNumber: 1, dayType: "REST", startDistanceKm: 10, endDistanceKm: 12, plannedDistanceKm: 2 },
      }),
    ).rejects.toThrow(/trek_days_rest_day_stationary/);
  });

  it("deletes days and stops with the trek, and keeps the overnight link consistent", async () => {
    const { trek } = await createTrek();
    const stop = await db.trekStop.create({
      data: {
        trekId: trek.id,
        name: "Booked refuge",
        stopType: "OVERNIGHT",
        source: "USER",
        reliability: "USER_BOOKED",
        arrivalDate: new Date("2027-07-01"),
        routeDistanceKm: 14.2,
        latitude: 45.9,
        longitude: 6.8,
      },
    });
    await db.trekDay.create({
      data: {
        trekId: trek.id,
        dayNumber: 1,
        startDistanceKm: 0,
        endDistanceKm: 14.2,
        plannedDistanceKm: 14.2,
        overnightStopId: stop.id,
      },
    });

    await db.trek.delete({ where: { id: trek.id } });
    expect(await db.trekDay.count()).toBe(0);
    expect(await db.trekStop.count()).toBe(0);
  });

  it("prevents deleting a dataset that a trek depends on", async () => {
    const { dataset } = await createTrek();
    await expect(db.trailDataset.delete({ where: { id: dataset.id } })).rejects.toThrow();
  });
});
