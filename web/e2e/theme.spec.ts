import { expect, test, type Page } from "@playwright/test";

// The site's colours follow the device's light or dark setting until the player picks one in the
// Games menu; the pick is kept in this browser and is on the page before it first paints. The
// globe follows it, painted as a daylight chart on a light page; the globe stages' panels keep
// the night chart in both.

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

  test("the site follows it, a dark pick holds, and the globe stage keeps the night chart", async ({
    page,
  }) => {
    await page.goto("./today");
    expect(await pageColour(page)).toBe(DAY);

    await page.goto("./");
    const stage = page.locator(".wb-stage");
    await expect(stage).toBeVisible();
    expect(await stage.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(8, 35, 49)",
    );
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
