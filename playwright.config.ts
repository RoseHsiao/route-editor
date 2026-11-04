import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

/**
 * End-to-end tests run against `next dev` until Milestone 4, because the
 * development user stub is (correctly) refused by production builds.
 * Requires the database: `pnpm db:up && pnpm db:deploy`.
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    // Start from a fresh Turbopack dev cache. Restarting `next dev` (16.4.4) on a cache left
    // by a previous, killed dev server was observed to put the client into an endless
    // Fast Refresh reload loop. The cache is only a speed-up; see docs/DEVELOPMENT.md.
    command: `node -e "require('fs').rmSync('.next/dev/cache/turbopack',{recursive:true,force:true})" && pnpm exec next dev --port ${PORT}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
