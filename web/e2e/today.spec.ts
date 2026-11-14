import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { TODAY_GAMES } from "../src/lib/game/today";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

/** The daily games dealt on `day`: a game joins Today from its own first day. */
const dealtOn = (day: string) => TODAY_GAMES.filter((g) => !g.since || g.since <= day).length;
const utcDay = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

test("Today lists every daily game from the Games menu, follows a real run, and shares the day", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const today = new Date().toISOString().slice(0, 10);

  // In from the Games menu of a round.
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  await page.getByRole("button", { name: "Games" }).click();
  await page
    .getByRole("dialog", { name: "Ways to play" })
    .getByRole("link", { name: /^Today/ })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(page.getByTestId("today-standing")).toContainText(
    new RegExp(`^0 of ${dealtOn(today)} played\\. The next deal is in \\d`),
  );
  const games = page.getByRole("list", { name: "Today's games" }).getByRole("listitem");
  await expect(games).toHaveCount(dealtOn(today));
  await expect(page.getByRole("button", { name: "Share your day" })).toHaveCount(0);

  // Fits a phone, whole.
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scroll).toBeLessThanOrEqual(page.viewportSize()!.width);

  // A real answer in today's Further North shows up when you come back.
  await page.getByTestId("today-further-north").click();
  await page.getByRole("button", { name: "Photo 1 is further north" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        (day) =>
          !!(
            JSON.parse(localStorage.getItem("whereabout:further-north-daily") ?? "{}") as Record<
              string,
              unknown
            >
          )[day],
        today,
      ),
    )
    .toBe(true);
  await page.goto("./today");
  await expect(page.getByTestId("today-further-north")).toHaveAttribute(
    "data-status",
    /^(going|done)$/,
  );

  // The other games' days, as each of them keeps them.
  await page.evaluate((day) => {
    localStorage.setItem("whereabout:daily-scores", JSON.stringify({ [day]: 18240 }));
    localStorage.setItem(
      "whereabout:further-north-daily",
      JSON.stringify({ [day]: { streak: 6, atlasRight: 3, atlasPlayed: 7, ended: "miss" } }),
    );
    localStorage.setItem(
      "whereabout:odd-one-out-daily",
      JSON.stringify({ [day]: { streak: 2, atlasRight: 1, atlasPlayed: 2, ended: null } }),
    );
  }, today);
  await page.reload();
  await expect(page.getByTestId("today-standing")).toContainText(`2 of ${dealtOn(today)} played`);
  await expect(page.getByTestId("today-daily-five")).toContainText("18,240 of 25,000");
  await expect(page.getByTestId("today-further-north")).toContainText("Atlas: 3 of 7");
  await expect(page.getByTestId("today-odd-one-out")).toHaveAttribute("data-status", "going");
  await expect(page.getByTestId("today-which-way")).toHaveAttribute("data-status", "new");

  // Atlas's day: Further North, which Atlas played all through, is yours; the Daily Five has no call.
  const rival = page.getByRole("region", { name: "Atlas's day" });
  await expect(rival.getByTestId("atlas-day-call")).toHaveText("You took the day from Atlas, 1–0.");
  await expect(rival.getByTestId("atlas-day-further-north")).toContainText("You 6 · Atlas 3 right");
  await expect(rival.getByTestId("atlas-day-uncalled")).toContainText("No call on Daily Five");
  const box = (await rival.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
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
  await page.getByRole("button", { name: "Share your day" }).click();
  await expect(page.getByText("Result copied. Paste it anywhere.")).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(sent).toContain(`Whereabout · Today · ${today}\n2 of ${dealtOn(today)} daily games\n`);
  expect(sent).toContain("🌍 Daily Five: 18,240 of 25,000\n");
  expect(sent).toContain(
    "⬆️ Further North: 6 pairs in a row\n🤖 You took the day from Atlas, 1–0\n",
  );
  expect(sent).not.toContain("Odd one out");
  expect(sent).toMatch(/\/whereabout\/today\/?$/);

  // A card opens that game's day.
  await page.getByTestId("today-how-far").click();
  await expect(page).toHaveURL(/\/how-far\/daily/);
  expect(errors).toEqual([]);
});

