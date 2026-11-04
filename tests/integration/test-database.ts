import "dotenv/config";

import { createPrismaClient } from "@/lib/db/client";
import type { PrismaClient } from "@/lib/generated/prisma/client";

/**
 * Integration tests reset their database. Refuse anything that is not clearly
 * a dedicated test database, so a misconfigured env can never wipe real data.
 */
export function assertSafeTestDatabaseUrl(testUrl: string | undefined, appUrl: string | undefined): string {
  if (!testUrl) {
    throw new Error("TEST_DATABASE_URL is not set. See .env.example and docs/DEVELOPMENT.md.");
  }
  if (appUrl && testUrl === appUrl) {
    throw new Error("TEST_DATABASE_URL must differ from DATABASE_URL.");
  }
  const { hostname, pathname } = new URL(testUrl);
  const database = pathname.replace(/^\//, "");
  if (!/test/i.test(database)) {
    throw new Error(`Refusing to use "${database}" for tests: the database name must contain "test".`);
  }
  if (!["localhost", "127.0.0.1", "::1", "db"].includes(hostname) && !process.env.CI) {
    throw new Error(`Refusing to reset a non-local database (${hostname}) outside CI.`);
  }
  return testUrl;
}

let client: PrismaClient | undefined;

export function testDb(): PrismaClient {
  client ??= createPrismaClient(assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL));
  return client;
}

/** Empties every application table (not PostGIS's spatial_ref_sys). */
export async function truncateAll(): Promise<void> {
  const db = testDb();
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('spatial_ref_sys', '_prisma_migrations')`;
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`).join(", ");
  // Table names come from the catalogue, not from input.
  await db.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
}
