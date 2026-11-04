import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { assertValidStorageKey } from "./keys";
import type { ObjectHead, PresignedUpload, PutObjectOptions, StorageAdapter, StoredObject, UploadUrlOptions } from "./types";

export interface S3StorageConfig {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

/** Any S3-compatible service (AWS S3, Cloudflare R2, MinIO, ...). */
export class S3StorageAdapter implements StorageAdapter {
  readonly driver = "s3" as const;
  private readonly bucket: string;

  constructor(
    config: S3StorageConfig,
    private readonly client: S3Client = createClient(config),
  ) {
    this.bucket = config.bucket;
  }

  async put(key: string, body: Buffer, options: PutObjectOptions): Promise<void> {
    assertValidStorageKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: options.contentType }),
    );
  }

  async get(key: string): Promise<StoredObject | null> {
    assertValidStorageKey(key);
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!response.Body) return null;
      const bytes = await response.Body.transformToByteArray();
      return { body: Buffer.from(bytes), contentType: response.ContentType };
    } catch (error) {
      if (error instanceof NoSuchKey) return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    assertValidStorageKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (error instanceof NotFound) return false;
      throw error;
    }
  }

  async head(key: string): Promise<ObjectHead | null> {
    assertValidStorageKey(key);
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key, ChecksumMode: "ENABLED" }),
      );
      return {
        sizeBytes: response.ContentLength ?? 0,
        // Only a full-object SHA-256 counts; multipart composite checksums contain "-".
        sha256:
          response.ChecksumSHA256 && !response.ChecksumSHA256.includes("-")
            ? Buffer.from(response.ChecksumSHA256, "base64").toString("hex")
            : null,
      };
    } catch (error) {
      if (error instanceof NotFound) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertValidStorageKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async createUploadUrl(key: string, options: UploadUrlOptions): Promise<PresignedUpload> {
    assertValidStorageKey(key);
    const checksum = Buffer.from(options.sha256, "hex").toString("base64");
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType,
      ContentLength: options.sizeBytes,
      ChecksumSHA256: checksum,
    });
    // The checksum and length headers are signed, so the upload must match them exactly.
    const url = await getSignedUrl(this.client, command, {
      expiresIn: options.expiresInSeconds,
      unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
    });
    return {
      url,
      headers: {
        "Content-Type": options.contentType,
        "x-amz-checksum-sha256": checksum,
      },
      expiresAt: new Date(Date.now() + options.expiresInSeconds * 1000),
    };
  }
}

function createClient(config: S3StorageConfig): S3Client {
  return new S3Client({
    region: config.region || "auto",
    endpoint: config.endpoint || undefined,
    forcePathStyle: config.forcePathStyle ?? false,
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : undefined,
  });
}
