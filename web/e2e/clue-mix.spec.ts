import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { continentOf } from "../src/lib/continents";
import { TODAY_GAMES } from "../src/lib/game/today";

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

test("today's Clue mix deals the day's steps once, resumes after a reload, and shares as counts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const today = new Date().toISOString().slice(0, 10);
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  const streak = page
    .getByText("Streak", { exact: true })
    .locator("xpath=following-sibling::dd[1]");

  // The free runs link to today's run.
  await page.goto("./clue-mix");
  await page.getByRole("link", { name: "Today's run" }).click();
  await expect(page.getByText(`Clue mix, today's run (${today}).`)).toBeVisible();
  await expect(page.getByText("Best", { exact: true })).toHaveCount(0);
  const { width, height } = page.viewportSize()!;

  // Everyone on one day gets the same photos: a fresh player (nothing kept) is dealt the same.
  await stepOnScreen(page);
  const first = await page.getByTestId("clue-photo").getAttribute("data-photo");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("clue-photo")).toHaveAttribute("data-photo", first!);

  // Right on the road, a reload picks up at the climate with the streak so far.
  const road = await stepOnScreen(page);
  expect(road.clue).toBe("road");
  await page.getByTestId(`clue-${road.truth}`).click();
  await expect(card.getByRole("heading")).toHaveText("Correct");
  await page.reload();
  await expect(page.getByTestId("clue-photo")).toHaveAttribute("data-clue", "climate");
  await expect(page.getByTestId("clue-photo")).not.toHaveAttribute("data-photo", first!);
  await expect(streak).toHaveText("1");

  // Then a wrong climate ends the day, with a share where a new run would be.
  const { truth } = await stepOnScreen(page);
  await page
    .getByRole("group")
    .getByRole("button")
    .and(page.locator(`:not([data-testid="clue-${truth}"])`))
    .first()
    .click();
  await expect(card.getByRole("heading")).toHaveText("Wrong");
  await expect(card).toContainText("Today's run is over: 1 clue in a row, out on the climate.");
  await expect(card.getByRole("button", { name: "Start a new run" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Share today's run" })).toBeVisible();
  const box = (await card.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);

  // A reload shows the day's result, never the photos again.
  await page.reload();
  await expect(page.getByRole("heading", { name: "1 clue in a row" })).toBeVisible();
  await expect(page.getByText(/The next run is dealt in \d+/)).toBeVisible();
  await expect(page.getByTestId("clue-photo")).toHaveCount(0);

  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (t: string) => void ((window as unknown as { sent: string }).sent = t),
      },
      configurable: true,
    });
  });
  await page.getByRole("button", { name: "Share today's run" }).click();
  await expect(page.getByText("Result copied. Paste it anywhere.")).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(sent).toContain(
    `Whereabout · Clue mix · ${today}\n🔀 1 clue in a row, out on the climate\n🛣️🌦️🌍\n🟩🟥\n`,
  );
  expect(sent).toMatch(/\/whereabout\/clue-mix\/daily\/?$/);
  expect(await page.evaluate(() => localStorage.getItem("whereabout:clue-mix-best"))).toBe(null);

  // Today lists it from its first day, finished.
  const since = TODAY_GAMES.find((g) => g.id === "clue-mix")!.since!;
  await page.goto("./today");
  await expect(page.getByTestId("today-clue-mix")).toHaveCount(today >= since ? 1 : 0);
  if (today >= since) {
    await expect(page.getByTestId("today-clue-mix")).toHaveAttribute("data-status", "done");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
  expect(errors).toEqual([]);
});

