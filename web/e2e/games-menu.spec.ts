import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

// The real photos are hot-linked from Wikimedia; serve a local stand-in instead.
const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

/** Opens the Games menu and checks the whole sheet sits on screen. */
async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Games" }).click();
  const sheet = page.getByRole("dialog", { name: "Ways to play" });
  await expect(sheet).toBeVisible();
  const box = (await sheet.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  return sheet;
}

test("every way to play is one menu away from round one and from each quick game", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./");
  await page.evaluate(() => localStorage.setItem("whereabout:odd-one-out-best", "4"));
  await page.reload();
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();

  // Round one, before any game is finished, already lists every mode with its best.
  let sheet = await openMenu(page);
  for (const name of [
    "Five rounds",
    "Blitz",
    "Country Streak",
    "Survival",
    "Further North",
    "Odd one out",
    "Pass and play",
  ]) {
    await expect(sheet.getByText(new RegExp(`^${name}`)).first()).toBeVisible();
  }
  await expect(sheet.getByText("Best: 4 in a row")).toBeVisible();

  // Esc closes it with the round untouched, and keys pressed in it never reach the round.
  await page.keyboard.press("h");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: "Games" })).toBeFocused();
  await expect(page.getByRole("list", { name: "Hints" })).toHaveCount(0);

  sheet = await openMenu(page);
  await sheet.getByRole("link", { name: /^Odd one out/ }).click();
  await expect(page).toHaveURL(/\/odd-one-out\/?$/);

  // From a quick game the menu marks it, and leads on to the next one.
  sheet = await openMenu(page);
  await expect(sheet.locator('[aria-current="page"]')).toContainText("Odd one out");
  await expect(sheet.getByRole("link", { name: /^Odd one out/ })).toHaveCount(0);
  await sheet.getByRole("link", { name: /^Further North/ }).click();
  await expect(page).toHaveURL(/\/further-north\/?$/);

  // Blitz from another page opens the five-round game timed.
  sheet = await openMenu(page);
  await sheet.getByRole("link", { name: /^Blitz/ }).click();
  await expect(page).toHaveURL(/\/\?blitz$/);
  await expect(page.getByTestId("blitz-clock")).toBeVisible();

  // And from a Blitz, "Five rounds" deals an untimed game on the spot.
  sheet = await openMenu(page);
  await sheet.getByRole("button", { name: /^Five rounds/ }).click();
  await expect(page).not.toHaveURL(/blitz/);
  await expect(page.getByTestId("blitz-clock")).toHaveCount(0);
  await expect(page.getByText(/^Round 1 of 5$/)).toBeVisible();

  expect(errors).toEqual([]);
});

test("on a 360px phone the Games button fits every quick game's header", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 360, height: 740 });
  for (const address of ["./survival", "./streak", "./further-north", "./odd-one-out"]) {
    await page.goto(address);
    const games = page.getByRole("button", { name: "Games" });
    await expect(games).toBeVisible();
    const box = (await games.boundingBox())!;
    expect(box.x, `${address} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${address} ends on screen`).toBeLessThanOrEqual(360);
  }
});

test("at the reveal the header's controls stay in reach above the card", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 768, "phones keep the card in the lower half");
  await page.goto("./?daily");
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  await page.getByRole("application", { name: /Globe/ }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Guess here" }).click();
  const card = page.getByRole("region").filter({ hasText: "It was taken in" });
  await expect(card).toBeVisible();
  // Let the card finish rising before measuring it.
  await page.waitForTimeout(1_600);

  const header = page.locator("header").first();
  const controls = header.locator("button:visible, select:visible");
  expect(await controls.count()).toBeGreaterThan(0);
  for (const control of await controls.all()) {
    // Nothing lies over the middle of the control: a tap there reaches it.
    const reachable = await control.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit !== null && el.contains(hit);
    });
    expect(reachable, `"${(await control.textContent())?.trim()}" stays clear of the card`).toBe(
      true,
    );
  }
  await page.getByRole("button", { name: "Sound and vibration at the reveal" }).click();
  await page.getByRole("button", { name: "Games" }).click();
  await expect(page.getByRole("dialog", { name: "Ways to play" })).toBeVisible();
});
