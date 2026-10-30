import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { continentOf } from "../src/lib/continents";
import { BUZZ, CHIME, type Closeness } from "../src/lib/feel";
import { dayKey } from "../src/lib/game/daily";

// The real photos are hot-linked from Wikimedia. Serve a local stand-in instead, so the test
// doesn't depend on the network and never hammers Wikimedia from CI.
const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

async function playRoundWithKeyboard(page: Page) {
  const globe = page.getByRole("application", { name: /Globe/ });
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  await globe.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByText(/^Your pin: /)).toBeVisible();
  await page.getByRole("button", { name: "Guess here" }).click();
  const card = page.getByRole("region").filter({ hasText: "It was taken in" });
  await expect(card).toBeVisible();
  return card;
}

test("a whole Daily Five can be played with the keyboard", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./?daily");
  await expect(page.getByText(/^Daily Five, /)).toBeVisible();
  await expect(page.getByText("Round 1 of 5", { exact: true })).toBeVisible();

  for (let round = 1; round <= 5; round++) {
    const card = await playRoundWithKeyboard(page);
    await expect(card.getByText(/points$/).first()).toBeVisible();
    await expect(card.getByRole("link", { name: /^Photo: / })).toHaveAttribute(
      "href",
      /^https:\/\/commons\.wikimedia\.org\//,
    );
    const next = card.getByRole("button", { name: round < 5 ? "Next photo" : "See your results" });
    await expect(next).toBeFocused();
    await page.keyboard.press("Enter");
  }

  await expect(page.getByText("out of 25,000 points")).toBeVisible();
  await expect(page.getByRole("list", { name: "Your rounds" }).getByRole("listitem")).toHaveCount(
    5,
  );

  // The game joins the player's record, kept in this browser.
  const record = page.getByRole("region", { name: "Your record against Atlas" });
  await expect(record.getByText("Daily Five streak").locator("+ dd")).toHaveText("1 day");
  const stored = await page.evaluate(() => localStorage.getItem("whereabout:record"));
  const saved = JSON.parse(stored ?? "{}");
  expect(saved).toMatchObject({ games: 1, streak: 1 });
  // Every round joins the continent its photo was taken on.
  const tallies = Object.values(saved.continents ?? {}) as { rounds: number; won: number }[];
  expect(tallies.reduce((n, t) => n + t.rounds, 0)).toBe(5);
  expect(tallies.reduce((n, t) => n + t.won, 0)).toBe(saved.roundsWon);
  const byContinent = record.getByRole("table", { name: "By continent" });
  await expect(byContinent.getByRole("row")).toHaveCount(1 + tallies.length);

  // The share card: five rounds, and none of the places just revealed in the results list.
  const places = await page.getByRole("listitem").locator("span.truncate").allInnerTexts();
  const card = page.getByRole("figure", { name: "Your share card" });
  await expect(card.getByRole("img", { name: /^Round \d: / })).toHaveCount(5);
  // No share sheet here, so the result goes to the clipboard.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (t: string) => void ((window as unknown as { sent: string }).sent = t),
      },
      configurable: true,
    });
  });
  await page.getByRole("button", { name: "Share result" }).click();
  await expect(page.getByText("Result copied. Paste it anywhere.")).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(sent).toMatch(/^Whereabout: Daily Five, /);
  expect(sent).toMatch(/\/whereabout\/\?daily$/);
  for (const place of places) {
    expect(sent).not.toContain(place);
    await expect(card).not.toContainText(place);
  }

  // The same card as a picture: saved as a download where the browser can't share files...
  const picture = page.getByRole("button", { name: "Share as a picture" });
  const download = page.waitForEvent("download");
  await picture.click();
  const saved_png = await download;
  expect(saved_png.suggestedFilename()).toMatch(/^whereabout-daily-five-[a-z]+-\d+\.png$/);
  const png = readFileSync(await saved_png.path());
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1080]);
  await expect(page.getByText("Picture saved. Post it anywhere.")).toBeVisible();

  // ...and handed to the share sheet, with the text card alongside, where it can.
  await page.evaluate(() => {
    const w = window as unknown as { picture: object };
    Object.defineProperty(navigator, "canShare", {
      value: (d: ShareData) => (d.files?.length ?? 0) > 0,
      configurable: true,
    });
    Object.defineProperty(navigator, "share", {
      value: async (d: ShareData) => {
        const f = d.files![0];
        w.picture = { name: f.name, type: f.type, size: f.size, text: d.text };
      },
      configurable: true,
    });
  });
  await picture.click();
  await expect(page.getByText("Picture shared.")).toBeVisible();
  const shared = await page.evaluate(
    () => (window as unknown as { picture: { size: number } }).picture,
  );
  expect(shared).toMatchObject({
    name: saved_png.suggestedFilename(),
    type: "image/png",
    text: sent,
  });
  expect(shared.size).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});

