import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/lib/env";

const BASE = { DATABASE_URL: "postgresql://u:p@localhost:5433/trailplanner" };

describe("parseServerEnv", () => {
  it("applies development defaults", () => {
    const env = parseServerEnv(BASE);
    expect(env.STORAGE_DRIVER).toBe("local");
    expect(env.AUTH_DEV_STUB).toBe(false);
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it("requires a database URL", () => {
    expect(() => parseServerEnv({})).toThrow(/DATABASE_URL/);
  });

  it("requires a bucket for S3 storage", () => {
    expect(() => parseServerEnv({ ...BASE, STORAGE_DRIVER: "s3" })).toThrow(/S3_BUCKET/);
    expect(parseServerEnv({ ...BASE, STORAGE_DRIVER: "s3", S3_BUCKET: "uploads" }).S3_BUCKET).toBe("uploads");
  });

  it("refuses local storage in production", () => {
    expect(() => parseServerEnv({ ...BASE, NODE_ENV: "production" })).toThrow(/development only/);
  });

  it("does not echo secret values in errors", () => {
    try {
      parseServerEnv({ DATABASE_URL: "not a url with secret-password" });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("secret-password");
    }
  });
});
