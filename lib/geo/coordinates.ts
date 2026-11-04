/**
 * Coordinate primitives shared by the app. Pure: no I/O, no framework imports.
 *
 * Positions follow GeoJSON (RFC 7946) order: [longitude, latitude] or
 * [longitude, latitude, elevationMetres], WGS 84.
 */

export type Position2D = readonly [lon: number, lat: number];
export type Position3D = readonly [lon: number, lat: number, ele: number];
export type Position = Position2D | Position3D;

export interface LineStringGeometry {
  readonly type: "LineString";
  readonly coordinates: readonly Position[];
}

export type CoordinateIssueCode =
  | "NOT_FINITE"
  | "LATITUDE_OUT_OF_RANGE"
  | "LONGITUDE_OUT_OF_RANGE"
  | "TOO_FEW_POSITIONS"
  | "MIXED_DIMENSIONS"
  | "INVALID_POSITION_LENGTH";

export interface CoordinateIssue {
  readonly code: CoordinateIssueCode;
  /** Index of the offending position, when the issue concerns one position. */
  readonly index?: number;
  readonly message: string;
}

export function validatePosition(position: readonly number[], index?: number): CoordinateIssue[] {
  if (position.length !== 2 && position.length !== 3) {
    return [{ code: "INVALID_POSITION_LENGTH", index, message: `Expected 2 or 3 values, got ${position.length}` }];
  }
  if (!position.every(Number.isFinite)) {
    return [{ code: "NOT_FINITE", index, message: "Coordinates must be finite numbers" }];
  }
  const [lon, lat] = position as [number, number];
  const issues: CoordinateIssue[] = [];
  if (lat < -90 || lat > 90) {
    issues.push({ code: "LATITUDE_OUT_OF_RANGE", index, message: `Latitude ${lat} is outside [-90, 90]` });
  }
  if (lon < -180 || lon > 180) {
    issues.push({ code: "LONGITUDE_OUT_OF_RANGE", index, message: `Longitude ${lon} is outside [-180, 180]` });
  }
  return issues;
}

/**
 * Structural validation of a line. Topology checks (duplicates, gaps, spikes)
 * belong to the geo worker's import pipeline, not here.
 */
export function validateLineString(line: LineStringGeometry): CoordinateIssue[] {
  const { coordinates } = line;
  if (coordinates.length < 2) {
    return [{ code: "TOO_FEW_POSITIONS", message: "A line needs at least two positions" }];
  }
  const issues = coordinates.flatMap((position, index) => validatePosition(position, index));
  const dimensions = new Set(coordinates.map((position) => position.length));
  if (dimensions.size > 1) {
    issues.push({
      code: "MIXED_DIMENSIONS",
      message: "Either every position has elevation or none does; partial elevation is not stored",
    });
  }
  return issues;
}

export function hasElevation(line: LineStringGeometry): boolean {
  return line.coordinates.length > 0 && line.coordinates.every((position) => position.length === 3);
}
