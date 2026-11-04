/**
 * Object storage abstraction. Raw uploads and generated exports live here;
 * the database stores only keys and metadata (StoredFile).
 *
 * The Python geo worker implements the same key rules (workers/geo-processing).
 */

export interface PutObjectOptions {
  contentType: string;
}

export interface ObjectHead {
  sizeBytes: number;
  /** Lowercase hex SHA-256 of the stored bytes, when the driver can vouch for it. */
  sha256: string | null;
}

export interface UploadUrlOptions extends PutObjectOptions {
  expiresInSeconds: number;
  /**
   * Lowercase hex SHA-256 the uploaded bytes must have. S3 rejects an upload whose
   * checksum differs, so the stored object is exactly what the client declared.
   */
  sha256: string;
  sizeBytes: number;
}

export interface StoredObject {
  body: Buffer;
  contentType: string | undefined;
}

export interface PresignedUpload {
  url: string;
  /** Headers the client must send with the PUT request. */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface StorageAdapter {
  readonly driver: "local" | "s3";
  put(key: string, body: Buffer, options: PutObjectOptions): Promise<void>;
  /** Returns null when the object does not exist. */
  get(key: string): Promise<StoredObject | null>;
  exists(key: string): Promise<boolean>;
  /** Size and checksum of a stored object, or null when it does not exist. */
  head(key: string): Promise<ObjectHead | null>;
  /** Deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
  /**
   * Direct-to-storage upload URL, so large files bypass the application server.
   * Returns null when the driver does not support it (local development).
   */
  createUploadUrl(key: string, options: UploadUrlOptions): Promise<PresignedUpload | null>;
}

export class InvalidStorageKeyError extends Error {
  constructor(key: string, reason: string) {
    super(`Invalid storage key "${key}": ${reason}`);
    this.name = "InvalidStorageKeyError";
  }
}
