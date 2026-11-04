import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertValidStorageKey } from "./keys";
import {
  InvalidStorageKeyError,
  type ObjectHead,
  type PresignedUpload,
  type StorageAdapter,
  type StoredObject,
} from "./types";

const META_SUFFIX = ".meta.json";

/**
 * Filesystem storage for local development and tests. Not for production:
 * serverless filesystems are ephemeral and not shared between instances.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly driver = "local" as const;
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  private resolve(key: string): string {
    assertValidStorageKey(key);
    const target = path.resolve(this.root, key);
    // Defence in depth: key validation already rules out traversal.
    if (!target.startsWith(this.root + path.sep)) {
      throw new InvalidStorageKeyError(key, "resolves outside the storage root");
    }
    return target;
  }

  async put(key: string, body: Buffer, options: { contentType: string }): Promise<void> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
    await writeFile(target + META_SUFFIX, JSON.stringify({ contentType: options.contentType }));
  }

  async get(key: string): Promise<StoredObject | null> {
    const target = this.resolve(key);
    try {
      const body = await readFile(target);
      const meta = await readFile(target + META_SUFFIX, "utf8")
        .then((raw) => JSON.parse(raw) as { contentType?: string })
        .catch(() => ({ contentType: undefined }));
      return { body, contentType: meta.contentType };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.resolve(key))).isFile();
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async head(key: string): Promise<ObjectHead | null> {
    const target = this.resolve(key);
    try {
      const body = await readFile(target);
      return { sizeBytes: body.length, sha256: createHash("sha256").update(body).digest("hex") };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const target = this.resolve(key);
    await rm(target, { force: true });
    await rm(target + META_SUFFIX, { force: true });
  }

  async createUploadUrl(): Promise<PresignedUpload | null> {
    return null;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
