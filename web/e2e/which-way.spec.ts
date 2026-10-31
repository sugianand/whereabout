import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
// The globe's first frame on a software-rendered GL can be slow on a CI runner.
const GLOBE = { timeout: 20_000 };

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

test("Which way? travels from photo to photo until the first wrong compass point, and keeps the best", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./which-way");
  await expect(page.getByText("Which way?: set off from photo 1 toward photo 2")).toBeVisible();
  const { width, height } = page.viewportSize()!;

  // Both photos and all eight compass points fit the screen, with no sideways scroll.
  for (const n of [1, 2]) {
    const box = (await page.getByTestId(`way-photo-${n}`).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.height).toBeGreaterThan(120);
  }
  const compass = page.getByTestId("way-compass");
  await expect(compass.getByRole("button")).toHaveCount(8);
  const rose = (await compass.boundingBox())!;
  expect(rose.y + rose.height).toBeLessThanOrEqual(height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );

  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  // Always heading north is right now and then: travel on until a miss ends the run.
  let streak = 0;
  for (let i = 0; i < 40; i++) {
    const headed = await page.getByTestId("way-photo-2").getAttribute("data-photo");
    await expect(page.getByRole("button", { name: "Headed north", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Headed north", exact: true }).click();
    await expect(card).toBeVisible();
    // The card names the route and its bearing, and stays inside the screen.
    await expect(card).toContainText(
      / is (north|south|east|west|north-east|north-west|south-east|south-west) of /,
    );
    await expect(card).toContainText(/sets off at \d{1,3}°/);
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    if (width < 768)
      expect(box.height, "the route stays in view above the card").toBeLessThan(height / 2);
    // The route is on the globe: pin 1 where you stood and the gold pin where you were headed.
    await expect(page.locator(".globe-pin--truth")).toBeVisible(GLOBE);
    await expect(page.locator(".globe-pin--labelled")).toHaveText("1");
    // The globe's own coordinate line is for screen readers here: the card already names the place.
    await expect(page.locator("#globe-pin-status")).toHaveText(/^It was here: /);
    expect((await page.locator("#globe-pin-status").boundingBox())!.width).toBeLessThanOrEqual(1);

    const verdict = await card.getByRole("heading", { level: 2 }).textContent();
    if (verdict === "Wrong") break;
    streak++;
    await card.getByRole("button", { name: "Travel on" }).click();
    // Where you were headed is where you stand now.
    await expect(page.getByTestId("way-photo-1")).toHaveAttribute("data-photo", headed!);
  }

  await expect(card).toContainText(`Run over: ${streak} stop`);
  expect(await page.evaluate(() => localStorage.getItem("whereabout:which-way-best"))).toBe(
    streak > 0 ? String(streak) : null,
  );

  // A new run starts at 0, and the best survives a reload and shows in the Games menu.
  await card.getByRole("button", { name: "Start a new run" }).click();
  await expect(page.getByText("Streak", { exact: true }).locator("+ dd")).toHaveText("0");
  await page.reload();
  await expect(page.getByText("Best", { exact: true }).locator("+ dd")).toHaveText(String(streak));
  await page.getByRole("button", { name: "Games" }).click();
  const menu = page.getByRole("dialog", { name: "Ways to play" });
  await expect(menu.getByTestId("best-which-way")).toHaveText(
    streak > 0 ? `Best: ${streak} in a row` : "No best yet",
  );
  await expect(menu.getByText("Playing now")).toBeVisible();
  expect(errors).toEqual([]);
});
