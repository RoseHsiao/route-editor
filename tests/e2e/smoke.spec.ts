import { expect, test } from "@playwright/test";

test("landing page explains the product and links to trails", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Plan long trails one stage at a time.");
  await page.getByRole("link", { name: "Explore trails" }).first().click();
  await expect(page).toHaveURL(/\/trails$/);
  await expect(page.getByRole("heading", { level: 1, name: "Trails" })).toBeVisible();
});

test("explore shows a real empty state, not placeholder trails", async ({ page }) => {
  await page.goto("/trails");
  await expect(page.getByText("No trails published yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore trails", exact: true })).toHaveAttribute("aria-current", "page");
});

test("my treks uses the development user", async ({ page }) => {
  await page.goto("/my-treks");
  await expect(page.getByRole("heading", { level: 1, name: "My treks" })).toBeVisible();
  await expect(page.getByText("No treks yet")).toBeVisible();
});

test("design system lists every accommodation reliability state", async ({ page }) => {
  await page.goto("/design-system");
  for (const label of ["Booked", "Availability confirmed", "Availability unknown", "Unverified"]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
});

test("health endpoint reports PostGIS", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ status: "ok", database: "ok", postgis: expect.stringMatching(/^3\./) });
});

test("unknown pages return 404", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Off the trail" })).toBeVisible();
});
