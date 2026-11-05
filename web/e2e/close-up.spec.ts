import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG: { id: string; country: string; place: string }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const BY_ID = new Map(CATALOG.map((p) => [p.id, p]));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({
      body: PHOTO,
      contentType: "image/png",
      headers: { "access-control-allow-origin": "*" },
    }),
  );
});

const option = (page: Page, n: number) => page.getByTestId(`close-option-${n}`);
const photo = (page: Page) => page.getByTestId("close-photo");

/** Which of the four is right, and which wrong, for the photo on screen. */
async function shown(page: Page) {
  await expect(option(page, 4)).toBeVisible();
  const id = (await page.locator("main").getAttribute("data-photo"))!;
  const names = await Promise.all(
    [1, 2, 3, 4].map(async (n) => (await option(page, n).getAttribute("data-country"))!),
  );
  const right = names.indexOf(BY_ID.get(id)!.country) + 1;
  return { right, wrong: [1, 2, 3, 4].filter((n) => n !== right) };
}

async function inView(page: Page, target: ReturnType<Page["getByRole"]>) {
  const { width, height } = page.viewportSize()!;
  const box = (await target.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
}

/** The photo as drawn, once its zoom has settled. */
async function drawnWidth(page: Page) {
  return photo(page).evaluate(async (img) => {
    await Promise.all(img.getAnimations().map((a) => a.finished));
    return img.getBoundingClientRect().width;
  });
}

test("Close-up zooms out with each wrong name, plays five photos against Atlas, and keeps the best", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./close-up");
  await expect(page.getByText("Close-up: which country is this?")).toBeVisible();
  await expect(page.getByText("Photo 1 of 5")).toBeVisible();
  await expect(page.getByText("Worth 3 points")).toBeVisible();

  // The crop fills the frame and a wrong name widens it.
  let { right, wrong } = await shown(page);
  const tight = await drawnWidth(page);
  const frame = (await page.getByTestId("close-frame").boundingBox())!;
  expect(tight).toBeGreaterThan(frame.width * 2);
  await option(page, wrong[0]).click();
  await expect(option(page, wrong[0])).toBeDisabled();
  await expect(page.getByText("Worth 2 points")).toBeVisible();
  expect(await drawnWidth(page)).toBeLessThan(tight);

  // The right name shows the whole photo, inside the frame.
  await option(page, right).click();
  await expect(page.getByRole("heading", { name: /^Right/ })).toBeVisible();
  await expect(page.getByText(/^2 points, after 1 wrong\./)).toBeVisible();
  await expect(photo(page)).toHaveAttribute("data-stage", "whole");
  expect(await drawnWidth(page)).toBeLessThanOrEqual(frame.width + 1);
  const next = page.getByRole("button", { name: "Next photo" });
  await expect(next).toBeFocused();
  await inView(page, next);
  await next.click();

  // Three wrong names end a photo on nothing.
  await expect(page.getByText("Photo 2 of 5")).toBeVisible();
  ({ right, wrong } = await shown(page));
  for (const n of wrong) await option(page, n).click();
  await expect(page.getByRole("heading", { name: /^Out of tries/ })).toBeVisible();
  await next.click();

  // Right first time on the rest, from the keyboard.
  for (const i of [3, 4, 5]) {
    await expect(page.getByText(`Photo ${i} of 5`)).toBeVisible();
    ({ right } = await shown(page));
    await expect(option(page, right)).toBeEnabled();
    await page.keyboard.press(String(right));
    await page.keyboard.press("Enter");
  }

  await expect(page.getByRole("heading", { name: "11 of 15 points" })).toBeVisible();
  await expect(page.getByText("That's your new best!")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(5);
  await page.reload();
  await expect(page.getByText("Photo 1 of 5")).toBeVisible();
  await expect(page.locator("header dl")).toContainText("11");
  expect(errors).toEqual([]);
});

test("Close-up still deals when the photo can't be read for its busiest spot", async ({ page }) => {
  // Without a CORS header the small copy is refused, as it would be for a photo kept offline.
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
  await page.goto("./close-up");
  await expect(option(page, 4)).toBeEnabled();
  await expect(photo(page)).toHaveAttribute("data-stage", "0");
});

test("on a 320px phone the crop, the names and the answer stay on screen", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./close-up");
  const { right } = await shown(page);
  await expect(option(page, right)).toBeEnabled();
  const frame = (await page.getByTestId("close-frame").boundingBox())!;
  expect(frame.height).toBeGreaterThan(100);
  for (const n of [1, 2, 3, 4]) await inView(page, option(page, n));
  await option(page, right).click();
  const next = page.getByRole("button", { name: "Next photo" });
  await expect(next).toBeVisible();
  await inView(page, next);
  await expect((await page.getByTestId("close-frame").boundingBox())!.height).toBeGreaterThan(40);
});