test("a fifth Daily Five in a row earns the Five-day streak badge on the summary", async ({
  page,
}) => {
  // Four Daily Fives in a row already, the last one yesterday, kept in this browser.
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  await page.goto("./");
  await page.evaluate((lastDaily) => {
    const record = { games: 4, roundsVsAtlas: 20, roundsWon: 0, best: 9_000, lastDaily };
    localStorage.setItem(
      "whereabout:record",
      JSON.stringify({ ...record, streak: 4, bestStreak: 4, continents: {}, badges: [] }),
    );
  }, yesterday);

  await page.goto("./?daily");
  for (let round = 1; round <= 5; round++) {
    const card = await playRoundWithKeyboard(page);
    await card.getByRole("button", { name: round < 5 ? "Next photo" : "See your results" }).click();
  }

  const badges = page.getByRole("list", { name: /^Badges \d of 5$/ });
  await expect(badges.getByRole("listitem")).toHaveCount(5);
  await expect(
    badges.getByRole("listitem", { name: "Five-day streak: earned this game" }),
  ).toContainText("New");
  await expect(page.getByText(/^New this game: .*Five-day streak/)).toBeVisible();
  await expect(badges.getByRole("listitem", { name: "Hard won: not yet" })).toBeVisible();
  const saved = JSON.parse((await page.evaluate(() => localStorage.getItem("whereabout:record")))!);
  expect(saved.streak).toBe(5);
  expect(saved.badges).toContain("daily-five");
});

