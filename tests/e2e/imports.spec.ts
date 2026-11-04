import path from "node:path";

import { expect, test } from "@playwright/test";

const FIXTURE = path.join(import.meta.dirname, "../../fixtures/synthetic/track-basic.gpx");

test("imports page offers an upload form and is reachable from the navigation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Imports", exact: true }).first().click();
  await expect(page).toHaveURL(/\/imports$/);
  await expect(page.getByRole("heading", { level: 1, name: "Imports" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Imports", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("GPX or GeoJSON file")).toBeVisible();
  // Uploaders cannot declare data as official or synthetic.
  await expect(page.getByRole("radio")).toHaveCount(3);
});

test("the form explains what is missing instead of uploading", async ({ page }) => {
  await page.goto("/imports");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("Choose a .gpx, .geojson or .json file.")).toBeVisible();
});

test("open data needs attribution, checked by the server", async ({ page }) => {
  await page.goto("/imports");
  await page.getByLabel("GPX or GeoJSON file").setInputFiles(FIXTURE);
  await page.getByRole("radio", { name: /Open data/ }).check();
  await page.getByLabel("Source name").fill("Synthetic e2e fixture");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByText("Open data requires attribution text.")).toBeVisible();
});

test("a synthetic upload becomes an import job with an honest status", async ({ page }) => {
  await page.goto("/imports");
  await page.getByLabel("GPX or GeoJSON file").setInputFiles(FIXTURE);
  await page.getByLabel("Source name").fill("Synthetic e2e fixture");
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page).toHaveURL(/\/imports\/[a-z0-9]+$/);
  // No worker runs during e2e tests: the job waits, and the page says so.
  await expect(page.getByText(/Waiting for the geo worker|Processing the file|Imported/).first()).toBeVisible();
  await expect(page.getByText(/SHA-256 [0-9a-f]{64}/)).toBeVisible();
});

test("unknown imports show the not-found page, and the API answers 404", async ({ page, request }) => {
  // The page streams from a Suspense boundary before the lookup, so Next.js keeps status
  // 200 and adds noindex (see next/dist/docs, notFound). The JSON API returns a real 404.
  await page.goto("/imports/does-not-exist");
  await expect(page.getByRole("heading", { name: "Off the trail" })).toBeVisible();
  const html = await (await request.get("/imports/does-not-exist")).text();
  expect(html).toContain('<meta name="robots" content="noindex"/>');
  const response = await request.get("/api/imports/does-not-exist");
  expect(response.status()).toBe(404);
});
