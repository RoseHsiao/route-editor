import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { CurrentUser } from "@/lib/auth/current-user";
import { normalizedImportSchema, type NormalizedImport } from "@/lib/import/contract";
import { UploadValidationError } from "@/lib/import/upload";
import {
  completeDirectUpload,
  createDirectUpload,
  createImportFromUpload,
  getImport,
  ImportConflictError,
  listImports,
  retryImport,
} from "@/services/trail-data/imports";
import { getImportedRoute } from "@/services/trail-data/route-view";

import { testDb, truncateAll } from "./test-database";

/**
 * Import pipeline across both languages: the TypeScript service stores the upload and
 * queues the job, the real Python worker (`python -m trailworker --once`) processes it
 * against the same PostGIS test database, and the TypeScript read model must return
 * exactly what the worker's committed contract example says.
 */
const REPO = path.join(import.meta.dirname, "../..");
const FIXTURES = path.join(REPO, "fixtures/synthetic");
const db = testDb();
let storageDir: string;

// Services resolve the database through lib/db/client's shared instance; point it at the test client.
(globalThis as unknown as { prisma: typeof db }).prisma = db;

const SOURCE = { sourceCategory: "USER_UPLOAD", sourceName: "Synthetic fixture", license: "CC0-1.0" };

async function newUser(): Promise<CurrentUser> {
  return db.user.create({ data: { email: `${crypto.randomUUID()}@example.test` }, select: { id: true, email: true, name: true } });
}

function fixture(name: string): Buffer {
  return readFileSync(path.join(FIXTURES, name));
}

function example(name: string): { outcome: string; normalized: NormalizedImport | null; report: unknown } {
  const raw = JSON.parse(readFileSync(path.join(REPO, "contracts/geo/v1/examples", `${name}.json`), "utf8")) as {
    outcome: string;
    normalized: unknown;
    report: unknown;
  };
  return { ...raw, normalized: raw.normalized ? normalizedImportSchema.parse(raw.normalized) : null };
}

function runWorkerOnce(): void {
  execFileSync("uv", ["--directory", "workers/geo-processing", "run", "--quiet", "python", "-m", "trailworker", "--once"], {
    cwd: REPO,
    stdio: "pipe",
    env: {
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_DIR: storageDir,
      WORKER_ID: "integration-test",
    },
  });
}

function closeTo(actual: number | null | undefined, expected: number | null | undefined): void {
  if (expected === null || expected === undefined) {
    expect(actual ?? null).toBeNull();
  } else {
    expect(actual).toBeCloseTo(expected, 9);
  }
}

beforeAll(async () => {
  storageDir = await mkdtemp(path.join(tmpdir(), "routeeditor-imports-"));
  process.env.STORAGE_LOCAL_DIR = storageDir;
  process.env.STORAGE_DRIVER = "local";
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await rm(storageDir, { recursive: true, force: true });
  await db.$disconnect();
});

