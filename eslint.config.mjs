import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Pure domain modules: deterministic, unit-testable, no framework or I/O.
// See docs/ARCHITECTURE.md ("Module boundaries").
const PURE_MODULES = ["lib/planning/**", "lib/geo/**", "lib/accommodation/**"];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: PURE_MODULES,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["next", "next/*", "react", "react-dom"], message: "Pure modules must not depend on the UI framework." },
            { group: ["@/lib/db/*", "@/lib/generated/*", "@prisma/*"], message: "Pure modules must not access the database." },
            { group: ["@/lib/storage", "@/lib/storage/*", "@/services/*"], message: "Pure modules must not perform I/O." },
            { group: ["node:*", "fs", "fs/*", "path", "http", "https"], message: "Pure modules must not use Node I/O." },
            { group: ["server-only"], message: "Pure modules run anywhere." },
          ],
        },
      ],
    },
  },
  {
    // The generated client is only used through lib/db and services.
    files: ["app/**", "components/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/lib/generated/*"], message: "Import database types through lib/db or services." }] },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "lib/generated/**",
    "workers/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
