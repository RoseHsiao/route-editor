import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/lib/generated/prisma/client";
import { serverEnv } from "@/lib/env";

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function db(): PrismaClient {
  globalForPrisma.prisma ??= createPrismaClient(serverEnv().DATABASE_URL);
  return globalForPrisma.prisma;
}
