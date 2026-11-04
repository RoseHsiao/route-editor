<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## TrailPlanner conventions

- Read `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md` and the ADRs in `docs/adr/` before changing behaviour.
- Pure modules (`lib/planning`, `lib/geo`, `lib/accommodation`) must not import framework, database or I/O code (ESLint enforces this).
- Geometry SQL goes through `lib/db/geometry.ts` using tagged-template raw queries only.
- Never fabricate elevation, availability or route metrics. Never present recommendations as bookings (ADR 0006).
- Never commit `.env*` (except `.env.example`), personal GPS tracks, or data without redistribution rights.
- Do not commit, push, deploy, or run destructive database commands without explicit approval from the maintainer.
- Before finishing a change: `pnpm check && pnpm test:integration && pnpm build`, plus `pnpm worker:lint && pnpm worker:test` if the worker changed.
