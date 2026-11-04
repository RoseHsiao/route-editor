import { execFileSync } from "node:child_process";

import "dotenv/config";

import { assertSafeTestDatabaseUrl } from "./test-database";

/**
 * Applies pending migrations to the test database once per run.
 * Non-destructive: tests isolate themselves by truncating tables (see truncateAll).
 * If the test schema ever diverges, recreate it deliberately with
 * `DATABASE_URL=$TEST_DATABASE_URL pnpm exec prisma migrate reset` (see docs/DEVELOPMENT.md).
 */
export default function setup(): void {
  const url = assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