test("a past Daily Five plays from the archive, and the summary's calendar opens any day", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const past = dayKey(new Date(Date.now() - 3 * 86_400_000));
  const pastName = new Date(`${past}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  await page.goto(`./?daily=${past}`);
  await expect(page.getByText(`Daily Five, ${pastName}`).first()).toBeVisible();
  for (let round = 1; round <= 5; round++) {
    const card = await playRoundWithKeyboard(page);
    await card.getByRole("button", { name: round < 5 ? "Next photo" : "See your results" }).click();
  }

  // A past day joins the record but not the streak.
  const saved = JSON.parse((await page.evaluate(() => localStorage.getItem("whereabout:record")))!);
  expect(saved).toMatchObject({ games: 1, streak: 0, lastDaily: null });

  const archive = page.getByRole("region", { name: "Daily Five archive" });
  await expect(archive.getByRole("button")).toHaveCount(30);
  const played = archive.getByRole("button", {
    name: new RegExp(`^${pastName}: [\\d,]+ points\\. Play it again$`),
  });
  await expect(played).toHaveAttribute("aria-current", "date");
  await expect(archive.getByText(/You've played 1 of the last 30 days\./)).toBeVisible();
  // The calendar fits a phone's width with no sideways scrolling.
  await archive.scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // Today's cell opens today's Daily Five, the one that counts toward the streak.
  await archive.getByRole("button", { name: "Today: not played yet. Play it" }).click();
  await expect(page.getByText("Round 1 of 5", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?daily$/);
  expect(errors).toEqual([]);
});

/** Records every buzz and every chime note the page plays, in place of the phone and speakers. */
async function listenForFeel(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { buzzes: number[][]; notes: number };
    w.buzzes = [];
    w.notes = 0;
    Object.defineProperty(navigator, "vibrate", {
      value: (pattern: number[]) => (w.buzzes.push([...pattern]), true),
      configurable: true,
    });
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      w.notes += 1;
      return create.call(this);
    };
  });
  return () =>
    page.evaluate(() => {
      const w = window as unknown as { buzzes: number[][]; notes: number };
      return { buzzes: w.buzzes, notes: w.notes };
    });
}

test("the reveal buzzes and chimes for how close the pin landed, until muted", async ({ page }) => {
  const felt = await listenForFeel(page);
  await page.goto("./?daily");
  const toggle = page.getByRole("button", { name: "Sound and vibration at the reveal" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  let card = await playRoundWithKeyboard(page);
  await expect.poll(async () => (await felt()).buzzes.length).toBe(1);
  const { buzzes, notes } = await felt();
  const closeness = (Object.keys(BUZZ) as Closeness[]).find(
    (c) => JSON.stringify(BUZZ[c]) === JSON.stringify(buzzes[0]),
  );
  expect(closeness, `a known buzz: ${JSON.stringify(buzzes[0])}`).toBeDefined();
  // The chime belongs to the same closeness as the buzz.
  expect(notes).toBe(CHIME[closeness!].notes.length);

  // Muted: the next reveal is silent and still, and the choice outlasts a reload.
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await card.getByRole("button", { name: "Next photo" }).click();
  card = await playRoundWithKeyboard(page);
  await expect(card.getByText(/points$/).first()).toBeVisible();
  expect(await felt()).toEqual({ buzzes, notes });
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
});

test("under reduced motion the reveal neither buzzes nor chimes, and offers no toggle", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const felt = await listenForFeel(page);
  await page.goto("./?daily");
  await expect(page.getByRole("button", { name: /Daily Five|New/ }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Sound and vibration at the reveal" })).toHaveCount(
    0,
  );
  const card = await playRoundWithKeyboard(page);
  await expect(card.getByText(/points$/).first()).toBeVisible();
  expect(await felt()).toEqual({ buzzes: [], notes: 0 });
});

test("the globe renders with WebGL and accepts a click", async ({ page }) => {
  await page.goto("./");
  const globe = page.locator(".globe[data-ready]");
  await expect(globe).toBeVisible({ timeout: 20_000 });
  // On desktop the globe grows while the pointer is over it, and MapLibre redraws its canvas to
  // the new size a few frames later. Click where the globe is once it has settled, as a player
  // aiming at what they see would, not where it was before the pointer arrived.
  const before = (await globe.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  const canvas = globe.locator("canvas.maplibregl-canvas");
  await expect(async () => {
    const first = await globe.boundingBox();
    await page.waitForTimeout(400);
    const [g, c] = [await globe.boundingBox(), await canvas.boundingBox()];
    expect(g).toEqual(first);
    expect(c?.width).toBeCloseTo(g!.width, 0);
    expect(c?.height).toBeCloseTo(g!.height, 0);
  }).toPass({ timeout: 10_000 });
  const box = (await globe.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText(/^Your pin: /)).toBeVisible();
  await expect(page.getByRole("button", { name: "Guess here" })).toBeEnabled();
});

test("the photo can be zoomed and dragged", async ({ page }) => {
  await page.goto("./");
  const zoomIn = page.getByRole("button", { name: "Zoom in on the photo" });
  await expect(zoomIn).toBeVisible();
  await zoomIn.click();
  const zoomOut = page.getByRole("button", { name: "Zoom out of the photo" });
  await expect(zoomOut).toBeVisible();
  const img = zoomOut.getByRole("img");
  const before = await img.evaluate((el) => (el as HTMLElement).style.transform);
  const box = (await zoomOut.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 120, cy, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() => img.evaluate((el) => (el as HTMLElement).style.transform))
    .not.toBe(before);
  await expect(page.getByRole("button", { name: "Zoom out of the photo" })).toBeVisible();
  await page.getByRole("button", { name: "Reset photo view" }).click();
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
});

test("everyone gets the same five photos on the same day", async ({ browser }) => {
  const first = async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route(/wikimedia\.org/, (route) =>
      route.fulfill({ body: PHOTO, contentType: "image/png" }),
    );
    await page.goto("./?daily");
    const src = await page.getByRole("img").getAttribute("src");
    await context.close();
    return src;
  };
  expect(await first()).toBe(await first());
});

test("each visit opens a fresh game that avoids recently played photos", async ({ page }) => {
  const recent = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("whereabout:recent-photos") ?? "[]"));

  await page.goto("./");
  await expect(page.getByText("Fresh game", { exact: true })).toBeVisible();
  await expect(page.getByRole("img")).toHaveAttribute("src", /.+/);
  await expect.poll(async () => (await recent()).length).toBe(5);

  await page.goto("./");
  await expect(page.getByText("Fresh game", { exact: true })).toBeVisible();
  await expect.poll(async () => (await recent()).length).toBe(10);
  expect(new Set(await recent()).size).toBe(10);
});

test("a reload mid-game reopens the same round with the same photos, score and pin", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const photo = page.getByRole("img", { name: /photo to locate/ });
  const score = page.locator("header p.tabular");

  await page.goto("./?tier=easy");
  await expect(page.getByText("Easy game", { exact: true })).toBeVisible();
  const card = await playRoundWithKeyboard(page);
  await card.getByRole("button", { name: "Next photo" }).click();
  await expect(page.getByText("Round 2 of 5", { exact: true })).toBeVisible();
  const second = await photo.getAttribute("src");
  const points = await score.textContent();
  // A pin on round 2, then the tab is lost (a reload, or a phone closing it).
  const globe = page.getByRole("application", { name: /Globe/ });
  await globe.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^Your pin: /)).toBeVisible();
  const pin = await page.getByText(/^Your pin: /).textContent();

  await page.reload();
  await expect(page.getByText("Picked up where you left off")).toBeVisible();
  await expect(page.getByText("Easy game", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?tier=easy/);
  await expect(page.getByText("Round 2 of 5", { exact: true })).toBeVisible();
  await expect(photo).toHaveAttribute("src", second!);
  await expect(score).toHaveText(points!);
  await expect(page.getByText(/^Your pin: /)).toHaveText(pin!);
  await page.getByRole("button", { name: "Guess here" }).click();
  const reveal = page.getByRole("region").filter({ hasText: "It was taken in" });
  await expect(reveal).toBeVisible();
  await expect(page.getByText("Picked up where you left off")).toHaveCount(0);
  await reveal.getByRole("button", { name: "Next photo" }).click();
  await expect(page.getByText("Round 3 of 5", { exact: true })).toBeVisible();

  // A new game lets the old one go: the next reload starts afresh.
  await page.getByRole("button", { name: /Daily Five/ }).click();
  await expect(page.getByText(/^Daily Five, /)).toBeVisible();
  await page.reload();
  await expect(page.getByText("Round 1 of 5", { exact: true })).toBeVisible();
  await expect(page.getByText("Picked up where you left off")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the Daily Five is one button away from a fresh game", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Play the Daily Five" }).click();
  await expect(page.getByText(/^Daily Five, /)).toBeVisible();
  await expect(page.getByText("Round 1 of 5", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?daily/);
});

/** Atlas's miss on each photo, measured here independently of the app's own code. */
function atlasErrors(): Map<string, number> {
  const read = (f: string) => JSON.parse(readFileSync(resolve(process.cwd(), f), "utf8"));
  const guesses: Record<string, { lat: number; lng: number }> = read("src/data/atlas.json").guesses;
  const rad = Math.PI / 180;
  const errors = new Map<string, number>();
  for (const p of read("src/data/photos.json") as { id: string; lat: number; lng: number }[]) {
    const g = guesses[p.id];
    if (!g) continue;
    const h =
      Math.sin(((p.lat - g.lat) * rad) / 2) ** 2 +
      Math.cos(p.lat * rad) * Math.cos(g.lat * rad) * Math.sin(((p.lng - g.lng) * rad) / 2) ** 2;
    errors.set(p.id, 2 * 6371.0088 * Math.asin(Math.sqrt(h)));
  }
  return errors;
}

test("a Hard game deals only photos Atlas missed by most, chosen next to the Daily Five", async ({
  page,
}) => {
  const errors = atlasErrors();
  const sorted = [...errors.values()].sort((a, b) => a - b);
  const hardFrom = sorted[Math.round((2 * sorted.length) / 3)];
  const dealt: string[] = [];
  page.on("request", (r) => {
    const m = r.url().match(/\/game-data\/[0-9a-f]{8}\/([\w-]+)\.json$/);
    if (m) dealt.push(m[1]);
  });

  await page.goto("./");
  await expect(page.getByText("Fresh game", { exact: true })).toBeVisible();
  const picker = page.getByRole("combobox", {
    name: "Which photos: how hard they were for Atlas, or where they were taken",
  });
  await expect(picker).toBeVisible();
  await expect(page.getByRole("button", { name: "Play the Daily Five" })).toBeVisible();
  // Let the opening fresh game finish fetching its five before counting the Hard game's.
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();

  dealt.length = 0;
  await picker.selectOption("hard");
  await expect(page.getByText("Hard game", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Atlas missed these by [\d,]+ km or more$/)).toBeVisible();
  await expect(page).toHaveURL(/\?tier=hard$/);
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  expect(dealt).toHaveLength(5);
  for (const id of dealt) expect(errors.get(id)!).toBeGreaterThanOrEqual(hardFrom);

  // The round plays as usual, and a reload keeps the tier.
  await playRoundWithKeyboard(page);
  await page.reload();
  await expect(page.getByText("Hard game", { exact: true })).toBeVisible();
  await expect(picker).toHaveValue("hard");
});

test("a Blitz game gives each photo 30 seconds, then locks the round in for 0 with no pin", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("./");
  await page.getByRole("button", { name: "Blitz", exact: true }).click();
  await expect(page).toHaveURL(/\?blitz$/);
  await expect(page.getByText("Blitz", { exact: true })).toBeVisible();

  // The ring sits beside the guess button, on screen, and runs down once the photo shows.
  const clock = page.getByTestId("blitz-clock");
  await expect(clock).toBeVisible();
  await expect(clock).toHaveAttribute("data-paused", "false");
  const box = (await clock.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  const guess = (await page
    .getByRole("button", { name: "Place your pin on the globe" })
    .boundingBox())!;
  expect(Math.abs(box.y + box.height / 2 - (guess.y + guess.height / 2))).toBeLessThan(
    guess.height,
  );
  const start = Number(await clock.getAttribute("data-seconds"));
  expect(start).toBeLessThanOrEqual(30);
  await expect
    .poll(async () => Number(await clock.getAttribute("data-seconds")), { timeout: 5_000 })
    .toBeLessThan(start);

  // No pin when time runs out: the answer shows, and the round scores nothing.
  const card = page.getByRole("region").filter({ hasText: "It was taken in" });
  await expect(card).toBeVisible({ timeout: 45_000 });
  await expect(card.getByTestId("time-up")).toHaveText(/no pin on the globe/);
  await expect(card.getByText("No pin", { exact: true })).toBeVisible();
  await expect(page.locator("header").getByText(/^0\s*points$/)).toBeVisible();

  // A reload keeps the mode, with a fresh photo and a full clock.
  await page.reload();
  await expect(page.getByText("Blitz", { exact: true })).toBeVisible();
  await expect(page.getByTestId("blitz-clock")).toHaveAttribute("data-paused", "false");
});

test("a continent game deals only photos taken on that continent, picked from the same menu", async ({
  page,
}) => {
  const photos = JSON.parse(
    readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
  ) as { id: string; country: string }[];
  const countryOf = new Map(photos.map((p) => [p.id, p.country]));
  const dealt: string[] = [];
  page.on("request", (r) => {
    const m = r.url().match(/\/game-data\/[0-9a-f]{8}\/([\w-]+)\.json$/);
    if (m) dealt.push(m[1]);
  });

  await page.goto("./");
  await expect(page.getByText("Fresh game", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  const picker = page.getByRole("combobox", { name: /^Which photos/ });

  dealt.length = 0;
  await picker.selectOption("europe");
  await expect(page.getByText("Europe game", { exact: true })).toBeVisible();
  await expect(page.getByText(/^All taken in Europe: [\d,]+ photos$/)).toBeVisible();
  await expect(page).toHaveURL(/\?region=europe$/);
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  expect(dealt).toHaveLength(5);
  for (const id of dealt) expect(continentOf(countryOf.get(id))).toBe("Europe");

  // The round plays as usual, and a reload keeps the continent.
  await playRoundWithKeyboard(page);
  await page.reload();
  await expect(page.getByText("Europe game", { exact: true })).toBeVisible();
  await expect(picker).toHaveValue("europe");
});

// The frame mirrors the camera only when a move ends, and an ease ends on the first frame drawn
// after its duration. Software WebGL on a busy CI runner can take seconds per frame while the
// reveal draws its arcs and heatmap, so a 1.3 s camera move can end well past expect's default
// 5 s (it did on both attempts on the phone project). Wait for the move to land, not the clock.
const CAMERA_SETTLES = { timeout: 20_000 };

test("every round starts with the whole globe centred, after any reveal", async ({ page }) => {
  // Regression: the reveal's camera padding used to stick, pushing later rounds' globe aside.
  await page.goto("./?daily");
  const frame = page.locator(".globe[data-ready]");
  await expect(frame).toBeVisible({ timeout: 20_000 });
  const centred = { padding: "0,0,0,0", zoom: "1.40" };
  await expect(frame).toHaveAttribute("data-padding", centred.padding);

  for (let round = 1; round <= 3; round++) {
    const card = await playRoundWithKeyboard(page);
    await expect(frame).not.toHaveAttribute("data-padding", centred.padding, CAMERA_SETTLES);
    // The view controls stay usable at the reveal, never hidden under the result card.
    await page.getByRole("button", { name: "Show the answer again" }).click({ trial: true });
    await card.getByRole("button", { name: "Next photo" }).click();
    await expect(page.getByText(`Round ${round + 1} of 5`, { exact: true })).toBeVisible();
    await expect(frame).toHaveAttribute("data-padding", centred.padding, CAMERA_SETTLES);
    await expect(frame).toHaveAttribute("data-zoom", centred.zoom, CAMERA_SETTLES);
  }
});

test("the globe can be spun, zoomed and recentred", async ({ page }) => {
  await page.goto("./");
  const frame = page.locator(".globe[data-ready]");
  await expect(frame).toBeVisible({ timeout: 20_000 });

  // data-zoom updates on moveend, after the zoom animation's last frame: on a loaded CI
  // runner with software WebGL that can take well over the default 5 s.
  await page.getByRole("button", { name: "Zoom in on the globe" }).click();
  await expect(frame).not.toHaveAttribute("data-zoom", "1.40", CAMERA_SETTLES);

  // Drag to spin the globe somewhere else.
  const box = (await frame.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - box.width / 4, cy + 20, { steps: 8 });
  await page.mouse.up();

  await page.getByRole("button", { name: "Recenter the globe" }).click();
  await expect(frame).toHaveAttribute("data-zoom", "1.40", CAMERA_SETTLES);
  await expect(frame).toHaveAttribute("data-padding", "0,0,0,0", CAMERA_SETTLES);
  // Spinning is not a pin drop.
  await expect(page.getByText("Place your pin", { exact: true })).toBeVisible();
});

test("a spin stays a spin when the globe changes size mid-drag", async ({ page }) => {
  // The photo finishing loading, a phone's address bar sliding away or a rotation can all
  // resize the globe under a finger. MapLibre then forgets where the press began and reports
  // the release as a click; the globe must not drop a pin there.
  await page.goto("./");
  const frame = page.locator(".globe[data-ready]");
  await expect(frame).toBeVisible({ timeout: 20_000 });
  const box = (await frame.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 40, cy, { steps: 4 });
  const resized = await page.evaluate(async () => {
    const globe = document.querySelector<HTMLElement>(".globe")!;
    const canvas = globe.querySelector("canvas")!;
    const before = canvas.clientHeight;
    globe.style.minHeight = `${globe.clientHeight + 60}px`;
    // MapLibre resizes from its own ResizeObserver; wait for its canvas to follow.
    for (let i = 0; i < 100 && canvas.clientHeight === before; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return canvas.clientHeight !== before;
  });
  expect(resized).toBe(true);
  await page.mouse.move(cx - box.width / 4, cy + 20, { steps: 4 });
  await page.mouse.up();

  await expect(page.getByText("Place your pin", { exact: true })).toBeVisible();
  // A plain tap afterwards still places the pin.
  await page.mouse.click(cx, cy);
  await expect(page.getByText(/^Your pin: /)).toBeVisible();
});

test("on a phone the answer stays in view above the result card", async ({ page }) => {
  test.skip(
    (page.viewportSize()?.width ?? 1000) >= 768,
    "the card sits beside the globe on wide screens",
  );
  await page.goto("./?daily");
  for (let round = 1; round <= 5; round++) {
    const card = await playRoundWithKeyboard(page);
    const truth = page.locator(".globe-pin--truth");
    await expect(truth).toBeVisible({ timeout: 5_000 });
    // Let the camera finish framing the answer before measuring.
    await page.waitForTimeout(800);
    const cardBox = (await card.boundingBox())!;
    const pinBox = (await truth.boundingBox())!;
    expect(pinBox.y + pinBox.height, `round ${round}: gold pin above the card`).toBeLessThan(
      cardBox.y,
    );
    expect(
      cardBox.height,
      `round ${round}: card leaves most of the screen to the globe`,
    ).toBeLessThan(page.viewportSize()!.height / 2);
    // The map credits never run over the game header at the reveal.
    const credits = (await page.locator(".maplibregl-ctrl-attrib").boundingBox())!;
    const header = (await page.locator("header").first().boundingBox())!;
    expect(credits.y, `round ${round}: credits below the header`).toBeGreaterThan(
      header.y + header.height,
    );
    // Atlas's reasoning is one tap away.
    const toggle = card.getByRole("button", { name: "How Atlas guessed" });
    if (await toggle.count()) {
      await toggle.click();
      await expect(card.getByRole("button", { name: "Hide how Atlas guessed" })).toBeVisible();
    }
    await card.getByRole("button", { name: round < 5 ? "Next photo" : "See your results" }).click();
  }
  await expect(page.getByText("out of 25,000 points")).toBeVisible();
});

test("on the narrowest phones every header control stays on screen", async ({ page }) => {
  test.skip(
    (page.viewportSize()?.width ?? 1000) >= 768,
    "a phone layout check; desktop has room to spare",
  );
  // 360px is the commonest Android width; 320px is the smallest phone still in use.
  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 740 });
    for (const address of ["./", "./?daily", "./?region=europe", "./?tier=hard", "./?blitz"]) {
      await page.goto(address);
      const header = page.locator("header").first();
      const controls = header.locator("button:visible, a:visible, select:visible");
      await expect(controls.first()).toBeVisible();
      const score = (await header.getByText(/^Round 1 of 5$/).boundingBox())!;
      for (const control of await controls.all()) {
        const box = (await control.boundingBox())!;
        const what = `${width}px ${address}: "${(await control.textContent())?.trim()}"`;
        expect(box.x, `${what} starts on screen`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${what} ends on screen`).toBeLessThanOrEqual(width);
        // Nothing slides under the round counter and score in the top corner.
        const clear = box.y >= score.y + score.height || box.x + box.width <= score.x;
        expect(clear, `${what} clear of the score`).toBe(true);
      }
    }
  }
  // The shortened labels still name what they do, and still work.
  await page.getByRole("link", { name: /Streak$/ }).click();
  await expect(page).toHaveURL(/\/streak\/?$/);
});

