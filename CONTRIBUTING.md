# Contributing to RouteEditor

Thanks for your interest. RouteEditor is in early development, so please open an
issue to discuss a change before you start on anything substantial.

## Ground rules

- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
- **Never commit** secrets, `.env` files, personal GPX tracks, or any data you are
  not allowed to redistribute. Put private test files in `fixtures/private/`, which
  is gitignored. See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).
- Report security issues privately. See [SECURITY.md](SECURITY.md).

## Development setup

Follow [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Making a change

1. Keep changes focused. Each pull request should do one thing.
2. Respect the module boundaries in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). ESLint enforces
   the most important ones: pure modules (`lib/planning`, `lib/geo`, `lib/accommodation`) must not
   import framework, database, or I/O code.
3. Add tests:
   - Pure logic gets unit tests (`tests/unit`).
   - Anything touching SQL or PostGIS gets integration tests against a real database (`tests/integration`). Do not mock geometry.
   - User-visible flows get Playwright tests (`tests/e2e`).
   - Worker code gets pytest tests (`workers/geo-processing/tests`).
4. Schema changes: edit `prisma/schema.prisma` and run `pnpm db:migrate --name <change>`, then
   review the generated SQL. CHECK constraints, triggers, and changes inside `Unsupported(...)`
   types must be written by hand. See [docs/DATA_MODEL.md](docs/DATA_MODEL.md).
5. Significant decisions get an Architecture Decision Record in `docs/adr/`.
6. Before you open a pull request, run:

   ```sh
   pnpm check && pnpm test:integration && pnpm build
   pnpm worker:lint && pnpm worker:test
   pnpm test:e2e
   ```

## Style

- TypeScript strict mode. Avoid `any`, and avoid non-null assertions unless they are justified in a comment.
- Name things after the domain: trail, variant, segment, trek, day, stop.
- Units go in names: `distanceKm`, `ascentM`, `estimatedMovingMinutes`.
- Comments explain *why*, not *what*.

## Licensing of contributions

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE). Data contributions must state their source and licence
and are reviewed separately (see [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)).
