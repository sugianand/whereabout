import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

// Bigger text, the way a player sets it: the browser's own text size (Chrome's Settings →
// Appearance → Font size, or a phone's accessibility text size), which every rem and em on the
// site follows, media queries included. 200% is the WCAG 1.4.4 bar, and 320px the narrowest
// phone still in use.
const WIDTH = 320;
const HEIGHT = 568;
const TEXT_PX = 32;

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

test.use({ viewport: { width: WIDTH, height: HEIGHT } });

test.beforeEach(async ({ page }) => {
  test.skip(test.info().project.name !== "phone", "a phone layout check, at a phone's width");
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

/** Sets the browser's text size and opens `address` with it. The setting takes on a page that
 *  is already open, and lasts across its later navigations; a screenshot resets it, so these
 *  tests take none and check it still holds at the end. */
async function openWithBigText(page: Page, address: string) {
  await page.goto(address);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.setFontSizes", {
    fontSizes: { standard: TEXT_PX, fixed: Math.round((TEXT_PX * 13) / 16) },
  });
  await expect.poll(() => rootTextPx(page)).toBe(TEXT_PX);
  await page.goto(address);
  expect(await rootTextPx(page)).toBe(TEXT_PX);
}

function rootTextPx(page: Page) {
  return page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b, `${locator} has a box`).not.toBeNull();
  return b!;
}

/** Every visible control inside `within` starts and ends on screen, and no two overlap. */
async function controlsFit(within: Locator, what: string) {
  const controls = within.locator("button:visible, a:visible, select:visible");
  expect(await controls.count(), `${what} has controls`).toBeGreaterThan(0);
  const boxes: { name: string; x: number; y: number; width: number; height: number }[] = [];
  for (const control of await controls.all()) {
    const b = await box(control);
    const name = `${what}: "${((await control.textContent()) ?? "").trim() || (await control.getAttribute("aria-label"))}"`;
    expect(b.x, `${name} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `${name} ends on screen`).toBeLessThanOrEqual(WIDTH + 0.5);
    for (const other of boxes) {
      const apart =
        b.x >= other.x + other.width - 0.5 ||
        other.x >= b.x + b.width - 0.5 ||
        b.y >= other.y + other.height - 0.5 ||
        other.y >= b.y + b.height - 0.5;
      expect(apart, `${name} clear of ${other.name}`).toBe(true);
    }
    boxes.push({ name, ...b });
  }
}

async function onScreen(locator: Locator, what: string) {
  const b = await box(locator);
  expect(b.y, `${what} starts on screen`).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height, `${what} ends on screen`).toBeLessThanOrEqual(HEIGHT + 0.5);
}

test("at 200% text on a 320px phone a round is one column: photo, header, globe, with Guess always on screen", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openWithBigText(page, "./");
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();

  // Nothing runs off the side.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    WIDTH,
  );

  // The header no longer floats over the photo: photo, then header, then globe, none overlapping.
  const stage = page.locator(".wb-stage");
  const photo = await box(stage.locator(".wb-photo"));
  const header = await box(stage.locator("header").first());
  const frame = await box(stage.locator(".wb-globe-frame"));
  expect(photo.y).toBeLessThanOrEqual(0.5);
  expect(photo.height, "the photo keeps a usable height").toBeGreaterThanOrEqual(200);
  expect(header.y, "the header starts below the photo").toBeGreaterThanOrEqual(
    photo.y + photo.height - 0.5,
  );
  expect(frame.y, "the globe starts below the header").toBeGreaterThanOrEqual(
    header.y + header.height - 0.5,
  );
  expect(frame.height, "the globe keeps a usable height").toBeGreaterThanOrEqual(240);

  // The guess button is on screen at the top of the page...
  const guess = page.getByRole("button", { name: "Place your pin on the globe" });
  await onScreen(guess, "the guess button at the top");
  await onScreen(page.getByRole("button", { name: /^Hint/ }), "the hint button at the top");

  // ...every header control is on screen, whole and clear of the others, when scrolled to...
  const headerLocator = stage.locator("header").first();
  await headerLocator.scrollIntoViewIfNeeded();
  await controlsFit(headerLocator, "header");
  await controlsFit(stage.locator(".wb-guess-bar"), "guess bar");
  // ...and none of them sits under the pinned guess bar.
  const bar = await box(stage.locator(".wb-guess-bar"));
  for (const control of await headerLocator
    .locator("button:visible, a:visible, select:visible")
    .all()) {
    await control.scrollIntoViewIfNeeded();
    const b = await box(control);
    const barNow = await box(stage.locator(".wb-guess-bar"));
    expect(
      b.y + b.height,
      `${await control.textContent()} clear of the guess bar`,
    ).toBeLessThanOrEqual(barNow.y + 0.5);
  }
  expect(bar.height, "the guess bar leaves most of the screen to the game").toBeLessThan(
    HEIGHT / 2,
  );

  // The globe's own buttons stay icon-sized inside the frame instead of growing over it.
  const globe = page.getByRole("application", { name: /Globe/ });
  await globe.scrollIntoViewIfNeeded();
  const zoomIn = await box(page.getByRole("button", { name: "Zoom in on the globe" }));
  expect(zoomIn.width).toBeLessThanOrEqual(44);
  expect(zoomIn.x + zoomIn.width).toBeLessThanOrEqual(frame.x + frame.width);

  // The Games menu still opens from the header.
  await headerLocator.getByRole("button", { name: "Games" }).click();
  const menu = page.getByRole("dialog", { name: "Ways to play" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  // A whole round plays: the pin goes down, Guess here is in reach at the bottom of the page
  // as at the top, and the answer comes.
  await globe.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByText(/^Your pin: /)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const here = page.getByRole("button", { name: "Guess here" });
  await onScreen(here, "Guess here at the bottom");
  const pinStatus = await box(page.locator("#globe-pin-status"));
  expect(
    pinStatus.x + pinStatus.width,
    "the pin's place stops short of the globe's buttons",
  ).toBeLessThanOrEqual(zoomIn.x + 0.5);
  await here.click();
  await expect(page.getByRole("region").filter({ hasText: "It was taken in" })).toBeVisible();

  expect(await rootTextPx(page), "the text size held for the whole test").toBe(TEXT_PX);
  expect(errors).toEqual([]);
});

test("at the default text size the same phone keeps the header over the photo", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  const header = page.locator(".wb-stage header").first();
  expect(await header.evaluate((el) => getComputedStyle(el).position)).toBe("absolute");
  // The column only starts where text outgrows the screen.
  expect(await page.evaluate(() => matchMedia("(max-width: 17.5em)").matches)).toBe(false);
});