test("any round of a finished game opens again from the summary, and back returns to it", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./?daily");
  for (let round = 1; round <= 5; round++) {
    const card = await playRoundWithKeyboard(page);
    await card.getByRole("button", { name: round < 5 ? "Next photo" : "See your results" }).click();
  }
  await expect(page.getByText("out of 25,000 points")).toBeVisible();
  const places = await page.getByRole("listitem").locator("span.truncate").allInnerTexts();
  const total = await page.getByRole("heading", { level: 1 }).locator(".sr-only").innerText();

  await page.getByRole("button", { name: /^Look again at round 3: / }).click();
  const card = page.getByRole("region", { name: places[2] });
  await expect(card.getByText("Round 3 of 5 again · no new score")).toBeVisible();
  // Both pins and the answer are back on the globe, which takes no new pin.
  await expect(page.locator(".globe-pin--truth")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: "Guess here" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Round 4 again" })).toBeFocused();
  if ((page.viewportSize()?.width ?? 1000) < 768) {
    await page.waitForTimeout(800);
    const cardBox = (await card.boundingBox())!;
    const pinBox = (await page.locator(".globe-pin--truth").boundingBox())!;
    expect(pinBox.y + pinBox.height, "gold pin above the card").toBeLessThan(cardBox.y);
    expect(cardBox.height, "card leaves most of the screen to the globe").toBeLessThan(
      page.viewportSize()!.height / 2,
    );
  }

  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: places[3] })).toBeVisible();
  await page.getByRole("button", { name: "Back to your results" }).click();
  await expect(page.getByRole("button", { name: /^Look again at round 4: / })).toBeFocused();
  await expect(page.getByRole("heading", { level: 1 }).locator(".sr-only")).toHaveText(total);

  // A phone's back gesture closes a replay instead of leaving the game.
  await page.getByRole("button", { name: /^Look again at round 1: / }).click();
  await expect(page.getByRole("region", { name: places[0] })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: /^Look again at round 1: / })).toBeFocused();
  expect(new URL(page.url()).search).toBe("?daily");
  const saved = JSON.parse((await page.evaluate(() => localStorage.getItem("whereabout:record")))!);
  expect(saved).toMatchObject({ games: 1 });
  expect(errors).toEqual([]);
});

