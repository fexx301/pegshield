import { expect, test } from "@playwright/test";

test("completed payout is usable on a small screen without a wallet", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?policy=1");
  await page.getByRole("link", { name: "Explore a completed payout" }).click();
  await page.getByRole("button", { name: /Two price observations/ }).click();
  await expect(
    page.getByRole("link", { name: /View the confirmation/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /100 TestUSD paid/ }).click();
  await expect(
    page.getByRole("link", { name: /View the payout transfer/ }),
  ).toBeVisible();
  await expect(
    page.getByText(/not an actual economic USDC depeg/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/payout-mobile.png",
    fullPage: true,
  });
});

test("automatic preparation explains failures and offers recovery", async ({
  page,
}) => {
  await page.route("**/api/claims/1", async (route) => {
    if (route.request().method() === "POST")
      return route.fulfill({
        status: 502,
        json: { error: "Evidence service unavailable. Please retry shortly." },
      });
    return route.fulfill({
      json: {
        eligibility: {
          status: "eligible",
          observations: [],
          checkedAt: new Date().toISOString(),
        },
      },
    });
  });
  await page.goto("/?policy=1");
  await expect(
    page.getByRole("button", { name: "Prepare claim", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page
    .getByRole("button", { name: "Prepare claim", exact: true })
    .click();
  await expect(
    page.getByText("Evidence service unavailable. Please retry shortly."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry network check" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Claim payout" }),
  ).toBeDisabled();
});

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
    await expect(
      page.getByRole("heading", { name: "Purchased", exact: true }),
    ).toBeVisible();
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
    page.getByRole("heading", { name: "Prepare your claim" }),
  ).toBeVisible();
  await expect(page.getByLabel("First observation proof")).not.toBeVisible();
  await page.getByText("Advanced: inspect or upload proof files").click();
  await expect(page.getByLabel("First observation proof")).toBeVisible();
  await expect(page.getByLabel("Confirmation observation proof")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Claim payout" }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Explore a completed payout" }).click();
  await expect(
    page.getByRole("heading", { name: "Follow a completed payout." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /100 TestUSD paid/ }).click();
  await expect(
    page.getByRole("link", { name: /View the payout transfer/ }),
  ).toHaveAttribute("href", /0x575030ff/);
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
