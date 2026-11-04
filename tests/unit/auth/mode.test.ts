import { describe, expect, it } from "vitest";

import { resolveAuthMode, UnsafeAuthConfigurationError } from "@/lib/auth/mode";

describe("resolveAuthMode", () => {
  it("uses the development stub only when explicitly requested outside production", () => {
    expect(resolveAuthMode({ NODE_ENV: "development", AUTH_DEV_STUB: "true" })).toBe("dev-stub");
    expect(resolveAuthMode({ NODE_ENV: "test", AUTH_DEV_STUB: "true" })).toBe("dev-stub");
  });

  it("defaults to real authentication", () => {
    expect(resolveAuthMode({ NODE_ENV: "development" })).toBe("authjs");
    expect(resolveAuthMode({ NODE_ENV: "development", AUTH_DEV_STUB: "false" })).toBe("authjs");
    expect(resolveAuthMode({ NODE_ENV: "development", AUTH_DEV_STUB: "TRUE" })).toBe("authjs");
  });

  it("refuses the stub in production", () => {
    expect(() => resolveAuthMode({ NODE_ENV: "production", AUTH_DEV_STUB: "true" })).toThrow(
      UnsafeAuthConfigurationError,
    );
  });

  it("refuses the stub on Vercel preview and production deployments regardless of NODE_ENV", () => {
    for (const VERCEL_ENV of ["preview", "production"]) {
      expect(() => resolveAuthMode({ NODE_ENV: "development", AUTH_DEV_STUB: "true", VERCEL_ENV })).toThrow(
        UnsafeAuthConfigurationError,
      );
    }
  });

  it("is fine in production when the stub is off", () => {
    expect(resolveAuthMode({ NODE_ENV: "production" })).toBe("authjs");
  });
});