describe("upload", () => {
  it("stores the raw file unchanged with its checksum, separate from any route data", async () => {
    const user = await newUser();
    const bytes = fixture("track-basic.gpx");
    const { jobId } = await createImportFromUpload(user, { fileName: "track-basic.gpx", bytes }, SOURCE);

    const job = await db.importJob.findUniqueOrThrow({ where: { id: jobId }, include: { file: true } });
    expect(job.status).toBe("PENDING");
    expect(job.ownerUserId).toBe(user.id);
    expect(job.options).toEqual({ format: "GPX" });
    expect(job.sourceInfo).toMatchObject({ sourceCategory: "USER_UPLOAD", license: "CC0-1.0", redistributionAllowed: null });
    expect(job.file.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(job.file.storageKey).toMatch(new RegExp(`^uploads/${user.id}/[0-9a-f-]{36}\\.gpx$`));
    expect(await readFile(path.join(storageDir, job.file.storageKey))).toEqual(bytes);
    expect(await db.trail.count()).toBe(0);
    expect(await db.trailDataset.count()).toBe(0);
  });

  it("rejects invalid provenance before storing anything", async () => {
    const user = await newUser();
    await expect(
      createImportFromUpload(user, { fileName: "x.gpx", bytes: fixture("track-basic.gpx") }, { sourceCategory: "OFFICIAL", sourceName: "x" }),
    ).rejects.toThrow(UploadValidationError);
    expect(await db.storedFile.count()).toBe(0);
  });

  it("uses server uploads when storage cannot presign", async () => {
    const user = await newUser();
    const sha256 = createHash("sha256").update("x").digest("hex");
    expect(await createDirectUpload(user, { fileName: "t.gpx", sizeBytes: 10, sha256 })).toEqual({ mode: "server" });
  });

  it("completes a direct upload only for the uploader's own, matching object", async () => {
    const owner = await newUser();
    const other = await newUser();
    const bytes = fixture("track-basic.gpx");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const id = crypto.randomUUID();
    const key = `uploads/${owner.id}/${id}.gpx`;
    const { storage } = await import("@/lib/storage");
    await storage().put(key, bytes, { contentType: "application/gpx+xml" });
    const file = { key, fileName: "t.gpx", sizeBytes: bytes.length, sha256 };

    await expect(completeDirectUpload(other, file, SOURCE)).rejects.toThrow(/does not belong/);
    await expect(completeDirectUpload(owner, { ...file, sha256: "0".repeat(64) }, SOURCE)).rejects.toThrow(/does not match/);
    const { jobId } = await completeDirectUpload(owner, file, SOURCE);
    expect((await db.storedFile.findFirstOrThrow({ where: { id } })).sha256).toBe(sha256);
    await expect(completeDirectUpload(owner, file, SOURCE)).rejects.toThrow(ImportConflictError);
    expect(await db.importJob.count()).toBe(1);
    expect((await getImport(owner, jobId))?.status).toBe("PENDING");
  });

  it("keeps imports private to their owner", async () => {
    const owner = await newUser();
    const other = await newUser();
    const { jobId } = await createImportFromUpload(owner, { fileName: "t.gpx", bytes: fixture("track-basic.gpx") }, SOURCE);
    expect(await getImport(other, jobId)).toBeNull();
    expect(await listImports(other)).toEqual([]);
    expect((await listImports(owner)).map((job) => job.id)).toEqual([jobId]);
  });
});

describe("pipeline with the Python worker", () => {
  it.each([
    "track-basic.gpx",
    "mixed-trk-rte-wpt.gpx",
    "track-quality-issues.gpx",
    "lines-wgs84.geojson",
    "line-epsg2056.geojson",
  ])(
    "TypeScript reads back exactly the worker's normalized output for %s",
    async (file) => {
      const user = await newUser();
      const name = file.replace(/\.(gpx|geojson)$/, "");
      const { jobId } = await createImportFromUpload(user, { fileName: file, bytes: fixture(file) }, SOURCE);
      runWorkerOnce();

      const job = await getImport(user, jobId);
      expect(job?.status, JSON.stringify(job?.errors)).toBe("SUCCEEDED");
      expect(job?.contractMismatch).toBe(false);
      const expected = example(name);
      expect(job?.report).toEqual(expected.report);

      const route = await getImportedRoute(user, job!.datasetId!);
      expect(route).not.toBeNull();
      expect(route!.integrityProblems).toEqual([]);
      expect(route!.provenance).toMatchObject({ sourceCategory: "USER_UPLOAD", visibility: "PRIVATE", license: "CC0-1.0" });

      const lines = expected.normalized!.lines;
      expect(route!.variants.map((v) => [v.sourceIndex, v.sourceKind, v.name, v.isMain])).toEqual(
        lines.map((l) => [l.sourceIndex, l.sourceKind, l.name, l.isMain]),
      );
      route!.variants.forEach((variant, index) => {
        const line = lines[index]!;
        closeTo(variant.distanceKm, line.distanceKm);
        closeTo(variant.ascentM, line.ascentM);
        closeTo(variant.descentM, line.descentM);
        expect(variant.segments.map((s) => s.sourcePartIndex)).toEqual(line.segments.map((s) => s.sourcePartIndex));
        variant.segments.forEach((segment, s) => {
          const expectedCoordinates = line.segments[s]!.coordinates;
          expect(segment.coordinates).toHaveLength(expectedCoordinates.length);
          segment.coordinates.forEach((position, p) => {
            expect(position).toHaveLength(expectedCoordinates[p]!.length);
            position.forEach((value, axis) => expect(value).toBeCloseTo(expectedCoordinates[p]![axis]!, 9));
          });
        });
        const profile = variant.profile!;
        expect(profile.elevationSource).toBe(line.profile.elevationSource);
        expect(profile.segmentStartIndices).toEqual(line.profile.segmentStartIndices);
        expect(profile.processingParams).toEqual(line.profile.processingParams);
        expect(profile.distancesKm).toHaveLength(line.profile.distancesKm.length);
        profile.distancesKm.forEach((km, i) => expect(km).toBeCloseTo(line.profile.distancesKm[i]!, 9));
        expect(profile.elevationsM).toHaveLength(line.profile.elevationsM.length);
        profile.elevationsM.forEach((m, i) => expect(m).toBeCloseTo(line.profile.elevationsM[i]!, 9));
      });
      expect(route!.waypoints.map((w) => [w.name, w.symbol, w.elevationM])).toEqual(
        expected.normalized!.waypoints.map((w) => [w.name, w.symbol, w.elevationM]),
      );
    },
    60_000,
  );

  it("a failed import publishes nothing, and a non-retryable failure cannot be retried", async () => {
    const user = await newUser();
    const { jobId } = await createImportFromUpload(
      user,
      { fileName: "track-large-gap.gpx", bytes: fixture("track-large-gap.gpx") },
      SOURCE,
    );
    runWorkerOnce();
    const job = await getImport(user, jobId);
    expect(job?.status).toBe("FAILED");
    expect(job?.errors.map((error) => error.code)).toEqual(["GAP_TOO_LARGE"]);
    expect(job?.retryable).toBe(false);
    expect(job?.report).toEqual(example("track-large-gap").report);
    expect(await db.trail.count()).toBe(0);
    expect(await db.trailDataset.count()).toBe(0);
    await expect(retryImport(user, jobId)).rejects.toThrow(ImportConflictError);
  }, 60_000);

  it("a retryable failure can be retried once and yields one dataset", async () => {
    const user = await newUser();
    const bytes = fixture("track-basic.gpx");
    const { jobId } = await createImportFromUpload(user, { fileName: "track-basic.gpx", bytes }, SOURCE);
    const { storageKey } = (await db.importJob.findUniqueOrThrow({ where: { id: jobId }, include: { file: true } })).file;
    await rm(path.join(storageDir, storageKey));
    runWorkerOnce();
    expect((await getImport(user, jobId))?.errors.map((e) => [e.code, e.retryable])).toEqual([["FILE_NOT_FOUND", true]]);

    const { storage } = await import("@/lib/storage");
    await storage().put(storageKey, bytes, { contentType: "application/gpx+xml" });
    await retryImport(user, jobId);
    await expect(retryImport(user, jobId)).rejects.toThrow(ImportConflictError);
    runWorkerOnce();
    runWorkerOnce();
    expect((await getImport(user, jobId))?.status).toBe("SUCCEEDED");
    expect(await db.trailDataset.count()).toBe(1);
    expect(await db.trail.count()).toBe(1);
  }, 60_000);
});
