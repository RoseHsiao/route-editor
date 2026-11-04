import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { GetObjectCommand, HeadObjectCommand, NotFound, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertValidStorageKey, buildStorageKey } from "@/lib/storage/keys";
import { LocalStorageAdapter } from "@/lib/storage/local";
import { S3StorageAdapter } from "@/lib/storage/s3";
import { InvalidStorageKeyError } from "@/lib/storage/types";

describe("storage keys", () => {
  it("accepts generated keys", () => {
    expect(buildStorageKey("uploads", "user_1", "file-abc", ".GPX")).toBe("uploads/user_1/file-abc.gpx");
  });

  it.each([
    "",
    "/absolute/key",
    "uploads/../secrets",
    "uploads/./x",
    "uploads//x",
    "uploads/x/",
    "uploads/my file.gpx",
    "uploads/.hidden",
    "uploads\\x",
    "a".repeat(513),
  ])("rejects %j", (key) => {
    expect(() => assertValidStorageKey(key)).toThrow(InvalidStorageKeyError);
  });
});

describe("LocalStorageAdapter", () => {
  let root: string;
  let adapter: LocalStorageAdapter;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "routeeditor-storage-"));
    adapter = new LocalStorageAdapter(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("stores, reads, and deletes objects", async () => {
    const key = "uploads/u1/f1.gpx";
    await adapter.put(key, Buffer.from("<gpx/>"), { contentType: "application/gpx+xml" });

    expect(await adapter.exists(key)).toBe(true);
    const object = await adapter.get(key);
    expect(object?.body.toString()).toBe("<gpx/>");
    expect(object?.contentType).toBe("application/gpx+xml");

    await adapter.delete(key);
    expect(await adapter.exists(key)).toBe(false);
    expect(await adapter.get(key)).toBeNull();
  });

  it("treats deleting a missing object as success", async () => {
    await expect(adapter.delete("uploads/u1/missing.gpx")).resolves.toBeUndefined();
  });

  it("never writes outside its root", async () => {
    await expect(adapter.put("../escape.txt", Buffer.from("x"), { contentType: "text/plain" })).rejects.toThrow(
      InvalidStorageKeyError,
    );
    expect(await readdir(root)).toEqual([]);
  });

  it("does not offer presigned uploads", async () => {
    expect(await adapter.createUploadUrl()).toBeNull();
  });

  it("reports size and SHA-256 of stored bytes", async () => {
    await adapter.put("uploads/u1/f1.gpx", Buffer.from("<gpx/>"), { contentType: "application/gpx+xml" });
    expect(await adapter.head("uploads/u1/f1.gpx")).toEqual({
      sizeBytes: 6,
      sha256: createHash("sha256").update("<gpx/>").digest("hex"),
    });
    expect(await adapter.head("uploads/u1/missing.gpx")).toBeNull();
  });
});

describe("S3StorageAdapter", () => {
  function adapterWith(send: (command: unknown) => Promise<unknown>) {
    const client = new S3Client({ region: "auto", credentials: { accessKeyId: "test", secretAccessKey: "test" } });
    vi.spyOn(client, "send").mockImplementation(send as never);
    return { adapter: new S3StorageAdapter({ bucket: "test-bucket" }, client), client };
  }

  it("puts objects into the configured bucket with a content type", async () => {
    const sent: unknown[] = [];
    const { adapter } = adapterWith(async (command) => {
      sent.push(command);
      return {};
    });
    await adapter.put("uploads/u1/f1.gpx", Buffer.from("x"), { contentType: "application/gpx+xml" });

    const command = sent[0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "test-bucket",
      Key: "uploads/u1/f1.gpx",
      ContentType: "application/gpx+xml",
    });
  });

  it("maps a missing object to false / null", async () => {
    const { adapter } = adapterWith(async (command) => {
      if (command instanceof HeadObjectCommand) throw new NotFound({ message: "not found", $metadata: {} });
      if (command instanceof GetObjectCommand) {
        const { NoSuchKey } = await import("@aws-sdk/client-s3");
        throw new NoSuchKey({ message: "no such key", $metadata: {} });
      }
      return {};
    });
    expect(await adapter.exists("uploads/u1/none.gpx")).toBe(false);
    expect(await adapter.get("uploads/u1/none.gpx")).toBeNull();
  });

  it("validates keys before calling S3", async () => {
    const send = vi.fn();
    const { adapter } = adapterWith(send);
    await expect(adapter.get("../x")).rejects.toThrow(InvalidStorageKeyError);
    expect(send).not.toHaveBeenCalled();
  });

  it("creates presigned upload URLs bound to the content type and checksum", async () => {
    const { adapter } = adapterWith(async () => ({}));
    const sha256 = createHash("sha256").update("<gpx/>").digest("hex");
    const upload = await adapter.createUploadUrl("uploads/u1/f1.gpx", {
      contentType: "application/gpx+xml",
      expiresInSeconds: 300,
      sha256,
      sizeBytes: 6,
    });
    const checksum = Buffer.from(sha256, "hex").toString("base64");
    expect(upload.url).toContain("test-bucket");
    expect(upload.url).toContain("X-Amz-Expires=300");
    expect(decodeURIComponent(new URL(upload.url).searchParams.get("X-Amz-SignedHeaders") ?? "")).toContain(
      "x-amz-checksum-sha256",
    );
    expect(upload.headers).toEqual({ "Content-Type": "application/gpx+xml", "x-amz-checksum-sha256": checksum });
  });

  it("reads the full-object SHA-256 from S3 as hex", async () => {
    const sha256 = createHash("sha256").update("<gpx/>").digest("hex");
    const { adapter } = adapterWith(async () => ({
      ContentLength: 6,
      ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
    }));
    expect(await adapter.head("uploads/u1/f1.gpx")).toEqual({ sizeBytes: 6, sha256 });
  });

  it("does not treat a multipart composite checksum as the file's SHA-256", async () => {
    const { adapter } = adapterWith(async () => ({ ContentLength: 6, ChecksumSHA256: "abc=-3" }));
    expect(await adapter.head("uploads/u1/f1.gpx")).toEqual({ sizeBytes: 6, sha256: null });
  });
});
