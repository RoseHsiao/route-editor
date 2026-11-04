import "server-only";

import { serverEnv } from "@/lib/env";

import { LocalStorageAdapter } from "./local";
import { S3StorageAdapter } from "./s3";
import type { StorageAdapter } from "./types";

export type { StorageAdapter } from "./types";
export { buildStorageKey } from "./keys";

let instance: StorageAdapter | undefined;

export function storage(): StorageAdapter {
  if (instance) return instance;
  const env = serverEnv();
  instance =
    env.STORAGE_DRIVER === "s3"
      ? new S3StorageAdapter({
          // Presence is validated by serverEnv().
          bucket: env.S3_BUCKET!,
          region: env.S3_REGION,
          endpoint: env.S3_ENDPOINT,
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
        })
      : new LocalStorageAdapter(env.STORAGE_LOCAL_DIR);
  return instance;
}
