# 0004: Auth.js behind `getCurrentUser()`, with a development stub

**Status:** Accepted (2026-11-03)

## Context
Treks belong to users, but real authentication is scheduled for M4. Early milestones still need a user identity for foreign keys and for testing.

## Decision
- Application code identifies users only through `getCurrentUser()` / `requireUser()` (`lib/auth/current-user.ts`).
- Until M4, `AUTH_DEV_STUB=true` makes `getCurrentUser()` return a real `users` row for a development email address.
- `resolveAuthMode()` throws when the stub is requested with `NODE_ENV=production` or on Vercel preview or production deployments. `instrumentation.ts` calls it at server start, and `getCurrentUser()` calls it on every request. Unit tests cover the guard. M1 verified manually that `next start` fails with the stub set.
- M4 adds Auth.js sessions behind the same function.

## Consequences
- End-to-end tests run against `next dev` until M4.
- Any way to enable the stub in a deployed environment counts as a security vulnerability (SECURITY.md).
- Note: Auth.js v5 was still published under the `beta` tag at the time of writing. The version choice is revisited at M4.