test("a finished game becomes a challenge link a friend plays on the same five photos", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./?daily");
  for (let round = 1; round <= 5; round++) {
    const card = await playRoundWithKeyboard(page);
    await card.getByRole("button", { name: round < 5 ? "Next photo" : "See your results" }).click();
  }
  await expect(page.getByText("out of 25,000 points")).toBeVisible();
  const places = await page.getByRole("listitem").locator("span.truncate").allInnerTexts();
  const total = (
    await page.getByRole("heading", { level: 1 }).locator(".sr-only").innerText()
  ).replace(" points", "");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (t: string) => void ((window as unknown as { sent: string }).sent = t),
      },
      configurable: true,
    });
  });
  await page.getByRole("button", { name: "Challenge a friend" }).click();
  await expect(page.getByText("Challenge link copied.", { exact: false })).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  for (const place of places) expect(sent).not.toContain(place);
  const link = sent.split("\n").at(-1)!;
  expect(link).toMatch(/\/whereabout\/\?challenge=[\w.-]+_[\d.]+$/);

  // The friend opens the link in their own browser, with nothing stored.
  const friend = await browser.newPage({ viewport: page.viewportSize()! });
  await friend.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
  friend.on("pageerror", (e) => errors.push(e.message));
  await friend.goto(link);
  await expect(friend.getByText("A friend's challenge", { exact: true })).toBeVisible();
  await expect(friend.getByText(`Score to beat: ${total}`)).toBeVisible();
  const card = await playRoundWithKeyboard(friend);
  // The same first photo as the sender's game, with the sender's score on it.
  await expect(card.getByRole("heading", { name: places[0] })).toBeVisible();
  await expect(card.getByTestId("friend-line")).toHaveText(/^Your friend scored [\d,]+ here\. /);
  if ((friend.viewportSize()?.width ?? 1000) < 768) {
    const box = (await card.boundingBox())!;
    expect(box.height, "the friend line keeps the card short").toBeLessThan(
      friend.viewportSize()!.height / 2,
    );
  }
  await friend.close();
  expect(errors).toEqual([]);
});

