import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { continentOf } from "../src/lib/continents";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG: { id: string; country: string; drivingSide?: string; climateGroup?: string }[] =
  JSON.parse(readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"));
const BY_ID = new Map(CATALOG.map((p) => [p.id, p]));
const GUESSED: Record<string, unknown> = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/atlas.json"), "utf8"),
).guesses;
// The continents the deck holds a playable photo from, one button each.
const CONTINENT_BUTTONS = new Set(
  CATALOG.filter((p) => p.id in GUESSED).map((p) => continentOf(p.country)),
).size;

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

/** The clue the photo on screen asks, and its answer from the catalog. */
async function stepOnScreen(page: Page) {
  const photo = page.getByTestId("clue-photo");
  await expect(photo).toHaveAttribute("data-photo", /.+/);
  const clue = (await photo.getAttribute("data-clue"))!;
  const p = BY_ID.get((await photo.getAttribute("data-photo"))!)!;
  const truth =
    clue === "road" ? p.drivingSide : clue === "climate" ? p.climateGroup : continentOf(p.country);
  expect(truth, `photo ${p.id} answers ${clue}`).toBeTruthy();
  return { clue, truth: truth! };
}

test("Clue mix asks the road, the climate and the continent in turn until the first miss", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./clue-mix");
  const { width, height } = page.viewportSize()!;
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  const question = page.getByTestId("clue-question");

  const asked: string[] = [];
  for (const [n, expected] of (["road", "climate", "continent", "road"] as const).entries()) {
    const { clue, truth } = await stepOnScreen(page);
    expect(clue).toBe(expected);
    asked.push(await question.innerText());
    await expect(page.getByRole("listitem").and(page.locator('[aria-current="step"]'))).toHaveText(
      clue === "road" ? "Road" : clue === "climate" ? "Climate" : "Continent",
    );
    // Every answer button is on screen, none off the edge or below the fold.
    const buttons = page.getByRole("group").getByRole("button");
    expect(await buttons.count()).toBe(
      clue === "road" ? 2 : clue === "climate" ? 5 : CONTINENT_BUTTONS,
    );
    for (const b of await buttons.all()) {
      await expect(b).toBeEnabled();
      const box = (await b.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    }
    await page.getByTestId(`clue-${truth}`).click();
    await expect(card.getByRole("heading")).toHaveText("Correct");
    await expect(card).toContainText(/Atlas/);
    await expect(
      page.getByText("Streak", { exact: true }).locator("xpath=following-sibling::dd[1]"),
    ).toHaveText(String(n + 1));
    const box = (await card.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    await card.getByRole("button", { name: "Next photo" }).click();
    await expect(card).toBeHidden();
  }
  expect(asked).toEqual([
    "Which side of the road do they drive on?",
    "Which climate is it?",
    "Which continent is it on?",
    "Which side of the road do they drive on?",
  ]);

  // A wrong call ends the run, and the best is kept for the next visit.
  const { truth } = await stepOnScreen(page);
  const wrong = page
    .getByRole("group")
    .getByRole("button")
    .and(page.locator(`:not([data-testid="clue-${truth}"])`))
    .first();
  await wrong.click();
  await expect(card.getByRole("heading")).toHaveText("Wrong");
  await expect(card).toContainText("Run over: 4 clues in a row. That's your new best!");
  await card.getByRole("button", { name: "Start a new run" }).click();
  await expect(card).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("whereabout:clue-mix-best"))).toBe("4");

  await page.reload();
  await expect(
    page.getByText("Best", { exact: true }).locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("4");
  await page.getByRole("button", { name: "Games" }).click();
  await expect(page.getByTestId("best-clue-mix")).toHaveText("Best: 4 in a row");
  expect(errors).toEqual([]);
});

test("a 320px phone fits every continent and the answer without scrolling sideways", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("./clue-mix");
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  for (let n = 0; n < 3; n++) {
    const { truth } = await stepOnScreen(page);
    for (const b of await page.getByRole("group").getByRole("button").all()) {
      const box = (await b.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(321);
      expect(box.y + box.height).toBeLessThanOrEqual(641);
    }
    // The photo keeps a usable share of the screen above the buttons.
    expect((await page.getByTestId("clue-photo").boundingBox())!.height).toBeGreaterThan(160);
    await page.getByTestId(`clue-${truth}`).click();
    const box = (await card.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(321);
    expect(box.y + box.height).toBeLessThanOrEqual(641);
    await card.getByRole("button", { name: "Next photo" }).click();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const games = (await page.getByRole("button", { name: "Games" }).boundingBox())!;
  expect(games.x + games.width).toBeLessThanOrEqual(320);
});
