import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG: { id: string; landCover?: string }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const COVER = new Map(CATALOG.map((p) => [p.id, p.landCover]));
const COVERS = [
  "Built-up",
  "Tree cover",
  "Grassland",
  "Permanent water bodies",
  "Bare / sparse vegetation",
];

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

async function coverOnScreen(page: Page) {
  const photo = page.getByTestId("ground-photo");
  await expect(photo).toHaveAttribute("data-photo", /.+/);
  const cover = COVER.get((await photo.getAttribute("data-photo"))!);
  expect(COVERS).toContain(cover);
  return cover!;
}

const coverButton = (page: Page, cover: string) =>
  page.getByTestId(`ground-${COVERS.indexOf(cover) + 1}`);
const wrongFor = (cover: string) => (cover === "Grassland" ? "Built-up" : "Grassland");

test("What's on the ground? plays five photos against Atlas, lights each on the band of covers, and keeps the best", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./on-the-ground");
  await expect(page.getByText("What's on the ground? Name the cover.")).toBeVisible();
  const { width, height } = page.viewportSize()!;
  // All five covers sit on screen, under a photo big enough to read.
  for (const cover of COVERS) {
    const button = coverButton(page, cover);
    await expect(button).toBeEnabled();
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  }
  expect((await page.getByTestId("ground-photo").boundingBox())!.height).toBeGreaterThan(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );

  // Three right calls (the first two by tap, the third by key), then two wrong ones.
  for (let n = 0; n < 5; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 5`, { exact: true })).toBeVisible();
    const truth = await coverOnScreen(page);
    const pick = n < 3 ? truth : wrongFor(truth);
    await expect(coverButton(page, pick)).toBeEnabled();
    if (n === 2) await page.keyboard.press(String(COVERS.indexOf(pick) + 1));
    else await coverButton(page, pick).click();
    const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
    await expect(card.getByRole("heading")).toHaveText(n < 3 ? "Correct" : "Wrong");
    const band = card.getByTestId("ground-band");
    await expect(band.locator("[aria-current='location']")).toHaveAttribute("data-cover", truth);
    await expect(band.locator(`[data-cover='${pick}']`)).toContainText("You");
    await expect(card).toContainText(/Atlas('s clues named no| read it as)/);
    // The answer card fits the screen, with its button in reach.
    const box = (await card.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    await card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }).click();
  }

  await expect(page.getByRole("heading", { level: 1, name: "3 of 5" })).toBeVisible();
  await expect(page.getByTestId("ground-row")).toHaveCount(5);
  await expect(page.getByText("That's your new best!")).toBeVisible();

  // The best is kept, and the Games menu shows it beside the game's name.
  await page.reload();
  await expect(page.getByText("Best").locator("xpath=following-sibling::dd")).toHaveText("3");
  await page.getByRole("button", { name: "Games" }).click();
  await expect(page.getByTestId("best-on-the-ground")).toHaveText("Best: 3 of 5 right");
  expect(errors).toEqual([]);
});

test("a 320px phone fits every cover, the answer and the end of a game", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./on-the-ground");
  for (const cover of COVERS) {
    const box = (await coverButton(page, cover).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(321);
    expect(box.y + box.height).toBeLessThanOrEqual(569);
  }
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  for (let n = 0; n < 5; n++) {
    const truth = await coverOnScreen(page);
    await coverButton(page, truth).click();
    const box = (await card.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(569);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "5 of 5" })).toBeVisible();
  const again = page.getByRole("button", { name: "Play again" });
  await again.scrollIntoViewIfNeeded();
  const box = (await again.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(321);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
