/**
 * Geo processing contract, version 1: the TypeScript side.
 *
 * The specification is `contracts/geo/v1/contract.schema.json`. The Python worker writes
 * these shapes (workers/geo-processing/src/trailworker/contract.py); the app reads them
 * from Postgres through the parsers below. Cross-field rules that JSON Schema cannot
 * express are implemented here and in `trailworker/contract_checks.py`, and both are
 * tested against the same corpus in `contracts/geo/v1/examples/`.
 *
 * Pure: no I/O, no framework imports.
 */
import { z } from "zod";

import constants from "@/contracts/geo/v1/constants.json";

export const GEO_CONTRACT = constants;
export const CONTRACT_VERSION = 1 as const;

const nonNegativeInt = z.number().int().min(0);
const issueCode = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const nullableNonNegative = z.number().min(0).nullable();
const jsonObject = z.record(z.string(), z.unknown());

export const locationSchema = z
  .object({
    lineIndex: nonNegativeInt,
    partIndex: nonNegativeInt,
    pointIndex: nonNegativeInt,
    waypointIndex: nonNegativeInt,
    featureIndex: nonNegativeInt,
    lon: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    km: z.number().min(0),
  })
  .partial()
  .strict();

export const severitySchema = z.enum(["error", "warning", "info"]);

export const issueSchema = z
  .object({
    code: issueCode,
    severity: severitySchema,
    message: z.string().min(1),
    location: locationSchema.nullable(),
    details: jsonObject,
  })
  .strict();

const crsSchema = z
  .object({
    declared: z.string().nullable(),
    source: z.string().min(1),
    target: z.literal("OGC:CRS84"),
    reprojected: z.boolean(),
  })
  .strict();

export const sourceKindSchema = z.enum(["TRACK", "ROUTE", "LINE"]);

const lineSummarySchema = z
  .object({
    lineIndex: nonNegativeInt,
    sourceKind: sourceKindSchema,
    name: z.string().min(1),
    isMain: z.boolean(),
    distanceKm: z.number().min(0),
    segments: z.number().int().min(1),
    elevationComplete: z.boolean(),
    ascentM: nullableNonNegative,
    descentM: nullableNonNegative,
  })
  .strict();

export const validationReportSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    processorVersion: z.string().min(1),
    outcome: z.enum(["SUCCEEDED", "FAILED"]),
    source: z
      .object({ format: z.enum(["GPX", "GEOJSON"]), crs: crsSchema.optional(), metadata: jsonObject.optional() })
      .strict(),
    options: z.object({ gapWarnM: z.number().positive(), gapFailM: z.number().positive() }).strict(),
    summary: jsonObject,
    lines: z.array(lineSummarySchema),
    issues: z.array(issueSchema),
  })
  .strict()
  .superRefine((report, ctx) => reportRule(report, ctx));

const positionSchema = z.union([
  z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number()]),
]);

export const segmentSchema = z
  .object({
    sourcePartIndex: nonNegativeInt,
    pointCount: z.number().int().min(2),
    elevationPointCount: nonNegativeInt,
    hasElevation: z.boolean(),
    distanceKm: z.number().min(0),
    ascentM: nullableNonNegative,
    descentM: nullableNonNegative,
    coordinates: z.array(positionSchema).min(2),
  })
  .strict()
  .superRefine((segment, ctx) => segmentRules(segment, ctx));

export const processingParamsSchema = z.looseObject({
  distance: z.looseObject({ method: z.literal("geodesic"), ellipsoid: z.literal("WGS84") }),
  resampling: z.looseObject({
    method: z.literal("linear_interpolation"),
    spacingM: z.number().positive(),
    includeSegmentEnd: z.literal(true),
  }),
  smoothing: z.looseObject({
    method: z.literal("centered_moving_average"),
    windowSamples: z.number().int().min(1),
    edges: z.literal("shrink_window"),
  }),
  ascent: z.looseObject({
    method: z.literal("sum_of_positive_differences"),
    thresholdM: z.number().min(0),
    acrossSegmentBreaks: z.literal(false),
  }),
});

export const elevationSourceSchema = z.enum(["SOURCE_FILE", "DEM", "NONE"]);

export const profileSchema = z
  .object({
    schemaVersion: z.literal(1),
    sampleSpacingM: z.number().positive(),
    distancesKm: z.array(z.number().min(0)).min(2),
    elevationsM: z.array(z.number()),
    elevationSource: elevationSourceSchema,
    elevationComplete: z.boolean(),
    segmentStartIndices: z.array(nonNegativeInt).min(1),
    processingParams: processingParamsSchema,
  })
  .strict()
  .superRefine((profile, ctx) => profileRules(profile, ctx));

export const lineSchema = z
  .object({
    sourceIndex: nonNegativeInt,
    sourceKind: sourceKindSchema,
    name: z.string().min(1),
    isMain: z.boolean(),
    sourceMetadata: jsonObject,
    distanceKm: z.number().min(0),
    ascentM: nullableNonNegative,
    descentM: nullableNonNegative,
    elevationComplete: z.boolean(),
    segments: z.array(segmentSchema).min(1),
    profile: profileSchema,
  })
  .strict();