test("a game fetches only the five photos it deals, not the whole catalog", async ({ page }) => {
  const records: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/game-data/")) records.push(r.url());
  });
  await page.goto("./?daily");
  await expect(page.getByText("Round 1 of 5", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  expect(records).toHaveLength(5);
  for (const url of records) {
    expect(url).toMatch(/\/whereabout\/game-data\/[0-9a-f]{8}\/[\w-]+\.json$/);
  }
});

test("the photo is the first thing on screen, held by a still blur while it loads", async ({
  page,
}) => {
  // Hold the photo back (but not its tiny 60px thumbnail) to see what fills its place.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/wikimedia\.org/, async (route) => {
    if (!/\/60px-/.test(route.request().url())) await held;
    await route.fulfill({ body: PHOTO, contentType: "image/png" });
  });
  try {
    await page.goto("./?daily");
    const holder = page.locator('.wb-photo [data-photo-placeholder="showing"]').first();
    await expect(holder).toBeVisible();
    // No spinner and no splash screen: the first screen is already round one.
    await expect(page.getByText("Round 1 of 5", { exact: true })).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.locator(".wb-shimmer").count()).toBe(0);
    // The placeholder spans the photo's whole frame, which starts at the top of the screen.
    const frame = (await page.locator(".wb-photo").boundingBox())!;
    const box = (await holder.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(frame.y).toBe(0);
    expect(frame.width).toBe(viewport.width);
    expect(box.width).toBeCloseTo(frame.width, 0);
    expect(box.height).toBeCloseTo(frame.height, 0);
  } finally {
    release();
  }

  await expect(page.locator('.wb-photo [data-photo-placeholder="covered"]')).toHaveCount(1);
  // Once loaded, the photo is what sits at the centre of its frame, even under the first-visit
  // card (the card lets taps through).
  const hit = await page.evaluate(() => {
    const f = document.querySelector(".wb-photo")!.getBoundingClientRect();
    const el = document.elementFromPoint(f.left + f.width / 2, f.top + f.height / 2);
    return el?.closest("button")?.getAttribute("aria-label") ?? null;
  });
  expect(hit).toBe("Zoom in on the photo");
});

