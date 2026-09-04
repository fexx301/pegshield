import { expect, test } from "@playwright/test";

test("dashboard exposes the evidence-first purchase flow", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "When the peg breaks, proof pays." }),
  ).toBeVisible();
  await expect(page.getByText("TESTNET", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "USDC depeg cover" }),
  ).toBeVisible();
  await expect(
    page
      .getByText(/CC3 pool read verified|Historical source fixture available/)
      .first(),
  ).toBeVisible({ timeout: 30_000 });
  if (await page.getByText("CC3 pool read verified").isVisible()) {
    await expect(page.getByText("Purchased")).toBeVisible();
  } else {
    await expect(
      page.getByText("deployment manifest pending").first(),
    ).toBeVisible();
    await expect(page.getByText("No live policy loaded")).toBeVisible();
    await expect(
      page.getByText("Historical source fixture available"),
    ).toBeVisible();
  }
  await expect(page.getByRole("link", { name: /0x60f65e8b/ })).toHaveAttribute(
    "href",
    /^https:\/\/etherscan\.io\/tx\//,
  );
  await page.getByLabel("Coverage amount (TestUSD)").fill("2500");
  await page.getByLabel("Beneficiary address").fill(`0x${"11".repeat(20)}`);
  await expect(
    page.getByRole("button", { name: "Purchase policy" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "Settle from verified evidence" }),
  ).toBeVisible();
  await expect(page.getByLabel("First observation proof")).toBeVisible();
  await expect(page.getByLabel("Confirmation observation proof")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Submit atomic claim" }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Inspect evidence" }).click();
  await expect(
    page.getByRole("heading", { name: "Independent facts, one panel." }),
  ).toBeVisible();
});

test("dashboard keeps a shareable policy selection after reload", async ({
  page,
}) => {
  await page.goto("/?policy=1");
  await expect(
    page
      .getByText(/CC3 pool read verified|Historical source fixture available/)
      .first(),
  ).toBeVisible({ timeout: 30_000 });

  if (await page.getByText("CC3 pool read verified").isVisible()) {
    await expect(page.getByText(/policy 01 \/ coverage/)).toBeVisible();
    await expect(
      page.getByText(/(Active|Claimed|Expired) · no replay/),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText(/policy 01 \/ coverage/)).toBeVisible();
    await expect(
      page.getByText(/(Active|Claimed|Expired) · no replay/),
    ).toBeVisible();
  }
});
