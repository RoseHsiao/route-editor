import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import constants from "@/contracts/geo/v1/constants.json";
import {
  CONTRACT_DEFINITIONS,
  GEO_CONTRACT,
  normalizedImportSchema,
  validationReportSchema,
} from "@/lib/import/contract";

/**
 * The same corpus is checked by workers/geo-processing/tests/test_contract.py. If the two
 * languages disagree about any document, one of the two suites fails.
 */
const ROOT = path.join(import.meta.dirname, "../../../contracts/geo/v1");
const read = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

const examples = readdirSync(path.join(ROOT, "examples"))
  .filter((name) => name.endsWith(".json"))
  .map((name) => ({ name, document: read(path.join(ROOT, "examples", name)) }));

const conformance = readdirSync(path.join(ROOT, "examples", "conformance"))
  .filter((name) => name.endsWith(".json"))
  .map((name) => ({ name, spec: read(path.join(ROOT, "examples", "conformance", name)) }));

describe("geo contract v1", () => {
  it("uses the shared constants file", () => {
    expect(GEO_CONTRACT).toEqual(constants);
    expect(GEO_CONTRACT.contractVersion).toBe(1);
  });

  it("has a worker example for every synthetic fixture", () => {
    const fixtures = readdirSync(path.join(ROOT, "../../../fixtures/synthetic")).filter((name) =>
      /\.(gpx|geojson)$/.test(name),
    );
    expect(examples.map(({ name }) => name.replace(/\.json$/, "")).sort()).toEqual(
      fixtures.map((name) => name.replace(/\.(gpx|geojson)$/, "")).sort(),
    );
  });

  it.each(examples)("parses the worker's output for $name", ({ document }) => {
    const report = validationReportSchema.safeParse(document.report);
    expect(report.error?.issues ?? []).toEqual([]);
    if (document.outcome === "SUCCEEDED") {
      const normalized = normalizedImportSchema.safeParse(document.normalized);
      expect(normalized.error?.issues ?? []).toEqual([]);
    } else {
      expect(document.normalized).toBeNull();
    }
  });

  it.each(conformance)("agrees with Python on $name", ({ spec }) => {
    const schema = CONTRACT_DEFINITIONS[spec.definition as keyof typeof CONTRACT_DEFINITIONS];
    expect(schema, `no TypeScript parser for ${String(spec.definition)}`).toBeDefined();
    const result = schema.safeParse(spec.document);
    expect(result.success, String(spec.reason)).toBe(spec.expect === "valid");
  });
});