test("a challenge link deals a friend the same steps, with the run to beat and the answer that ended it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (t: string) => void ((window as unknown as { sent: string }).sent = t),
      },
      configurable: true,
    });
  });
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  const sent = () => page.evaluate(() => (window as unknown as { sent: string }).sent);
  const shownId = () => page.getByTestId("clue-photo").getAttribute("data-photo");

  // The sender reads the road and the climate, then names the wrong continent.
  await page.goto("./clue-mix");
  const run: string[] = [];
  let said = "";
  for (let i = 0; i < 3; i++) {
    const { truth } = await stepOnScreen(page);
    run.push((await shownId())!);
    await expect(page.getByTestId(`clue-${truth}`)).toBeEnabled();
    if (i < 2) {
      await page.getByTestId(`clue-${truth}`).click();
      await card.getByRole("button", { name: "Next photo" }).click();
    } else {
      const wrong = page
        .getByRole("group")
        .getByRole("button")
        .and(page.locator(`:not([data-testid="clue-${truth}"])`))
        .first();
      said = (await wrong.innerText()).trim();
      await wrong.click();
    }
  }
  await expect(card).toContainText("Run over: 2 clues in a row.");
  const challengeButton = card.getByRole("button", { name: "Challenge a friend" });
  await expect(challengeButton).toBeInViewport();
  await challengeButton.click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const message = await sent();
  expect(message).toContain("I read 2 clues in a row.");
  expect(message).not.toContain(said);
  const link = message.split("\n").at(-1)!;
  expect(link).toMatch(
    new RegExp(`/whereabout/clue-mix/?\\?challenge=${run.join("\\.")}_[0-9a-z]+_2_[a-z]{2}$`),
  );

  // The friend, with nothing kept, gets the same steps and reads them all right.
  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  await expect(page.getByText("A friend's challenge: 2 clues in a row to beat")).toBeVisible();
  for (let i = 0; i < run.length; i++) {
    await expect(page.getByTestId("clue-photo")).toHaveAttribute("data-photo", run[i]);
    const { clue, truth } = await stepOnScreen(page);
    expect(clue).toBe(["road", "climate", "continent"][i]);
    await expect(page.getByText(/Your friend's run ended here/)).toHaveCount(0);
    await expect(page.getByTestId(`clue-${truth}`)).toBeEnabled();
    await page.getByTestId(`clue-${truth}`).click();
    if (i === 2) {
      await expect(card).toContainText("That beats your friend's 2 in a row!");
      await expect(card).toContainText(`Your friend's run ended here: they said ${said}.`);
    } else {
      await expect(card).not.toContainText("Your friend's run ended here");
    }
    await card.getByRole("button", { name: "Next photo" }).click();
  }

  // Past the friend's steps, the road again on a new photo; miss it.
  const { clue, truth } = await stepOnScreen(page);
  expect(clue).toBe("road");
  expect(run).not.toContain(await shownId());
  await expect(page.getByTestId(`clue-${truth}`)).toBeEnabled();
  await page.getByTestId(`clue-${truth === "left" ? "right" : "left"}`).click();
  await expect(card).toContainText(
    "Run over: 3 clues in a row. You beat your friend's 2 in a row by 1.",
  );
  const { width, height } = page.viewportSize()!;
  const box = (await card.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  expect(await page.evaluate(() => localStorage.getItem("whereabout:clue-mix-best"))).toBe(null);

  const back = card.getByRole("button", { name: "Send yours back" });
  await expect(back).toBeInViewport();
  await back.click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const reply = await sent();
  expect(reply).toContain("That beats your 2. Your turn to read the clues.");
  expect(reply).toMatch(/_3_[lr]$/);

  // Head to head: both runs drawn as a 1080px picture, saved, with the reply link copied.
  await page.evaluate(() => ((window as unknown as { sent: string }).sent = ""));
  const picture = card.getByRole("button", { name: "Share head to head" });
  await expect(picture).toBeInViewport({ ratio: 1 });
  const [download] = await Promise.all([page.waitForEvent("download"), picture.click()]);
  expect(download.suggestedFilename()).toBe("whereabout-clue-mix-head-to-head.png");
  const png = readFileSync((await download.path())!);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1080]);
  expect(await sent()).toBe(reply);
  const kept = await page.evaluate(() => localStorage.getItem("whereabout:head-to-head"));
  expect(JSON.parse(kept!)).toEqual([
    expect.objectContaining({ game: "Clue mix", outcome: "won", you: "3 in a row" }),
  ]);

  // A fresh run drops the link, so a reload doesn't deal the challenge again.
  await card.getByRole("button", { name: "Play a fresh run" }).click();
  await expect(page.getByText("Clue mix: a new clue each photo.")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(errors).toEqual([]);
});

test("a broken Clue mix challenge says so and deals a fresh run", async ({ page }) => {
  await page.goto("./clue-mix?challenge=wm001_3_9");
  await expect(page.getByText(/That challenge link was cut short/)).toBeVisible();
  await expect(page.getByText("Clue mix: a new clue each photo.")).toBeVisible();
  await expect(page.getByTestId("clue-left")).toBeEnabled();
});

test("the end of a Clue mix run keeps both its buttons on a 320px phone", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./clue-mix");
  const { truth } = await stepOnScreen(page);
  await expect(page.getByTestId(`clue-${truth}`)).toBeEnabled();
  await page.getByTestId(`clue-${truth === "left" ? "right" : "left"}`).click();
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  for (const name of ["Start a new run", "Challenge a friend"]) {
    await expect(card.getByRole("button", { name })).toBeInViewport({ ratio: 1 });
  }
  const scroll = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll[0]).toBeLessThanOrEqual(scroll[1]);
});
