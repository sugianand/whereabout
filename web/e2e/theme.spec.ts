import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

// The site's colours follow the device's light or dark setting until the player picks one in the
// Games menu; the pick is kept in this browser and is on the page before it first paints. The
// globe follows it, painted as a daylight chart on a light page, and so does the stage around it
// (its panel, frame, reveal card and the header over the globe), while words over the photo keep
// the night chart's dark scrim in both.

const NIGHT = "rgb(13, 51, 70)"; // ocean, the night page
const DAY = "rgb(233, 240, 238)"; // ocean, the daylight page

const pageColour = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

/** How bright the globe's canvas looks on screen, 0 (black) to 1 (white), on average. */
async function globeBrightness(page: Page): Promise<number> {
  const globe = page.locator(".globe[data-ready]");
  await expect(globe).toBeVisible();
  // A frame or two for MapLibre to paint after a change.
  await page.waitForTimeout(400);
  const png = (await globe.screenshot({ animations: "disabled" })).toString("base64");
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const { data: px } = ctx.getImageData(0, 0, img.width, img.height);
    let sum = 0;
    for (let i = 0; i < px.length; i += 4)
      sum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    return sum / (px.length / 4);
  }, png);
}

async function pickColours(page: Page, name: "Auto" | "Light" | "Dark") {
  await page.getByRole("button", { name: "Games" }).click();
  const menu = page.getByRole("dialog");
  await menu.getByRole("group", { name: "Colours" }).getByRole("button", { name }).click();
  await expect(
    menu.getByRole("group", { name: "Colours" }).getByRole("button", { name }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
}

test.describe("on a device set to dark", () => {
  test.use({ colorScheme: "dark" });

  test("a light pick applies at once, is kept, and is there before the page first paints", async ({
    page,
  }) => {
    await page.goto("./today");
    expect(await pageColour(page)).toBe(NIGHT);

    await pickColours(page, "Light");
    expect(await pageColour(page)).toBe(DAY);
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute(
      "content",
      "#e9f0ee",
    );

    // On a reload, the head script sets the theme before any of the page's own scripts run.
    await page.addInitScript(() => {
      document.addEventListener("readystatechange", () => {
        if (document.readyState === "interactive") {
          (window as unknown as { themeAtParse: string | undefined }).themeAtParse =
            document.documentElement.dataset.theme;
        }
      });
    });
    await page.reload();
    expect(
      await page.evaluate(() => (window as unknown as { themeAtParse: string }).themeAtParse),
    ).toBe("light");
    expect(await pageColour(page)).toBe(DAY);

    // Another page keeps it too; Auto goes back to the device's dark.
    await page.goto("./stamps");
    expect(await pageColour(page)).toBe(DAY);
    await pickColours(page, "Auto");
    expect(await pageColour(page)).toBe(NIGHT);
    expect(await page.evaluate(() => localStorage.getItem("whereabout:theme"))).toBeNull();
  });
});

test.describe("on a device set to light", () => {
  test.use({ colorScheme: "light" });

  test("the globe is a daylight chart, and the Colours switch repaints it mid-game", async ({
    page,
  }) => {
    await page.goto("./");
    const globe = page.locator(".globe");
    await expect(globe).toHaveAttribute("data-light", "day");
    const day = await globeBrightness(page);
    expect(day).toBeGreaterThan(0.55);
    // Pins drawn over it take the globe's own daylight marks.
    expect(
      await globe.evaluate((el) => getComputedStyle(el).getPropertyValue("--color-flare").trim()),
    ).toBe("#8a002f");

    // Place a pin, then switch to Dark from the Games menu: same game, same pin, night chart.
    await globe.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".globe-pin")).toHaveCount(1);
    await pickColours(page, "Dark");
    await expect(globe).toHaveAttribute("data-light", "night");
    expect(await globeBrightness(page)).toBeLessThan(0.3);
    await expect(page.locator(".globe-pin")).toHaveCount(1);
    await expect(page.getByText(/^Your pin: /)).toBeVisible();

    await pickColours(page, "Auto");
    await expect(globe).toHaveAttribute("data-light", "day");
    expect(await globeBrightness(page)).toBeGreaterThan(0.55);
  });

  test("the site follows it, a dark pick holds, and words on a photo keep night chalk", async ({
    page,
  }) => {
    await page.goto("./today");
    expect(await pageColour(page)).toBe(DAY);

    await page.goto("./");
    await expect(page.locator(".wb-stage")).toBeVisible();
    // The Games menu opens over the stage in the page's own colours.
    await page.getByRole("button", { name: "Games" }).click();
    const sheet = page.getByRole("dialog");
    expect(await sheet.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(251, 252, 251)",
    );
    await page.keyboard.press("Escape");

    // Words on a quick game's photo tile keep night chalk, not the page's daylight ink.
    await page.goto("./further-north");
    const badge = page.locator(".wb-night span").filter({ hasText: /^1$/ }).first();
    await expect(badge).toBeVisible();
    expect(await badge.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(238, 244, 242)");

    await pickColours(page, "Dark");
    expect(await pageColour(page)).toBe(NIGHT);
    await page.goto("./map");
    expect(await pageColour(page)).toBe(NIGHT);
  });
});

const NIGHT_CHALK = "rgb(238, 244, 242)";
const DAY_INK = "rgb(13, 43, 56)";
const PAPER = "rgb(251, 252, 251)"; // ocean-deep by day

const colourOf = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).color);
const groundOf = (locator: Locator) =>
  locator.evaluate((el) => getComputedStyle(el).backgroundColor);