export const waypointSchema = z
  .object({
    sequence: nonNegativeInt,
    sourceIndex: nonNegativeInt,
    name: z.string().nullable(),
    description: z.string().nullable(),
    comment: z.string().nullable(),
    symbol: z.string().nullable(),
    sourceType: z.string().nullable(),
    longitude: z.number().min(-180).max(180),
    latitude: z.number().min(-90).max(90),
    elevationM: z.number().nullable(),
    sourceMetadata: jsonObject,
  })
  .strict();

export const normalizedImportSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    processorVersion: z.string().min(1),
    lines: z.array(lineSchema).min(1),
    waypoints: z.array(waypointSchema),
    report: validationReportSchema,
  })
  .strict()
  .superRefine((document, ctx) => {
    if (document.report.outcome !== "SUCCEEDED") {
      ctx.addIssue({ code: "custom", message: "a normalized import must come from a successful report" });
    }
    if (document.lines.filter((line) => line.isMain).length !== 1) {
      ctx.addIssue({ code: "custom", message: "exactly one line must be the main line" });
    }
  });

export const jobErrorSchema = z
  .object({ code: issueCode, message: z.string().min(1), details: jsonObject, retryable: z.boolean() })
  .strict();
export const jobErrorsSchema = z.array(jobErrorSchema);

export type Issue = z.infer<typeof issueSchema>;
export type IssueLocation = z.infer<typeof locationSchema>;
export type ValidationReport = z.infer<typeof validationReportSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type NormalizedImport = z.infer<typeof normalizedImportSchema>;
export type JobError = z.infer<typeof jobErrorSchema>;
export type SourceKind = z.infer<typeof sourceKindSchema>;

/** Every definition of the JSON Schema that has a TypeScript parser. */
export const CONTRACT_DEFINITIONS = {
  profile: profileSchema,
  segment: segmentSchema,
  validationReport: validationReportSchema,
  normalizedImport: normalizedImportSchema,
  jobErrors: jobErrorsSchema,
  issue: issueSchema,
} as const;

// ─── Semantic rules (x-semanticRules in the JSON Schema) ─────────────────────

interface RefinementContext {
  addIssue(issue: { code: "custom"; message: string }): void;
}

function reportRule(report: { outcome: string; issues: { severity: string }[] }, ctx: RefinementContext): void {
  const hasError = report.issues.some((issue) => issue.severity === "error");
  if ((report.outcome === "FAILED") !== hasError) {
    ctx.addIssue({ code: "custom", message: "outcome must be FAILED exactly when an issue has severity error" });
  }
}

function segmentRules(
  segment: {
    pointCount: number;
    elevationPointCount: number;
    hasElevation: boolean;
    ascentM: number | null;
    descentM: number | null;
    coordinates: readonly (readonly number[])[];
  },
  ctx: RefinementContext,
): void {
  if (segment.pointCount !== segment.coordinates.length) {
    ctx.addIssue({ code: "custom", message: "pointCount must equal the number of coordinates" });
  }
  if (segment.elevationPointCount > segment.pointCount) {
    ctx.addIssue({ code: "custom", message: "elevationPointCount cannot exceed pointCount" });
  }
  const all3d = segment.coordinates.every((position) => position.length === 3);
  const complete = segment.elevationPointCount === segment.pointCount;
  if (segment.hasElevation !== complete || segment.hasElevation !== all3d) {
    ctx.addIssue({ code: "custom", message: "hasElevation must match the elevation count and the coordinate dimension" });
  }
  if (!segment.hasElevation && (segment.ascentM !== null || segment.descentM !== null)) {
    ctx.addIssue({ code: "custom", message: "ascentM/descentM require elevation" });
  }
}

/** Profile invariants. Exported because the database stores profiles as columns, not JSON. */
export function profileRuleViolations(profile: {
  distancesKm: readonly number[];
  elevationsM: readonly number[];
  elevationComplete: boolean;
  elevationSource: string;
  segmentStartIndices: readonly number[];
}): string[] {
  const errors: string[] = [];
  const { distancesKm: distances, elevationsM: elevations, segmentStartIndices: starts } = profile;
  if (distances.length > 0 && distances[0] !== 0) errors.push("distancesKm must start at 0");
  if (starts[0] !== 0) errors.push("segmentStartIndices must start with 0");
  if (starts.some((value, i) => i > 0 && value <= starts[i - 1]!)) {
    errors.push("segmentStartIndices must be strictly increasing");
  }
  if (starts.some((index) => index >= distances.length)) errors.push("segmentStartIndices must index into distancesKm");
  const startSet = new Set(starts);
  for (let i = 1; i < distances.length; i += 1) {
    if (distances[i]! < distances[i - 1]!) {
      errors.push("distancesKm must be non-decreasing");
      break;
    }
    if (distances[i] === distances[i - 1] && !startSet.has(i)) {
      errors.push("distancesKm may only repeat at a segment start");
      break;
    }
  }
  if (profile.elevationComplete !== elevations.length > 0) {
    errors.push("elevationComplete must equal (elevationsM is not empty)");
  }
  if (elevations.length > 0 && elevations.length !== distances.length) {
    errors.push("elevationsM must be empty or parallel to distancesKm");
  }
  if ((profile.elevationSource === "NONE") === profile.elevationComplete) {
    errors.push("elevationSource is NONE exactly when elevation is incomplete");
  }
  return errors;
}

function profileRules(profile: Parameters<typeof profileRuleViolations>[0], ctx: RefinementContext): void {
  for (const message of profileRuleViolations(profile)) ctx.addIssue({ code: "custom", message });
}
