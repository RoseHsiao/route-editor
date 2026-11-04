import { describe, expect, it } from "vitest";

import { GEO_CONTRACT } from "@/lib/import/contract";
import {
  checkFile,
  fileFormatFromName,
  parseImportRequest,
  toJobOptions,
  toSourceInfo,
  UploadValidationError,
} from "@/lib/import/upload";

const BASE = { sourceCategory: "USER_UPLOAD", sourceName: "My watch" };

function fieldErrors(input: Record<string, unknown>): Record<string, string> {
  try {
    parseImportRequest(input);
  } catch (error) {
    if (error instanceof UploadValidationError) return error.fieldErrors;
    throw error;
  }
  return {};
}

describe("import files", () => {
  it.each([
    ["track.GPX", "GPX", "gpx"],
    ["lines.geojson", "GEOJSON", "geojson"],
    ["lines.json", "GEOJSON", "geojson"],
  ])("detects %s", (name, format, extension) => {
    expect(fileFormatFromName(name)).toEqual({ format, extension });
  });

  it("rejects other files, empty files and files over the limit", () => {
    expect(() => checkFile("map.kml", 10)).toThrow(UploadValidationError);
    expect(() => checkFile("track.gpx", 0)).toThrow(/empty/);
    expect(() => checkFile("track.gpx", GEO_CONTRACT.maxFileBytes + 1)).toThrow(/larger/);
    expect(checkFile("track.gpx", GEO_CONTRACT.maxFileBytes).format).toBe("GPX");
  });
});

describe("import provenance", () => {
  it("defaults unknown permissions to null and the licence to UNKNOWN", () => {
    const request = parseImportRequest(BASE);
    expect(toSourceInfo(request)).toEqual({
      sourceCategory: "USER_UPLOAD",
      sourceName: "My watch",
      sourceUrl: null,
      license: "UNKNOWN",
      attributionText: null,
      commercialUseAllowed: null,
      redistributionAllowed: null,
    });
  });

  it("maps tri-state answers", () => {
    const request = parseImportRequest({ ...BASE, redistributionAllowed: "yes", commercialUseAllowed: "no" });
    expect([request.redistributionAllowed, request.commercialUseAllowed]).toEqual([true, false]);
  });

  it.each(["OFFICIAL", "SYNTHETIC", "ANYTHING"])("does not let uploaders declare %s", (sourceCategory) => {
    expect(fieldErrors({ ...BASE, sourceCategory })).toHaveProperty("sourceCategory");
  });

  it("requires attribution for open data", () => {
    expect(fieldErrors({ ...BASE, sourceCategory: "OPEN_DATA" })).toHaveProperty("attributionText");
    expect(
      fieldErrors({ ...BASE, sourceCategory: "OPEN_DATA", attributionText: "© OpenStreetMap contributors" }),
    ).toEqual({});
  });

  it("requires a source name and a valid URL", () => {
    expect(fieldErrors({ sourceCategory: "USER_UPLOAD", sourceName: "  " })).toHaveProperty("sourceName");
    expect(fieldErrors({ ...BASE, sourceUrl: "javascript:alert(1)" })).toHaveProperty("sourceUrl");
    expect(fieldErrors({ ...BASE, sourceUrl: "https://example.test/route" })).toEqual({});
  });
});

describe("import options", () => {
  it("passes only what was set, plus the detected format", () => {
    expect(toJobOptions(parseImportRequest(BASE), "GPX")).toEqual({ format: "GPX" });
    expect(toJobOptions(parseImportRequest({ ...BASE, trailName: "Ridge", gapWarnM: "50", gapFailM: "" }), "GEOJSON")).toEqual(
      { format: "GEOJSON", trailName: "Ridge", gapWarnM: 50 },
    );
  });

  it("rejects inconsistent gap thresholds", () => {
    expect(fieldErrors({ ...BASE, gapWarnM: "2000" })).toHaveProperty("gapFailM");
    expect(fieldErrors({ ...BASE, gapWarnM: "-5" })).toHaveProperty("gapWarnM");
  });
});
