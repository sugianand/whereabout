import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG: { id: string; climateGroup?: string }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const GROUP = new Map(CATALOG.map((p) => [p.id, p.climateGroup]));
const GROUPS = ["Tropical", "Arid", "Temperate", "Continental", "Polar"];

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

async function groupOnScreen(page: Page) {
  const photo = page.getByTestId("climate-photo");
  await expect(photo).toHaveAttribute("data-photo", /.+/);
  const group = GROUP.get((await photo.getAttribute("data-photo"))!);
  expect(GROUPS).toContain(group);
  return group!;
}

const climateButton = (page: Page, group: string) => page.getByTestId(`climate-${group}`);

test("Which climate? plays five photos against Atlas, shows each on the climate band, and keeps the best", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./which-climate");
  await expect(page.getByText("Which climate? Name the Köppen group.")).toBeVisible();
  const { width, height } = page.viewportSize()!;
  // All five climates sit on screen, under a photo big enough to read.
  for (const group of GROUPS) {
    const button = climateButton(page, group);
    await expect(button).toBeEnabled();
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  }
  expect((await page.getByTestId("climate-photo").boundingBox())!.height).toBeGreaterThan(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );

  // Three right calls by tap, then two wrong ones.
  for (let n = 0; n < 5; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 5`, { exact: true })).toBeVisible();
    const truth = await groupOnScreen(page);
    const pick = n < 3 ? truth : truth === "Polar" ? "Arid" : "Polar";
    await climateButton(page, pick).click();
    const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
    await expect(card.getByRole("heading")).toHaveText(n < 3 ? "Correct" : "Wrong");
    const band = card.getByTestId("climate-band");
    await expect(band.locator("[aria-current='location']")).toHaveAttribute("data-group", truth);
    await expect(band.locator(`[data-group='${pick}']`)).toContainText("You");
    await expect(card).toContainText(/Atlas (read it as|said nothing)/);
    // The answer card fits the screen, with its button in reach.
    const box = (await card.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    await card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }).click();
  }

  await expect(page.getByRole("heading", { level: 1, name: "3 of 5" })).toBeVisible();
  await expect(page.getByTestId("climate-row")).toHaveCount(5);
  await expect(page.getByText("That's your new best!")).toBeVisible();

  // The best is kept, and the Games menu shows it beside the game's name.
  await page.reload();
  await expect(page.getByText("Best").locator("xpath=following-sibling::dd")).toHaveText("3");
  await page.getByRole("button", { name: "Games" }).click();
  await expect(page.getByTestId("best-which-climate")).toHaveText("Best: 3 of 5 right");
  expect(errors).toEqual([]);
});

test("today's Which climate? deals the day's five once, resumes after a reload, and shares the score", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const today = new Date().toISOString().slice(0, 10);

  // The free games link to today's game.
  await page.goto("./which-climate");
  await page.getByRole("link", { name: "Today's game" }).click();
  await expect(page.getByText(`today's game (${today})`)).toBeVisible();
  await expect(page.getByText("Best", { exact: true })).toHaveCount(0);
  const { width, height } = page.viewportSize()!;
  // The day's header still leaves the photo room and every climate in reach.
  expect((await page.getByTestId("climate-photo").boundingBox())!.height).toBeGreaterThan(200);
  for (const group of GROUPS) {
    const box = (await climateButton(page, group).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  }

  // Everyone on one day gets the same photos: a fresh player (nothing kept) is dealt the same.
  await groupOnScreen(page);
  const first = await page.getByTestId("climate-photo").getAttribute("data-photo");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("climate-photo")).toHaveAttribute("data-photo", first!);

  // A right call on the first photo, then a reload picks up at the second with the score so far.
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  await climateButton(page, await groupOnScreen(page)).click();
  await expect(card.getByRole("heading")).toHaveText("Correct");
  await page.reload();
  await expect(page.getByText("Photo 2 of 5", { exact: true })).toBeVisible();
  await expect(page.getByTestId("climate-photo")).not.toHaveAttribute("data-photo", first!);
  await expect(page.getByText("Score", { exact: true }).locator("+ dd")).toHaveText("1");

  // Two more right, then two wrong.
  for (let n = 1; n < 5; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 5`, { exact: true })).toBeVisible();
    const truth = await groupOnScreen(page);
    await climateButton(page, n < 3 ? truth : truth === "Polar" ? "Arid" : "Polar").click();
    await expect(card.getByRole("heading")).toHaveText(n < 3 ? "Correct" : "Wrong");
    await card.getByRole("button", { name: n === 4 ? "See today's result" : "Next photo" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "3 of 5" })).toBeVisible();
  await expect(page.getByTestId("climate-row")).toHaveCount(5);
  await expect(page.getByTestId("climate-row").first()).not.toContainText("Photo 1");

  // A reload shows the day's result, never the photos again.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "3 of 5" })).toBeVisible();
  await expect(page.getByText(/The next game is dealt in \d+/)).toBeVisible();
  await expect(page.getByTestId("climate-photo")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );

  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (t: string) => void ((window as unknown as { sent: string }).sent = t),
      },
      configurable: true,
    });
  });
  await page.getByRole("button", { name: "Share today's game" }).click();
  await expect(page.getByText("Result copied. Paste it anywhere.")).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(sent).toContain(`Whereabout · Which climate? · ${today}\n🌦️ 3 of 5\n🟩🟩🟩🟥🟥\n`);
  expect(sent).toMatch(/\/whereabout\/which-climate\/daily\/?$/);
  for (const group of GROUPS) expect(sent).not.toContain(group);

  // The free games' best is its own, and Your map counts the day in your clue reading.
  expect(await page.evaluate(() => localStorage.getItem("whereabout:which-climate-best"))).toBe(
    null,
  );
  expect(errors).toEqual([]);
});