test("first-time visitors get a card over the photo that their first tap dismisses for good", async ({
  page,
}) => {
  await page.goto("./?daily");
  const title = page.getByText("Guess where this was taken.", { exact: true });
  await expect(title).toBeVisible();
  await expect(page.getByText("Atlas, our AI, is guessing too. Beat it.")).toBeVisible();
  // The card sits over the photo, not over the globe.
  const card = (await title.boundingBox())!;
  const photo = (await page.locator(".wb-photo").boundingBox())!;
  expect(card.y).toBeGreaterThanOrEqual(photo.y);
  expect(card.y + card.height).toBeLessThanOrEqual(photo.y + photo.height);

  // The first tap both dismisses the card and does what it would have done anyway.
  await page.getByRole("button", { name: "Zoom in on the photo" }).click();
  await expect(title).toBeHidden();
  await expect(page.getByRole("button", { name: "Zoom out of the photo" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  await expect(title).toHaveCount(0);
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  await expect(title).toHaveCount(0);
});

test("hints come one at a time, stay on screen with the globe, and cap the round's score", async ({
  page,
}) => {
  await page.goto("./?daily");
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  const hints = page.getByRole("list", { name: "Hints" });
  await expect(hints).toHaveCount(0);

  // Every photo offers at least its continent; take hints until the button goes.
  let taken = 0;
  const hint = page.getByRole("button", { name: /^Take a hint/ });
  while ((await hint.count()) > 0) {
    await hint.click();
    taken += 1;
    await expect(hints.getByRole("listitem")).toHaveCount(taken);
  }
  expect(taken).toBeGreaterThanOrEqual(1);
  expect(taken).toBeLessThanOrEqual(3);
  await expect(hints.getByRole("listitem").first()).toHaveText(/^It's in /);

  // The hints and the guess button fit on screen without pushing the globe away.
  const viewport = page.viewportSize()!;
  const list = (await hints.boundingBox())!;
  expect(list.x + list.width).toBeLessThanOrEqual(viewport.width + 1);
  await expect(page.locator(".globe")).toBeInViewport();
  await expect(page.getByRole("button", { name: "Place your pin on the globe" })).toBeInViewport();

  const max = ["5,000", "4,000", "3,000", "2,000"][taken];
  await expect(page.getByText(`This round is now worth up to ${max} points.`)).toBeVisible();

  const globe = page.getByRole("application", { name: /Globe/ });
  await globe.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Guess here" }).click();
  const card = page.getByRole("region").filter({ hasText: "It was taken in" });
  await expect(card).toBeVisible();
  await expect(card.getByText(new RegExp(`worth up to ${max} points\\.$`)).first()).toBeAttached();
  // A score can never beat the cap the hints set.
  const announced = await card.getByText(/^You were .+ away and scored /).textContent();
  const scored = Number(/scored ([\d,]+) points/.exec(announced ?? "")![1].replace(/,/g, ""));
  expect(scored).toBeLessThanOrEqual(Number(max.replace(",", "")));
});

test("the reveal shows the photo's real clues next to what Atlas read", async ({
  page,
  isMobile,
}) => {
  const catalog = JSON.parse(readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"));
  await page.goto("./?daily");
  const card = await playRoundWithKeyboard(page);
  // Several photos share a place name (five are "Kourou, French Guiana"), so find this one by
  // its credit link, which is unique to each photo.
  const source = await card.getByRole("link", { name: /^Photo: / }).getAttribute("href");
  const photo = catalog.find(
    (p: { credit: { sourceUrl: string } }) => p.credit.sourceUrl === source,
  );
  expect(photo, `${source} is in the catalog`).toBeTruthy();

  // Phones fold Atlas's reasoning, and the real clues with it, behind one toggle.
  if (isMobile)
    await card.getByRole("button", { name: /How Atlas guessed|The real clues/ }).click();
  const clues = card.getByRole("list", { name: /^The real clues/ });
  await expect(clues).toBeVisible();
  const expected = [
    photo.drivingSide && `Drives on the ${photo.drivingSide}`,
    photo.climateGroup && `${photo.climateGroup} climate`,
    photo.landCover && "around it",
  ].filter(Boolean);
  const rows = clues.getByRole("listitem");
  await expect(rows).toHaveCount(expected.length);
  for (const [i, text] of expected.entries()) await expect(rows.nth(i)).toContainText(text);
  // Every row says what Atlas read, or that it didn't say.
  for (let i = 0; i < expected.length; i++) await expect(rows.nth(i)).toContainText("Atlas");
  await expect(card.getByText(/ESA WorldCover 2021/)).toBeVisible();
});

test("every reveal teaches one thing about the place: its postcard under the name", async ({
  page,
  isMobile,
}) => {
  type Photo = {
    id: string;
    place: string;
    credit: { sourceUrl: string };
    postcard?: { description?: string; article?: { title: string; url: string } };
  };
  const catalog: Photo[] = JSON.parse(
    readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
  );
  const atlas = JSON.parse(readFileSync(resolve(process.cwd(), "src/data/atlas.json"), "utf8"));
  const playable = catalog.filter((p) => Object.hasOwn(atlas.guesses, p.id));
  // The longest description with an article: the hardest postcard to fit on a phone.
  const [longest] = playable
    .filter((p) => p.postcard?.description && p.postcard.article)
    .sort((a, b) => b.postcard!.description!.length - a.postcard!.description!.length);
  expect(longest, "a playable photo has a whole postcard").toBeTruthy();
  const others = playable.filter((p) => p.id !== longest.id).slice(0, 4);
  // A challenge link deals exactly these photos, the longest postcard first.
  const ids = [longest, ...others].map((p) => p.id);
  await page.goto(`./?challenge=${ids.join(".")}_${ids.map(() => 2500).join(".")}`);
  const card = await playRoundWithKeyboard(page);
  await expect(card.getByRole("heading", { name: longest.place })).toBeVisible();

  const postcard = card.getByTestId("postcard");
  await expect(postcard).toContainText(longest.postcard!.description!.slice(0, 30));
  const article = longest.postcard!.article!;
  await expect(
    postcard.getByRole("link", { name: `Read about ${article.title} on Wikipedia` }),
  ).toHaveAttribute("href", article.url);
  await expect(
    postcard.getByRole("link", { name: "Description: Wikimedia Commons, CC BY-SA 4.0" }),
  ).toHaveAttribute("href", longest.credit.sourceUrl);

  if (isMobile) {
    // Cut to one line on a phone, so the card still leaves the answer in view…
    await page.waitForTimeout(800);
    const cardBox = (await card.boundingBox())!;
    expect(cardBox.height).toBeLessThan(page.viewportSize()!.height / 2);
    // …and one tap away in full.
    const more = postcard.getByRole("button", { name: "More" });
    const text = postcard.getByText(longest.postcard!.description!);
    const cut = (await text.boundingBox())!.height;
    await more.click();
    await expect(postcard.getByRole("button", { name: "Less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect((await text.boundingBox())!.height).toBeGreaterThan(cut);
  } else {
    // Wider screens show it whole, with nothing to unfold.
    await expect(postcard.getByRole("button", { name: "More" })).toBeHidden();
    await expect(postcard.getByText(longest.postcard!.description!)).toBeVisible();
  }
});

test("the summary offers a rematch of the photos Atlas beat you on, scored against your first try", async ({
  page,
}) => {
  // A whole game, the rematch's first two rounds and a reload: twice a usual game's length.
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Five photos Atlas won outright on the first try, as earlier games would have kept them.
  const atlas = JSON.parse(readFileSync(resolve(process.cwd(), "src/data/atlas.json"), "utf8"));
  const ids = Object.keys(atlas.guesses).sort().slice(0, 5);
  await page.goto("./map/");
  await page.evaluate(
    (pool) => localStorage.setItem("whereabout:rematch", JSON.stringify(pool)),
    ids.map((id) => ({ id, score: 0, atlas: 5000 })),
  );
  await page.goto("./?daily");
  for (let round = 1; round <= 5; round++) {
    const card = await playRoundWithKeyboard(page);
    await card.getByRole("button", { name: round < 5 ? "Next photo" : "See your results" }).click();
  }
  const offer = page.getByRole("button", { name: /^Rematch Atlas/ });
  await offer.scrollIntoViewIfNeeded();
  await expect(offer).toBeVisible();
  await offer.click();

  await expect(page.getByText("Rematch Atlas", { exact: true })).toBeVisible();
  await expect(page.getByText("Your first tries: 0")).toBeVisible();
  const card = await playRoundWithKeyboard(page);
  await expect(card.getByTestId("first-try-line")).toHaveText(
    /^Your first try scored 0 here\. (You did better\.|Same as last time\.)$/,
  );
  if ((page.viewportSize()?.width ?? 1000) < 768) {
    const box = (await card.boundingBox())!;
    expect(box.height, "the first-try line keeps the card short").toBeLessThan(
      page.viewportSize()!.height / 2,
    );
  }
  // A reload mid-rematch picks the same rematch back up.
  await card.getByRole("button", { name: "Next photo" }).click();
  await expect(page.getByText("Round 2 of 5", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Rematch Atlas", { exact: true })).toBeVisible();
  await expect(page.getByText("Round 2 of 5", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
