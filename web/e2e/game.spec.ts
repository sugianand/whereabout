import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { continentOf } from "../src/lib/continents";

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
  await expect(page.getByRole("listitem")).toHaveCount(5);

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
  expect(errors).toEqual([]);
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

  await page.getByRole("button", { name: "Zoom in on the globe" }).click();
  await expect(frame).not.toHaveAttribute("data-zoom", "1.40");

  // Drag to spin the globe somewhere else.
  const box = (await frame.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - box.width / 4, cy + 20, { steps: 8 });
  await page.mouse.up();

  await page.getByRole("button", { name: "Recenter the globe" }).click();
  await expect(frame).toHaveAttribute("data-zoom", "1.40");
  await expect(frame).toHaveAttribute("data-padding", "0,0,0,0");
  // Spinning is not a pin drop.
  await expect(page.getByText("Place your pin", { exact: true })).toBeVisible();
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
