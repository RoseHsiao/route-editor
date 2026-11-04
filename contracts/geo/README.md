# Geo processing contract

The JSON shapes exchanged between the Python geo worker and the TypeScript app, versioned.
`v1/` is the current version (`CONTRACT_VERSION = 1`, recorded in
`import_jobs.contract_version` and in every validation report).

| File | Purpose |
|---|---|
| `v1/contract.schema.json` | JSON Schema (2020-12) for the normalized import, line, segment, profile, waypoint, validation report, issue and job errors. `x-semanticRules` lists the cross-field rules JSON Schema cannot express |
| `v1/constants.json` | Limits and thresholds shared by both languages |
| `v1/examples/*.json` | The worker's output for every synthetic fixture in `fixtures/synthetic/` |
| `v1/examples/conformance/*.json` | Valid and invalid documents, each with the definition it targets and the expected result |

## How the two languages stay in agreement

- **Python** (`workers/geo-processing`): `trailworker/contract.py` mirrors the constants;
  `trailworker/contract_checks.py` implements the semantic rules. `tests/test_contract.py`
  validates every example and conformance case with the JSON Schema plus those rules, checks
  the constants, and regenerates every example from its fixture to check it is current.
- **TypeScript**: `lib/import/contract.ts` defines the Zod parsers the app uses to read stored
  data, including the same semantic rules. `tests/unit/import/contract.test.ts` parses every
  example and runs the conformance corpus.
- **End to end**: `tests/integration/imports.test.ts` uploads fixtures through the TypeScript
  service, runs the real worker against the PostGIS test database, and checks that what the
  app reads back matches the committed example exactly.

## Changing the contract

1. Backwards-compatible additions (an optional field, a new issue code) stay in v1. Update the
   schema, both implementations and the corpus together.
2. Anything else is a new version directory (`v2/`), with readers for both versions until
   stored v1 data has been migrated.
3. If worker output changes intentionally, regenerate the examples
   (`uv run python scripts/generate_contract_examples.py` in `workers/geo-processing`) and
   review the diff.
