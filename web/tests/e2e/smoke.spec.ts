import { expect, test } from "@playwright/test";

/**
 * Smoke coverage for the pages a visitor can reach without a wallet.
 *
 * Run against a production build: `npm run build && npm run test:e2e`.
 */

test("landing page renders and offers a wallet connection", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Confidential invoices");
  await expect(page.getByText("Not connected")).toBeVisible();
});

test("dashboard prompts for a wallet when disconnected", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  // Either the wallet prompt or the not-configured notice, depending on env.
  await expect(
    page.getByText(/Wallet not connected|Escrow not configured/),
  ).toBeVisible();
});

test("new-invoice page renders its form scaffolding", async ({ page }) => {
  await page.goto("/invoices/new");
  await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();
});

test("an invalid invoice id is reported rather than crashing", async ({ page }) => {
  await page.goto("/invoices/not-a-number");
  await expect(page.getByText("Invalid invoice id")).toBeVisible();
});
