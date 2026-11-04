import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { CurrentUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db/client";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  jobErrorsSchema,
  validationReportSchema,
  type JobError,
  type ValidationReport,
} from "@/lib/import/contract";
import {
  CONTENT_TYPES,
  checkFile,
  parseImportRequest,
  toJobOptions,
  toSourceInfo,
  UploadValidationError,
  type ImportFileFormat,
} from "@/lib/import/upload";
import { buildStorageKey, storage } from "@/lib/storage";

/**
 * Import lifecycle on the web side: Upload → StoredFile + ImportJob (PENDING).
 * The geo worker takes it from there (workers/geo-processing). See docs/IMPORT_PIPELINE.md.
 *
 * The raw file is stored unchanged under a key generated here, never derived from the
 * uploaded file name, together with its SHA-256. The worker verifies the checksum before
 * processing, so it can never process bytes other than the ones that were uploaded.
 */

export class ImportNotFoundError extends Error {
  constructor() {
    super("Import not found");
    this.name = "ImportNotFoundError";
  }
}

export class ImportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportConflictError";
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const DIRECT_UPLOAD_EXPIRY_S = 15 * 60;

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function createJobForStoredObject(
  user: CurrentUser,
  file: { id: string; key: string; originalName: string; format: ImportFileFormat; sizeBytes: number; sha256: string },
  fields: Record<string, unknown>,
): Promise<{ jobId: string }> {
  const request = parseImportRequest(fields);
  const job = await db().$transaction(async (tx) => {
    await tx.storedFile.create({
      data: {
        id: file.id,
        ownerUserId: user.id,
        storageKey: file.key,
        originalName: file.originalName.slice(0, 255),
        mimeType: CONTENT_TYPES[file.format],
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
      },
    });
    return tx.importJob.create({
      data: {
        kind: "TRAIL_GEOMETRY",
        ownerUserId: user.id,
        fileId: file.id,
        sourceInfo: toSourceInfo(request),
        options: toJobOptions(request, file.format),
      },
      select: { id: true },
    });
  });
  return { jobId: job.id };
}

/** Server-side upload (local storage driver, or any driver for small files). */
export async function createImportFromUpload(
  user: CurrentUser,
  upload: { fileName: string; bytes: Buffer },
  fields: Record<string, unknown>,
): Promise<{ jobId: string }> {
  const { format, extension } = checkFile(upload.fileName, upload.bytes.length);
  parseImportRequest(fields); // Fail before storing anything.
  const id = randomUUID();
  const key = buildStorageKey("uploads", user.id, id, extension);
  await storage().put(key, upload.bytes, { contentType: CONTENT_TYPES[format] });
  try {
    return await createJobForStoredObject(
      user,
      { id, key, originalName: upload.fileName, format, sizeBytes: upload.bytes.length, sha256: sha256(upload.bytes) },
      fields,
    );
  } catch (error) {
    // No database record means no reference to the object; do not leave it behind.
    await storage().delete(key).catch(() => undefined);
    throw error;
  }
}

export type DirectUploadTicket =
  | { mode: "server" }
  | { mode: "direct"; key: string; url: string; headers: Record<string, string>; expiresAt: string };

/** Step 1 of a direct-to-storage upload (S3). Returns `server` mode when the driver cannot presign. */
export async function createDirectUpload(
  user: CurrentUser,
  file: { fileName: string; sizeBytes: number; sha256: string },
): Promise<DirectUploadTicket> {
  const { format, extension } = checkFile(file.fileName, file.sizeBytes);
  if (!SHA256_HEX.test(file.sha256)) throw new UploadValidationError({ file: "Invalid file checksum." });
  const key = buildStorageKey("uploads", user.id, randomUUID(), extension);
  const upload = await storage().createUploadUrl(key, {
    contentType: CONTENT_TYPES[format],
    expiresInSeconds: DIRECT_UPLOAD_EXPIRY_S,
    sha256: file.sha256,
    sizeBytes: file.sizeBytes,
  });
  if (!upload) return { mode: "server" };
  return { mode: "direct", key, url: upload.url, headers: upload.headers, expiresAt: upload.expiresAt.toISOString() };
}

