import { z } from "zod";

/**
 * Server-side environment, validated once on first access.
 * Client-visible values (NEXT_PUBLIC_*) are read directly where used so that
 * Next.js can inline them; see lib/map/config.ts.
 */
const booleanString = z
  .enum(["true", "false", ""])
  .default("false")
  .transform((value) => value === "true");

const serverEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().url(),

    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().min(1).default(".data/storage"),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: booleanString,

    AUTH_DEV_STUB: booleanString,
    AUTH_DEV_STUB_EMAIL: z.string().email().default("dev@trailplanner.local"),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === "s3" && !env.S3_BUCKET) {
      ctx.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "Required when STORAGE_DRIVER is s3" });
    }
    if (env.STORAGE_DRIVER === "local" && env.NODE_ENV === "production") {
      ctx.addIssue({
        code: "custom",
        path: ["STORAGE_DRIVER"],
        message: "The local storage driver is for development only",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Parses an environment object. Exported for tests; application code uses {@link serverEnv}. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
