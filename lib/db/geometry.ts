import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@/lib/generated/prisma/client";
import { hasElevation, validateLineString, type LineStringGeometry } from "@/lib/geo/coordinates";

/**
 * Geometry I/O for PostGIS columns that Prisma models as `Unsupported`.
 *
 * Every statement uses Prisma's tagged templates, which send values as bind
 * parameters. Never build SQL strings from input. See docs/DATA_MODEL.md.
 */

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface NewTrailSegment {
  datasetId: string;
  sequence: number;
  /** Defaults to 0 (a single-part source). */
  sourcePartIndex?: number;
  line: LineStringGeometry;
  distanceKm: number;
  /** Must be omitted when the line has no elevation. */
  ascentM?: number;
  descentM?: number;
}

export class InvalidGeometryError extends Error {
  constructor(readonly issues: ReturnType<typeof validateLineString>) {
    super(`Invalid geometry: ${issues.map((issue) => issue.message).join("; ")}`);
    this.name = "InvalidGeometryError";
  }
}

/**
 * Inserts a segment. The geo worker is the normal writer of segments; this helper
 * exists for seeding and tests, and enforces the same invariants as the database.
 */
export async function insertTrailSegment(db: DbClient, segment: NewTrailSegment): Promise<string> {
  const issues = validateLineString(segment.line);
  if (issues.length > 0) throw new InvalidGeometryError(issues);

  const id = randomUUID();
  const geoJson = JSON.stringify({ type: "LineString", coordinates: segment.line.coordinates });

  await db.$executeRaw`
    INSERT INTO trail_segments
      (id, dataset_id, sequence, source_part_index, point_count, elevation_point_count,
       geometry, has_elevation, distance_km, ascent_m, descent_m)
    VALUES (
      ${id},
      ${segment.datasetId},
      ${segment.sequence},
      ${segment.sourcePartIndex ?? 0},
      ${segment.line.coordinates.length},
      ${hasElevation(segment.line) ? segment.line.coordinates.length : 0},
      ST_SetSRID(ST_GeomFromGeoJSON(${geoJson}::text), 4326),
      ${hasElevation(segment.line)},
      ${segment.distanceKm},
      ${segment.ascentM ?? null},
      ${segment.descentM ?? null}
    )`;
  return id;
}

export interface SegmentGeometryRow {
  id: string;
  sequence: number;
  hasElevation: boolean;
  geometry: LineStringGeometry;
}

export async function readDatasetSegments(db: DbClient, datasetId: string): Promise<SegmentGeometryRow[]> {
  const rows = await db.$queryRaw<
    { id: string; sequence: number; has_elevation: boolean; geometry: string }[]
  >`
    SELECT id, sequence, has_elevation, ST_AsGeoJSON(geometry) AS geometry
    FROM trail_segments
    WHERE dataset_id = ${datasetId}
    ORDER BY sequence`;

  return rows.map((row) => ({
    id: row.id,
    sequence: row.sequence,
    hasElevation: row.has_elevation,
    geometry: JSON.parse(row.geometry) as LineStringGeometry,
  }));
}

export async function postgisVersion(db: DbClient): Promise<string> {
  const [row] = await db.$queryRaw<{ version: string }[]>`SELECT postgis_lib_version() AS version`;
  if (!row) throw new Error("PostGIS is not available");
  return row.version;
}

export interface VariantSegmentGeometryRow {
  variantId: string;
  sequence: number;
  sourcePartIndex: number;
  pointCount: number;
  elevationPointCount: number;
  hasElevation: boolean;
  distanceKm: number;
  ascentM: number | null;
  descentM: number | null;
  startDistanceKm: number;
  endDistanceKm: number;
  geometry: LineStringGeometry;
}

/**
 * Every variant's segments in traversal order, with geometry. Coordinates are returned
 * with 15 significant decimals so values round-trip without visible loss.
 */
export async function readDatasetVariantSegments(db: DbClient, datasetId: string): Promise<VariantSegmentGeometryRow[]> {
  const rows = await db.$queryRaw<
    {
      variant_id: string;
      sequence: number;
      source_part_index: number;
      point_count: number;
      elevation_point_count: number;
      has_elevation: boolean;
      distance_km: number;
      ascent_m: number | null;
      descent_m: number | null;
      start_distance_km: number;
      end_distance_km: number;
      geometry: string;
    }[]
  >`
    SELECT vs.variant_id, vs.sequence, s.source_part_index, s.point_count, s.elevation_point_count,
           s.has_elevation, s.distance_km, s.ascent_m, s.descent_m, vs.start_distance_km, vs.end_distance_km,
           ST_AsGeoJSON(s.geometry, 15) AS geometry
    FROM variant_segments vs
    JOIN trail_segments s ON s.id = vs.segment_id
    JOIN trail_variants v ON v.id = vs.variant_id
    WHERE v.dataset_id = ${datasetId}
    ORDER BY v.source_index, vs.sequence`;

  return rows.map((row) => ({
    variantId: row.variant_id,
    sequence: row.sequence,
    sourcePartIndex: row.source_part_index,
    pointCount: row.point_count,
    elevationPointCount: row.elevation_point_count,
    hasElevation: row.has_elevation,
    distanceKm: row.distance_km,
    ascentM: row.ascent_m,
    descentM: row.descent_m,
    startDistanceKm: row.start_distance_km,
    endDistanceKm: row.end_distance_km,
    geometry: JSON.parse(row.geometry) as LineStringGeometry,
  }));
}
