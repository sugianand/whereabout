import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { continentOf } from "../src/lib/continents";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG: { id: string; country: string; place: string }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const BY_ID = new Map(CATALOG.map((p) => [p.id, p]));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

const option = (page: Page, n: number) => page.getByTestId(`name-option-${n}`);

async function shown(page: Page) {
  await expect(option(page, 4)).toBeEnabled();
  const id = (await page.locator("main").getAttribute("data-photo"))!;
  const names = await Promise.all(
    [1, 2, 3, 4].map(async (n) => (await option(page, n).getAttribute("data-country"))!),
  );
  return { photo: BY_ID.get(id)!, names };
}

test("Name the country deals a photo and four names until the first miss, and keeps the best", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./name-country");
  await expect(page.getByText("Name the country: which of these four?")).toBeVisible();
  const { width, height } = page.viewportSize()!;

  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });

  for (let streak = 1; streak <= 2; streak++) {
    const { photo, names } = await shown(page);
    // The four are the truth and three more from its continent, and all fit on screen.
    expect(new Set(names).size).toBe(4);
    expect(names).toContain(photo.country);
    for (const code of names) expect(continentOf(code)).toBe(continentOf(photo.country));
    for (const n of [1, 2, 3, 4]) {
      const box = (await option(page, n).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const photoBox = (await page.getByTestId("name-photo").boundingBox())!;
    expect(photoBox.height).toBeGreaterThan(150);

    await option(page, names.indexOf(photo.country) + 1).click();
    await expect(card.getByRole("heading")).toHaveText(/^Right: /);
    await expect(card).toContainText(`${photo.place}, ${continentOf(photo.country)}`);
    await expect(page.getByText("Streak", { exact: true }).locator("+ dd")).toHaveText(
      String(streak),
    );

    // The answer and its button stay on screen with the names and some of the photo.
    const next = card.getByRole("button", { name: "Next photo" });
    await expect(next).toBeFocused();
    const button = (await next.boundingBox())!;
    expect(button.y + button.height).toBeLessThanOrEqual(height + 1);
    expect((await page.getByTestId("name-photo").boundingBox())!.height).toBeGreaterThan(60);

    await page.keyboard.press("Enter");
    await expect(card).toHaveCount(0);
  }

  // A wrong answer from the keyboard ends the run.
  const { photo, names } = await shown(page);
  const wrong = names.findIndex((c) => c !== photo.country);
  await page.keyboard.press(String(wrong + 1));
  await expect(card.getByRole("heading")).toHaveText(/^Wrong: /);
  await expect(card).toContainText("Run over: 2 countries in a row. That's your new best!");

  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("whereabout:name-country-best")))
    .toBe("2");

  await card.getByRole("button", { name: "Start a new run" }).click();
  await expect(card).toHaveCount(0);
  await expect(option(page, 4)).toBeEnabled();
  await expect(page.getByText("Streak", { exact: true }).locator("+ dd")).toHaveText("0");
  expect(errors).toEqual([]);
});

test("fits a 320px phone from the Games menu to the answer", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./");
  await page.getByRole("button", { name: "Games" }).click();
  await page.getByRole("link", { name: /^Name the country/ }).click();
  await expect(page).toHaveURL(/\/name-country\/?$/);

  const { photo, names } = await shown(page);
  // The site's name and the header's controls never run into each other.
  const title = (await page.getByRole("link", { name: "Whereabout" }).boundingBox())!;
  const games = (await page.getByRole("button", { name: "Games" }).boundingBox())!;
  const streak = (await page.getByText("Streak", { exact: true }).boundingBox())!;
  expect(title.x + title.width).toBeLessThanOrEqual(streak.x);
  expect(games.y).toBeGreaterThanOrEqual(title.y + title.height);

  await option(page, names.indexOf(photo.country) + 1).click();
  const next = page.getByRole("button", { name: "Next photo" });
  await expect(next).toBeInViewport();
  const scroll = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll[0]).toBeLessThanOrEqual(scroll[1]);
});