test.describe("the globe stage on a device set to light", () => {
  test.use({ colorScheme: "light" });

  test.beforeEach(async ({ page }) => {
    await page.route(/wikimedia\.org/, (route) =>
      route.fulfill({ body: PHOTO, contentType: "image/png" }),
    );
  });

  test("the panel, frame and reveal card are daylight, words on the photo stay night, and Dark turns it all back", async ({
    page,
    isMobile,
  }) => {
    await page.goto("./");
    const stage = page.locator(".wb-stage");
    await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
    await expect(page.locator(".globe")).toHaveAttribute("data-light", "day");

    // The stage and the globe's panel are the daylight page; the frame's edge is the day graticule.
    expect(await groundOf(stage)).toBe(PAPER);
    expect(await colourOf(stage)).toBe(DAY_INK);
    expect(
      await page.locator(".wb-globe-frame").evaluate((el) => getComputedStyle(el).borderTopColor),
    ).toMatch(/^(rgba\(125, 154, 163|color\(srgb 0\.49)/);

    // Over the photo: the header, the credit and the zoom button keep night chalk on a dark scrim.
    const header = page.locator(".wb-header");
    expect(await colourOf(header)).toBe(NIGHT_CHALK);
    expect(await header.evaluate((el) => getComputedStyle(el).backgroundImage)).toMatch(
      /rgba\(8, 35, 49, 0\.85\)|srgb 0\.031/,
    );
    const zoom = page.getByRole("button", { name: "Zoom in on the photo" });
    expect(await colourOf(zoom)).toBe(NIGHT_CHALK);

    // The pin button sits on the panel's daylight ground on a phone, over the photo on a desktop.
    const bar = page.locator(".wb-guess-bar");
    expect(await colourOf(bar)).toBe(isMobile ? DAY_INK : NIGHT_CHALK);

    // The reveal: the card and the header over the full-screen globe are daylight.
    await page.getByRole("application", { name: /Globe/ }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Guess here" }).click();
    const card = page.getByRole("region").filter({ hasText: "It was taken in" });
    await expect(card).toBeVisible();
    expect(await colourOf(card)).toBe(DAY_INK);
    expect(await colourOf(card.getByText("It was taken in"))).toBe("rgb(122, 78, 0)");
    expect(await colourOf(header)).toBe(DAY_INK);

    // Dark from the Games menu at the reveal: the same card, on the night chart again.
    await pickColours(page, "Dark");
    await expect(card).toBeVisible();
    expect(await colourOf(card)).toBe(NIGHT_CHALK);
    expect(await groundOf(stage)).toBe("rgb(8, 35, 49)");
    await expect(page.locator(".globe")).toHaveAttribute("data-light", "night");
  });
});

/**
 * The colour MapLibre drew a little off the middle of a globe, clear of any mark: the sea or land
 * under it. Only a few pixels are captured, since a whole-globe screenshot on a busy CI runner can
 * take longer than a poll waits.
 */
async function globeCentre(page: Page, testId: string): Promise<number[]> {
  const globe = page.getByTestId(testId);
  await globe.scrollIntoViewIfNeeded();
  const box = (await globe.boundingBox())!;
  const x = Math.round(box.x + box.width * 0.42);
  const y = Math.round(box.y + box.height * 0.58);
  const png = (await page.screenshot({ clip: { x, y, width: 2, height: 2 } })).toString("base64");
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }, png);
}

const brightness = ([r, g, b]: number[]) => (r + g + b) / 3;

test.describe("Your map's globe", () => {
  test.use({ colorScheme: "light" });

  test("paints by day on a light device and turns to night with it, in place", async ({ page }) => {
    const history = [8, 400, 6000].map((km, i) => ({
      id: `seed-${i}`,
      lng: 30 * i,
      lat: 20,
      place: `Seeded place ${i}`,
      country: "FR",
      km,
      score: 3000,
      day: "2026-11-01",
    }));
    await page.addInitScript(
      (h) => localStorage.setItem("whereabout:played", h),
      JSON.stringify(history),
    );
    await page.goto("./map/");
    const globe = page.getByTestId("played-globe");
    await expect(globe).toHaveAttribute("data-dots", "3");
    await expect(globe).toHaveAttribute("data-light", "day");
    // A pale sea or land, where the night chart is a deep blue-green.
    const centre = async () => brightness(await globeCentre(page, "played-globe"));
    // MapLibre draws in software on CI, a frame at a time, so give it time.
    await expect.poll(centre, { timeout: 30_000 }).toBeGreaterThan(180);
    const legendFill = () =>
      page.getByRole("list", { name: "Closeness" }).locator("circle").first().getAttribute("fill");
    expect(await legendFill()).toBe("#8d5e03");

    // The phone turns dark at sunset while the page is open (Colours on Auto).
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(globe).toHaveAttribute("data-light", "night");
    await expect.poll(centre, { timeout: 30_000 }).toBeLessThan(110);
    expect(await legendFill()).toBe("#ffc53d");
    // Repainted, not rebuilt: the marks are still on the globe.
    await expect(globe).toHaveAttribute("data-dots", "3");
  });
});
