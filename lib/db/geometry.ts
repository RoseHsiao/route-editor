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
      (id, dataset_id, sequence, geometry, has_elevation, distance_km, ascent_m, descent_m)
    VALUES (
      ${id},
      ${segment.datasetId},
      ${segment.sequence},
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
