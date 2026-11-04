import { describe, expect, it } from "vitest";

import { hasElevation, validateLineString, validatePosition } from "@/lib/geo/coordinates";

describe("validatePosition", () => {
  it("accepts 2D and 3D WGS 84 positions", () => {
    expect(validatePosition([6.79804, 45.88992])).toEqual([]);
    expect(validatePosition([6.79804, 45.88992, 1011.12])).toEqual([]);
    expect(validatePosition([-180, -90])).toEqual([]);
    expect(validatePosition([180, 90])).toEqual([]);
  });

  it("rejects out-of-range latitude and longitude", () => {
    expect(validatePosition([6.8, 91]).map((i) => i.code)).toEqual(["LATITUDE_OUT_OF_RANGE"]);
    expect(validatePosition([-181, 45]).map((i) => i.code)).toEqual(["LONGITUDE_OUT_OF_RANGE"]);
  });

  it("catches swapped lat/lon when the swap leaves the valid range", () => {
    // [lat, lon] given as [lon, lat] for a point at lon 120, lat 45.
    expect(validatePosition([45, 120]).map((i) => i.code)).toEqual(["LATITUDE_OUT_OF_RANGE"]);
  });

  it("rejects non-finite values and wrong lengths", () => {
    expect(validatePosition([Number.NaN, 45]).map((i) => i.code)).toEqual(["NOT_FINITE"]);
    expect(validatePosition([6.8, Number.POSITIVE_INFINITY]).map((i) => i.code)).toEqual(["NOT_FINITE"]);
    expect(validatePosition([6.8]).map((i) => i.code)).toEqual(["INVALID_POSITION_LENGTH"]);
    expect(validatePosition([6.8, 45, 1000, 0]).map((i) => i.code)).toEqual(["INVALID_POSITION_LENGTH"]);
  });

  it("reports the index of the offending position", () => {
    expect(validatePosition([6.8, 95], 7)[0]?.index).toBe(7);
  });
});

describe("validateLineString", () => {
  it("requires at least two positions", () => {
    expect(validateLineString({ type: "LineString", coordinates: [[6.8, 45.9]] }).map((i) => i.code)).toEqual([
      "TOO_FEW_POSITIONS",
    ]);
  });

  it("rejects partially missing elevation instead of guessing", () => {
    const issues = validateLineString({ type: "LineString", coordinates: [[6.8, 45.9, 1000], [6.81, 45.91]] });
    expect(issues.map((i) => i.code)).toContain("MIXED_DIMENSIONS");
  });

  it("collects per-position issues", () => {
    const issues = validateLineString({ type: "LineString", coordinates: [[6.8, 45.9], [6.8, 99], [200, 45]] });
    expect(issues.map((i) => [i.code, i.index])).toEqual([
      ["LATITUDE_OUT_OF_RANGE", 1],
      ["LONGITUDE_OUT_OF_RANGE", 2],
    ]);
  });
});

describe("hasElevation", () => {
  it("is true only when every position has elevation", () => {
    expect(hasElevation({ type: "LineString", coordinates: [[0, 0, 1], [1, 1, 2]] })).toBe(true);
    expect(hasElevation({ type: "LineString", coordinates: [[0, 0], [1, 1]] })).toBe(false);
    expect(hasElevation({ type: "LineString", coordinates: [] })).toBe(false);
  });
});
