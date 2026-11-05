import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG: { id: string; lng: number; place: string }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const BY_ID = new Map(CATALOG.map((p) => [p.id, p]));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

const tile = (page: Page, n: number) => page.getByTestId(`line-photo-${n}`);
const lock = (page: Page) => page.getByRole("button", { name: "Lock it in" });

async function row(page: Page): Promise<string[]> {
  return Promise.all(
    [1, 2, 3, 4].map(async (n) => (await tile(page, n).getAttribute("data-photo"))!),
  );
}

const west = (a: string, b: string) => BY_ID.get(a)!.lng - BY_ID.get(b)!.lng;

/** Hold a tile by its middle and let go over the middle of another place. */
async function drag(page: Page, from: number, to: number) {
  const a = (await tile(page, from).boundingBox())!;
  const b = (await tile(page, to).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

test("Line them up plays five rows by drag and tap, against Atlas, and keeps the best", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./line-up");
  await expect(page.getByText("Line them up: west to east")).toBeVisible();
  const { width, height } = page.viewportSize()!;
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });

  // A drag lifts a photo into another place, and the rest close up, without counting as a tap.
  await expect(lock(page)).toBeEnabled();
  const before = await row(page);
  await drag(page, 1, 3);
  expect(await row(page)).toEqual([before[1], before[2], before[0], before[3]]);
  await expect(page.getByRole("status")).toHaveText(/^Tap two photos/);

  for (let i = 1; i <= 5; i++) {
    await expect(lock(page)).toBeEnabled();
    await expect(page.getByText(`Row ${i} of 5`, { exact: true })).toBeVisible();
    for (const n of [1, 2, 3, 4]) {
      const box = (await tile(page, n).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.height).toBeGreaterThan(80);
    }
    const lockBox = (await lock(page).boundingBox())!;
    expect(lockBox.y + lockBox.height).toBeLessThanOrEqual(height + 1);

    // Tap each photo to its place, west first.
    const want = [...(await row(page))].sort(west);
    for (let place = 0; place < want.length; place++) {
      const at = (await row(page)).indexOf(want[place]);
      if (at === place) continue;
      await tile(page, place + 1).getByRole("button", { name: /^Photo in place/ }).click();
      await expect(page.getByRole("status")).toHaveText("Now tap the place it goes.");
      await tile(page, at + 1).getByRole("button", { name: /^Photo in place/ }).click();
    }
    expect(await row(page)).toEqual(want);

    await lock(page).click();
    await expect(card.getByRole("heading")).toHaveText("All four in place");
    // The reveal names the places, in order, and every photo's credit.
    for (const [place, id] of want.entries()) {
      await expect(tile(page, place + 1)).toContainText(BY_ID.get(id)!.place);
      await expect(tile(page, place + 1).getByRole("link", { name: /^Photo: / })).toBeVisible();
    }
    const next = card.getByRole("button", { name: i < 5 ? "Next row" : "See your score" });
    await expect(next).toBeFocused();
    await expect(next).toBeInViewport();
    await page.keyboard.press("Enter");
  }

  await expect(page.getByRole("heading", { name: "20 in place" })).toBeVisible();
  await expect(page.getByText(/That's your new best!/)).toBeVisible();
  await expect(page.getByTestId("line-atlas-total")).toHaveText(/^Atlas: \d+ of \d+ in place\.$/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("whereabout:line-up-best")))
    .toBe("20");

  await page.getByRole("button", { name: "Play again" }).click();
  await expect(lock(page)).toBeEnabled();
  await expect(page.getByText("Row 1 of 5", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a photo can be looked at closer, and the row waits", async ({ page }) => {
  await page.goto("./line-up");
  await expect(lock(page)).toBeEnabled();
  const before = await row(page);
  await page.getByRole("button", { name: "Look closer at the photo in place 3" }).click();
  const dialog = page.getByRole("dialog", { name: "The photo, closer" });
  await expect(dialog.getByRole("button", { name: "Back to the row" })).toBeFocused();
  await expect(dialog.getByRole("link", { name: /^Photo: / })).toBeVisible();
  await dialog.getByRole("button", { name: "Back to the row" }).click();
  await expect(dialog).toBeHidden();
  expect(await row(page)).toEqual(before);
});

test("it is in the Games menu, with its best", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("whereabout:line-up-best", "13"));
  await page.goto("./");
  await page.getByRole("button", { name: "Games" }).click();
  const link = page.getByRole("link", { name: /^Line them up/ });
  await expect(link).toContainText("Best: 13 of 20 in place");
  await link.click();
  await expect(page).toHaveURL(/\/line-up\/?$/);
});

test("fits a 320px phone, placing and at the reveal", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./line-up");
  await expect(lock(page)).toBeEnabled();

  const title = (await page.getByRole("link", { name: "Whereabout" }).boundingBox())!;
  const score = (await page.getByText("Row 1 of 5", { exact: true }).boundingBox())!;
  expect(title.x + title.width).toBeLessThanOrEqual(score.x);
  await expect(lock(page)).toBeInViewport();

  const first = (await tile(page, 1).boundingBox())!;
  const last = (await tile(page, 4).boundingBox())!;
  expect(first.height).toBeGreaterThan(44);
  expect(last.y).toBeGreaterThan(first.y);
  await expect(page.getByRole("button", { name: /^Look closer/ }).first()).toBeInViewport();

  await lock(page).click();
  await expect(page.getByRole("button", { name: "Next row" })).toBeInViewport();
  for (const n of [1, 2, 3, 4]) {
    const box = (await tile(page, n).boundingBox())!;
    expect(box.height).toBeGreaterThan(44);
    await expect(tile(page, n).getByRole("link", { name: /^Photo: / })).toBeInViewport();
  }
  const scroll = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll[0]).toBeLessThanOrEqual(scroll[1]);
});
