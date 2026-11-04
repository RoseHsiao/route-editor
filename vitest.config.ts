import path from "node:path";

import { defineConfig } from "vitest/config";

const alias = {
  "@": import.meta.dirname,
  // `server-only` throws outside React Server Components; tests run in plain Node.
  "server-only": path.join(import.meta.dirname, "tests/support/empty-module.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          // Tests share one database; run files one at a time.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
