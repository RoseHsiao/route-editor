/**
 * Validation of an import request: the file's name and size, and the provenance the
 * uploader declares (ADR 0003). Pure: no I/O, no framework imports.
 */
import { z } from "zod";

import { GEO_CONTRACT } from "./contract";

/**
 * Categories an uploader may declare. OFFICIAL needs a recorded licence review by the
 * maintainers, and SYNTHETIC is reserved for generated fixtures, so neither is offered.
 */
export const UPLOAD_SOURCE_CATEGORIES = ["USER_UPLOAD", "THIRD_PARTY", "OPEN_DATA"] as const;
export type UploadSourceCategory = (typeof UPLOAD_SOURCE_CATEGORIES)[number];

export const SOURCE_CATEGORY_LABELS: Record<UploadSourceCategory, { label: string; hint: string }> = {
  USER_UPLOAD: { label: "My own recording or plan", hint: "A track you recorded or a route you drew yourself." },
  THIRD_PARTY: {
    label: "From another website or app",
    hint: "Community or commercial data with its own terms. It stays private to you.",
  },
  OPEN_DATA: {
    label: "Open data (for example OpenStreetMap)",
    hint: "Data under an open licence. Attribution is required.",
  },
};

export type ImportFileFormat = "GPX" | "GEOJSON";

const EXTENSIONS: Record<string, ImportFileFormat> = { gpx: "GPX", geojson: "GEOJSON", json: "GEOJSON" };

export const CONTENT_TYPES: Record<ImportFileFormat, string> = {
  GPX: "application/gpx+xml",
  GEOJSON: "application/geo+json",
};

export class UploadValidationError extends Error {
  constructor(readonly fieldErrors: Record<string, string>) {
    super(Object.values(fieldErrors).join(" "));
    this.name = "UploadValidationError";
  }
}

export function fileFormatFromName(name: string): { format: ImportFileFormat; extension: string } | null {
  const extension = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const format = extension ? EXTENSIONS[extension] : undefined;
  return format && extension ? { format, extension: extension === "json" ? "geojson" : extension } : null;
}

export function checkFile(name: string, sizeBytes: number): { format: ImportFileFormat; extension: string } {
  const detected = fileFormatFromName(name);
  if (!detected) {
    throw new UploadValidationError({ file: "Choose a .gpx, .geojson or .json file." });
  }
  if (sizeBytes <= 0) throw new UploadValidationError({ file: "The file is empty." });
  if (sizeBytes > GEO_CONTRACT.maxFileBytes) {
    throw new UploadValidationError({
      file: `The file is larger than ${Math.round(GEO_CONTRACT.maxFileBytes / 1024 / 1024)} MB.`,
    });
  }
  return detected;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null);

/** Tri-state permission as submitted by a form: "yes" | "no" | "unknown". */
const triState = z
  .enum(["yes", "no", "unknown"])
  .default("unknown")
  .transform((value) => (value === "unknown" ? null : value === "yes"));

const optionalPositive = z
  .union([z.literal(""), z.coerce.number().positive().max(100_000)])
  .optional()
  .transform((value) => (value === "" || value === undefined ? undefined : value));

export const importRequestSchema = z
  .object({
    trailName: optionalText(200),
    sourceCategory: z.enum(UPLOAD_SOURCE_CATEGORIES, { message: "Choose where the file comes from." }),
    sourceName: z.string().trim().min(1, "Name the source of the data.").max(200),
    sourceUrl: optionalText(2000).refine((value) => value === null || /^https?:\/\/\S+$/i.test(value), {
      message: "Enter a full http(s) address, or leave it empty.",
    }),
    license: optionalText(100).transform((value) => value ?? "UNKNOWN"),
    attributionText: optionalText(500),
    commercialUseAllowed: triState,
    redistributionAllowed: triState,
    gapWarnM: optionalPositive,
    gapFailM: optionalPositive,
  })
  .superRefine((value, ctx) => {
    if (value.sourceCategory === "OPEN_DATA" && !value.attributionText) {
      ctx.addIssue({ code: "custom", path: ["attributionText"], message: "Open data requires attribution text." });
    }
    const warn = value.gapWarnM ?? GEO_CONTRACT.defaultGapWarnM;
    const fail = value.gapFailM ?? GEO_CONTRACT.defaultGapFailM;
    if (warn > fail) {
      ctx.addIssue({
        code: "custom",
        path: ["gapFailM"],
        message: "The failure threshold must be at least the warning threshold.",
      });
    }
  });

export type ImportRequest = z.output<typeof importRequestSchema>;

/** Parses form-like input; throws UploadValidationError with one message per field. */
export function parseImportRequest(input: Record<string, unknown>): ImportRequest {
  const result = importRequestSchema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? "form");
    fieldErrors[field] ??= issue.message;
  }
  throw new UploadValidationError(fieldErrors);
}

/** What the worker reads from `import_jobs.source_info` (see trailworker/persist.py). */
export function toSourceInfo(request: ImportRequest) {
  return {
    sourceCategory: request.sourceCategory,
    sourceName: request.sourceName,
    sourceUrl: request.sourceUrl,
    license: request.license,
    attributionText: request.attributionText,
    commercialUseAllowed: request.commercialUseAllowed,
    redistributionAllowed: request.redistributionAllowed,
  };
}

/** What the worker reads from `import_jobs.options` (see trailworker/normalize.py). */
export function toJobOptions(request: ImportRequest, format: ImportFileFormat) {
  return {
    format,
    ...(request.trailName ? { trailName: request.trailName } : {}),
    ...(request.gapWarnM !== undefined ? { gapWarnM: request.gapWarnM } : {}),
    ...(request.gapFailM !== undefined ? { gapFailM: request.gapFailM } : {}),
  };
}