/** Step 2: the object is in storage. Verifies it before creating the job. */
export async function completeDirectUpload(
  user: CurrentUser,
  file: { key: string; fileName: string; sizeBytes: number; sha256: string },
  fields: Record<string, unknown>,
): Promise<{ jobId: string }> {
  const { format, extension } = checkFile(file.fileName, file.sizeBytes);
  const match = file.key.match(/^uploads\/([^/]+)\/([0-9a-f-]{36})\.([a-z]+)$/);
  // Users can only complete uploads under their own prefix.
  if (!match || match[1] !== user.id || match[3] !== extension) {
    throw new UploadValidationError({ file: "This upload does not belong to you." });
  }
  parseImportRequest(fields);
  const head = await storage().head(file.key);
  if (!head) throw new UploadValidationError({ file: "The upload did not reach storage. Try again." });
  if (head.sizeBytes !== file.sizeBytes || head.sha256 !== file.sha256) {
    throw new UploadValidationError({ file: "The stored file does not match the file you selected." });
  }
  try {
    return await createJobForStoredObject(
      user,
      { id: match[2]!, key: file.key, originalName: file.fileName, format, sizeBytes: head.sizeBytes, sha256: head.sha256 },
      fields,
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ImportConflictError("This upload has already been imported.");
    }
    throw error;
  }
}

function parseErrors(raw: unknown): { errors: JobError[]; contractMismatch: boolean } {
  const parsed = jobErrorsSchema.safeParse(raw);
  return parsed.success ? { errors: parsed.data, contractMismatch: false } : { errors: [], contractMismatch: true };
}

function parseReport(raw: unknown): { report: ValidationReport | null; contractMismatch: boolean } {
  if (raw === null || raw === undefined) return { report: null, contractMismatch: false };
  const parsed = validationReportSchema.safeParse(raw);
  return parsed.success ? { report: parsed.data, contractMismatch: false } : { report: null, contractMismatch: true };
}

/** A failed job can be retried only if every error says trying again could help. */
export function canRetry(status: string, errors: readonly JobError[]): boolean {
  return status === "FAILED" && errors.length > 0 && errors.every((error) => error.retryable);
}

export async function retryImport(user: CurrentUser, jobId: string): Promise<void> {
  const job = await db().importJob.findFirst({
    where: { id: jobId, ownerUserId: user.id },
    select: { status: true, errors: true },
  });
  if (!job) throw new ImportNotFoundError();
  if (!canRetry(job.status, parseErrors(job.errors).errors)) {
    throw new ImportConflictError("This import cannot be retried. Fix the file and upload it again.");
  }
  // Conditional on FAILED, so two concurrent retries enqueue the job once.
  const updated = await db().importJob.updateMany({
    where: { id: jobId, ownerUserId: user.id, status: "FAILED" },
    data: { status: "PENDING", attempts: 0, errors: [], validation: Prisma.DbNull, finishedAt: null },
  });
  if (updated.count !== 1) throw new ImportConflictError("This import is already being retried.");
}

export interface ImportSummary {
  id: string;
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  fileName: string | null;
  trailName: string | null;
  datasetId: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export async function listImports(user: CurrentUser): Promise<ImportSummary[]> {
  const jobs = await db().importJob.findMany({
    where: { ownerUserId: user.id, kind: "TRAIL_GEOMETRY" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      status: true,
      createdAt: true,
      finishedAt: true,
      datasetId: true,
      file: { select: { originalName: true } },
      dataset: { select: { trail: { select: { name: true } } } },
    },
  });
  return jobs.map((job) => ({
    id: job.id,
    status: job.status,
    fileName: job.file.originalName,
    trailName: job.dataset?.trail.name ?? null,
    datasetId: job.datasetId,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  }));
}

export interface ImportDetail extends ImportSummary {
  attempts: number;
  sizeBytes: number;
  sha256: string;
  sourceInfo: Record<string, unknown>;
  errors: JobError[];
  report: ValidationReport | null;
  /** The stored errors or report do not match the contract this app understands. */
  contractMismatch: boolean;
  retryable: boolean;
}

export async function getImport(user: CurrentUser, jobId: string): Promise<ImportDetail | null> {
  const job = await db().importJob.findFirst({
    where: { id: jobId, ownerUserId: user.id },
    select: {
      id: true,
      status: true,
      createdAt: true,
      finishedAt: true,
      datasetId: true,
      attempts: true,
      sourceInfo: true,
      errors: true,
      validation: true,
      file: { select: { originalName: true, sizeBytes: true, sha256: true } },
      dataset: { select: { trail: { select: { name: true } } } },
    },
  });
  if (!job) return null;
  const errors = parseErrors(job.errors);
  const report = parseReport(job.validation);
  return {
    id: job.id,
    status: job.status,
    fileName: job.file.originalName,
    trailName: job.dataset?.trail.name ?? null,
    datasetId: job.datasetId,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
    attempts: job.attempts,
    sizeBytes: job.file.sizeBytes,
    sha256: job.file.sha256,
    sourceInfo: (job.sourceInfo ?? {}) as Record<string, unknown>,
    errors: errors.errors,
    report: report.report,
    contractMismatch: errors.contractMismatch || report.contractMismatch,
    retryable: canRetry(job.status, errors.errors),
  };
}
