import { expect, test } from "@playwright/test";

const pin = (id: string, country: string, km: number) => ({
  id,
  lng: 0,
  lat: 0,
  place: "Somewhere",
  country,
  km,
  score: 3000,
  day: new Date().toISOString().slice(0, 10),
});

test("stamps come from what the browser keeps, are marked new once, and fit a 320px phone", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Today leads to the stamps.
  await page.goto("./today");
  await page.getByRole("link", { name: /^Stamps/ }).click();
  await expect(page.getByRole("heading", { name: "Stamps", level: 1 })).toBeVisible();
  await expect(page.getByTestId("stamps-standing")).toHaveText(/^0 of \d+ collected\.$/);
  await expect(page.getByTestId("stamp-cleared-oceania")).toHaveAttribute("data-earned", "false");

  // Every Oceania country the game deals pinned on the map, and yesterday's daily games all
  // finished, as each game keeps them.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await page.evaluate(
    ({ played, day }) => {
      localStorage.setItem("whereabout:played", JSON.stringify(played));
      localStorage.setItem("whereabout:units", "km");
      const run = { streak: 3, atlasRight: 1, atlasPlayed: 2, ended: "miss" };
      const estimate = { km: 100, ratio: 1.5, points: 700, tooFar: false };
      const pair = { actualKm: 100, you: estimate, atlas: null };
      const hotPin = { at: { lng: 0, lat: 0 }, km: 10, bearing: 0, found: true };
      const row = {
        order: ["a", "b", "c", "d"],
        east: ["a", "b", "c", "d"],
        right: [true, true, true, true],
        atlas: null,
      };
      const keep = (key: string, entry: unknown) =>
        localStorage.setItem(key, JSON.stringify({ [day]: entry }));
      keep("whereabout:daily-scores", 18240);
      keep("whereabout:further-north-daily", run);
      keep("whereabout:odd-one-out-daily", run);
      keep("whereabout:which-way-daily", run);
      keep("whereabout:name-country-daily", run);
      keep("whereabout:left-right-daily", run);
      keep("whereabout:how-far-daily", { results: Array(5).fill(pair) });
      keep("whereabout:hot-cold-daily", {
        results: Array(5).fill({ id: "a", pins: [hotPin], atlas: null }),
        pins: [],
      });
      keep("whereabout:line-up-daily", { results: Array(5).fill(row) });
      const close = (id: string) => ({ id, wrong: [], atlas: null });
      keep("whereabout:close-up-daily", {
        results: ["a", "b", "c", "d", "e"].map(close),
        wrong: [],
      });
      const call = (id: string) => ({ id, picked: "Arid", truth: "Arid", atlas: null });
      keep("whereabout:which-climate-daily", { results: ["a", "b", "c", "d", "e"].map(call) });
    },
    { played: [pin("p1", "AU", 900), pin("p2", "NZ", 120), pin("p3", "PF", 3000)], day: yesterday },
  );
  await page.reload();

  // Yesterday's Which climate? was five of five, which is a climate reader as well.
  await expect(page.getByTestId("stamps-standing")).toHaveText(
    /^3 of \d+ collected\. 3 new stamps since you last looked\.$/,
  );
  await expect(page.getByTestId("stamp-climate-reader")).toHaveAttribute("data-earned", "true");
  const oceania = page.getByTestId("stamp-cleared-oceania");
  await expect(oceania).toHaveAttribute("data-earned", "true");
  await expect(oceania.getByText("New")).toBeVisible();
  await expect(page.getByTestId("stamp-full-day")).toHaveAttribute("data-earned", "true");
  await expect(page.getByTestId("stamp-full-week-progress")).toHaveText("1 of 7 days");
  await expect(page.getByTestId("stamp-bullseye")).toContainText("Closest pin so far: 120 km");
  await expect(page.getByTestId("stamps-next")).toContainText("Next up:");

  // Down to a 320px phone, nothing runs off the side.
  for (const width of [page.viewportSize()!.width, 320]) {
    await page.setViewportSize({ width, height: 700 });
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scroll).toBeLessThanOrEqual(width);
  }

  // Kept: back again, the stamps are still there and no longer new, even with the map forgotten.
  await page.evaluate(() => localStorage.removeItem("whereabout:played"));
  await page.reload();
  await expect(page.getByTestId("stamps-standing")).toHaveText(/^3 of \d+ collected\.$/);
  await expect(oceania).toHaveAttribute("data-earned", "true");
  await expect(oceania.getByText("New")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("beating Atlas at a daily game earns its stamp, and a loss says how close it came", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await page.goto("./stamps");
  await expect(page.getByTestId("stamp-beat-atlas-name-country")).toHaveAttribute(
    "data-earned",
    "false",
  );
  await page.evaluate((day) => {
    const keep = (key: string, entry: unknown) =>
      localStorage.setItem(key, JSON.stringify({ [day]: entry }));
    // Three right and the miss, with Atlas on all four photos and two of them right.
    keep("whereabout:name-country-daily", {
      streak: 3,
      atlasRight: 2,
      atlasPlayed: 4,
      ended: "miss",
    });
    // One right and the miss to Atlas's two.
    keep("whereabout:further-north-daily", {
      streak: 1,
      atlasRight: 2,
      atlasPlayed: 2,
      ended: "miss",
    });
  }, yesterday);
  await page.reload();

  await expect(page.getByRole("heading", { name: "Beat Atlas", level: 2 })).toBeVisible();
  const won = page.getByTestId("stamp-beat-atlas-name-country");
  await expect(won).toHaveAttribute("data-earned", "true");
  await expect(won.getByText("New")).toBeVisible();
  await expect(page.getByTestId("stamp-beat-atlas-further-north")).toContainText(
    "Closest so far: 1 right to Atlas's 2",
  );
  await page.setViewportSize({ width: 320, height: 700 });
  await won.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  // The group leads to Atlas's day on Today.
  await page.getByRole("link", { name: "Atlas's day on Today" }).click();
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the clue games earn the clue stamps, and the group leads to them", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./stamps");
  await expect(page.getByRole("heading", { name: "Reading the clues", level: 2 })).toBeVisible();
  await expect(page.getByTestId("stamp-road-reader-progress")).toHaveText("0 of 10 calls in a row");

  await page.evaluate(() => {
    // A free Left or right? run of 10, and 35 climates named with Atlas on all of them.
    localStorage.setItem("whereabout:left-right-best", "10");
    localStorage.setItem("whereabout:which-climate-best", "4");
    localStorage.setItem(
      "whereabout:quick-record",
      JSON.stringify({
        "which-climate": { runs: 7, rounds: 35, right: 28, atlasPlayed: 35, atlasRight: 21 },
        "left-right": { runs: 2, rounds: 12, right: 10, atlasPlayed: 12, atlasRight: 11 },
      }),
    );
  });
  await page.reload();

  await expect(page.getByTestId("stamp-road-reader")).toHaveAttribute("data-earned", "true");
  await expect(page.getByTestId("stamp-climate-ahead")).toHaveAttribute("data-earned", "true");
  await expect(page.getByTestId("stamp-climate-reader-progress")).toHaveText("4 of 5 photos right");
  await expect(page.getByTestId("stamp-road-ahead-progress")).toHaveText(
    "12 of 30 photos read with Atlas",
  );
  await expect(page.getByTestId("stamp-road-ahead")).toContainText("So far: you 83%, Atlas 92%");

  await page.setViewportSize({ width: 320, height: 700 });
  await page.getByTestId("stamp-climate-ahead").scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await page
    .getByTestId("stamps-clues-intro")
    .getByRole("link", { name: "Left or right?" })
    .click();
  await expect(page).toHaveURL(/\/left-right\/?$/);
  expect(errors).toEqual([]);
});
