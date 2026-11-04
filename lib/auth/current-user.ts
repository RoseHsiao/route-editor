import "server-only";

import { db } from "@/lib/db/client";
import { serverEnv } from "@/lib/env";

import { resolveAuthMode } from "./mode";

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "UnauthenticatedError";
  }
}

/**
 * The only way application code identifies the user. Route handlers and
 * services must not read sessions or cookies directly.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const mode = resolveAuthMode(process.env);
  if (mode === "dev-stub") return devStubUser();
  // Auth.js sessions arrive in Milestone 4. Until then, non-stub mode has no users.
  return null;
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}

async function devStubUser(): Promise<CurrentUser> {
  const email = serverEnv().AUTH_DEV_STUB_EMAIL;
  // A real row, so foreign keys behave exactly as they will with real accounts.
  return db().user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Development user" },
    select: { id: true, email: true, name: true },
  });
}
