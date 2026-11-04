/**
 * Decides how users are identified. Pure, so the production guard is unit-testable.
 * See docs/adr/0004-authentication-seam.md.
 */

export type AuthMode = "dev-stub" | "authjs";

export class UnsafeAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeAuthConfigurationError";
  }
}

export function resolveAuthMode(env: { NODE_ENV?: string; AUTH_DEV_STUB?: string; VERCEL_ENV?: string }): AuthMode {
  const stubRequested = env.AUTH_DEV_STUB === "true";
  if (!stubRequested) return "authjs";

  // Vercel preview deployments run with NODE_ENV=production, but check VERCEL_ENV
  // as well so the guard does not depend on a single variable.
  if (env.NODE_ENV === "production" || env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") {
    throw new UnsafeAuthConfigurationError(
      "AUTH_DEV_STUB=true is not allowed in production builds or deployments. Remove it from the environment.",
    );
  }
  return "dev-stub";
}