test("full days count up on a calendar that fits the screen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const before = (n: number) => utcDay(n * 86_400_000);
  await page.goto("./today");
  await expect(page.getByTestId("full-day-streak")).toContainText(
    `Finish all ${dealtOn(before(0))}`,
  );

  // The last two days finished, as each game keeps them, and the day before that partly.
  await page.evaluate(
    ({ full, partly }) => {
      const run = { streak: 3, atlasRight: 1, atlasPlayed: 2, ended: "miss" };
      const estimate = { km: 100, ratio: 1.5, points: 700, tooFar: false };
      const pair = { actualKm: 100, you: estimate, atlas: null };
      const pin = { at: { lng: 0, lat: 0 }, km: 10, bearing: 0, found: true };
      const hot = { id: "a", pins: [pin], atlas: null };
      const row = {
        order: ["a", "b", "c", "d"],
        east: ["a", "b", "c", "d"],
        right: [true, true, true, true],
        atlas: null,
      };
      const keep = (key: string, entry: unknown, also: string[] = []) =>
        localStorage.setItem(
          key,
          JSON.stringify(Object.fromEntries([...full, ...also].map((d) => [d, entry]))),
        );
      keep("whereabout:daily-scores", 18240);
      keep("whereabout:further-north-daily", run, [partly]);
      keep("whereabout:odd-one-out-daily", run, [partly]);
      keep("whereabout:which-way-daily", run);
      keep("whereabout:name-country-daily", run);
      keep("whereabout:left-right-daily", run);
      keep("whereabout:clue-mix-daily", run);
      keep("whereabout:how-far-daily", { results: Array(5).fill(pair) });
      keep("whereabout:hot-cold-daily", { results: Array(5).fill(hot), pins: [] });
      keep("whereabout:line-up-daily", { results: Array(5).fill(row) });
      const close = (id: string) => ({ id, wrong: [], atlas: null });
      keep("whereabout:close-up-daily", {
        results: ["a", "b", "c", "d", "e"].map(close),
        wrong: [],
      });
      const call = (id: string) => ({ id, picked: "Arid", truth: "Arid", atlas: null });
      keep("whereabout:which-climate-daily", { results: ["a", "b", "c", "d", "e"].map(call) });
    },
    { full: [before(1), before(2)], partly: before(3) },
  );
  await page.reload();
  await expect(page.getByTestId("full-day-streak")).toHaveText(
    `2 full days in a row. Finish today's ${dealtOn(before(0))} to make it 3.`,
  );
  await expect(page.getByTestId(`day-${before(1)}`)).toHaveAttribute(
    "data-done",
    String(dealtOn(before(1))),
  );
  await expect(page.getByTestId(`day-${before(1)}`)).toContainText("All");
  await expect(page.getByTestId(`day-${before(3)}`)).toHaveAttribute("data-done", "2");
  await expect(page.getByTestId(`day-${before(0)}`)).toHaveAttribute("aria-current", "date");

  // Seven columns inside the page, down to a 320px phone.
  for (const width of [page.viewportSize()!.width, 320]) {
    await page.setViewportSize({ width, height: 700 });
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scroll).toBeLessThanOrEqual(width);
    const cell = await page.getByTestId(`day-${before(1)}`).boundingBox();
    expect(cell!.width).toBeGreaterThanOrEqual(30);
  }
  expect(errors).toEqual([]);
});

test("the results screen leads to Today, already counting the game just finished", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("./?daily");
  for (let round = 1; round <= 5; round++) {
    const globe = page.getByRole("application", { name: /Globe/ });
    await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
    await globe.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Shift+ArrowRight");
    await page.getByRole("button", { name: "Guess here" }).click();
    await page.getByRole("button", { name: round < 5 ? "Next photo" : "See your results" }).click();
  }
  await expect(page.getByText("out of 25,000 points")).toBeVisible();

  const link = page.getByRole("link", { name: /^Today/ });
  await expect(link).toContainText(`1 of ${dealtOn(utcDay())} played`);
  await link.click();
  // The summary's globe is still working on a software renderer, so the page can take a while.
  await expect(page.getByTestId("today-daily-five")).toHaveAttribute("data-status", "done", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("today-daily-five")).toContainText(/[\d,]+ of 25,000/);
});
