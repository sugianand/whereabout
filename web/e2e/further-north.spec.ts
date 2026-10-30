import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

test("Further North deals pairs of photos until the first wrong pick, and keeps the best", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./further-north");
  await expect(page.getByText("Further North: which photo was taken further north?")).toBeVisible();
  const { width, height } = page.viewportSize()!;

  // Both photos and their pick buttons are on screen, side by side or stacked.
  for (const n of [1, 2]) {
    await expect(
      page.getByRole("button", { name: `Photo ${n} was taken further north` }),
    ).toBeEnabled();
    const box = (await page.getByTestId(`north-photo-${n}`).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    expect(box.height).toBeGreaterThan(120);
  }

  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  // Always picking photo 1 is right about half the time: play until a miss ends the run.
  let streak = 0;
  for (let i = 0; i < 40; i++) {
    const kept = await page.getByTestId("north-photo-2").getAttribute("data-photo");
    await page.getByRole("button", { name: "Photo 1 was taken further north" }).click();
    await expect(card).toBeVisible();
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    // The places show only now, each with its latitude.
    await expect(page.getByTestId("north-photo-1")).toContainText(/\d+\.\d° [NS]|0\.0°/);

    if ((await card.getByRole("heading").textContent()) === "Wrong") break;
    streak++;
    await card.getByRole("button", { name: "Next pair" }).click();
    // The second photo moves to the first place, beside a new one.
    await expect(page.getByTestId("north-photo-1")).toHaveAttribute("data-photo", kept!);
  }

  await expect(card).toContainText(`Run over: ${streak} pair`);
  expect(await page.evaluate(() => localStorage.getItem("whereabout:further-north-best"))).toBe(
    streak > 0 ? String(streak) : null,
  );

  // A new run starts at 0, and the best survives a reload.
  await card.getByRole("button", { name: "Start a new run" }).click();
  await expect(page.getByText("Streak", { exact: true }).locator("+ dd")).toHaveText("0");
  await page.reload();
  await expect(page.getByText("Best", { exact: true }).locator("+ dd")).toHaveText(String(streak));
  // Key 2 picks the second photo.
  await expect(page.getByRole("button", { name: "Photo 2 was taken further north" })).toBeEnabled();
  await page.keyboard.press("2");
  await expect(card).toBeVisible();
  expect(errors).toEqual([]);
});
