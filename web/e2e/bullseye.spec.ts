import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { TODAY_GAMES } from "../src/lib/game/today";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG = new Map(
  (
    JSON.parse(readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8")) as {
      id: string;
      lng: number;
      lat: number;
    }[]
  ).map((p) => [p.id, { lng: p.lng, lat: p.lat }]),
);

// Kilometres: a language region that reads distances in them.
test.use({ locale: "de-DE" });

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

async function expectOnScreen(locator: Locator) {
  const { width, height } = locator.page().viewportSize()!;
  const box = (await locator.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
}

/** Let the answer card finish rising into place (`.wb-card`'s animation) before measuring it. */
async function settled(card: Locator) {
  await card.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

async function photoAt(page: Page) {
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  const id = await page.locator("main[data-photo]").getAttribute("data-photo");
  return CATALOG.get(id!)!;
}

/**
 * Drop the pin with the keyboard and walk it with the arrows to within half a degree of
 * `target`'s latitude and longitude (Shift moves 10°).
 */
async function pinNear(page: Page, target: { lng: number; lat: number }) {
  await page.getByRole("application", { name: /Globe/ }).focus();
  await page.keyboard.press("Enter");
  const status = await page.getByText(/^Your pin: /).innerText();
  const m = status.match(/([\d.]+)° ([NS]), ([\d.]+)° ([EW])/)!;
  const lat = Number(m[1]) * (m[2] === "S" ? -1 : 1);
  const lng = Number(m[3]) * (m[4] === "W" ? -1 : 1);
  let dx = Math.round(target.lng - lng);
  if (dx > 180) dx -= 360;
  if (dx < -180) dx += 360;
  const dy = Math.round(target.lat - lat);
  const steps: [number, string, string][] = [
    [dx, "ArrowRight", "ArrowLeft"],
    [dy, "ArrowUp", "ArrowDown"],
  ];
  for (const [d, plus, minus] of steps) {
    const key = d < 0 ? minus : plus;
    const n = Math.abs(d);
    for (let i = 0; i < Math.floor(n / 10); i++) await page.keyboard.press(`Shift+${key}`);
    for (let i = 0; i < n % 10; i++) await page.keyboard.press(key);
  }
}

test("Bullseye bets a ring around each pin: inside pays the ring, outside nothing, against Atlas's rings", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./");
  await page.getByRole("button", { name: "Games" }).click();
  await page
    .getByRole("dialog", { name: "Ways to play" })
    .getByRole("link", { name: /^Bullseye/ })
    .click();
  await expect(page).toHaveURL(/\/bullseye\/?$/, { timeout: 20_000 });
  await expect(page.getByText("Bullseye: photo 1 of 5")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tap the globe to pin the photo" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: /^750 km/ })).toBeChecked();

  const score = page.getByTestId("bullseye-score");
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });

  // Photo 1: the pin on the place and the tightest ring, picked with 1, bet with G.
  let truth = await photoAt(page);
  await pinNear(page, truth);
  await page.keyboard.press("1");
  await expect(page.getByRole("radio", { name: /^250 km/ })).toBeChecked();
  const bet = page.getByRole("button", { name: "Bet the 250 km ring for 1,000" });
  await expect(bet).toBeEnabled();
  await expectOnScreen(bet);
  await expectOnScreen(page.getByRole("radio", { name: /^5,000 km/ }));
  await page.keyboard.press("g");
  await expect(card).toContainText("Inside your ring");
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("1,000 points");
  await expect(card.getByTestId("bullseye-you")).toHaveText(
    // Under 10 km the distance reads to a tenth, and under 1 km in metres.
    /^You: Inside the 250 km ring, [\d,.]+ k?m off: 1,000 points\.$/,
  );
  // Atlas bets on every photo it guessed, its ring from its own confidence.
  await expect(card.getByTestId("bullseye-atlas")).toHaveText(
    /^Atlas \(dashed ring\): (Inside|Outside) the [\d,]+ km ring, [\d,.]+ k?m off: ([\d,]+ points|no points)\.$/,
  );
  await expect(score).toHaveText("1,000");
  await expectOnScreen(card.getByRole("button", { name: "Next photo" }));
  await page.keyboard.press("Enter");

  // Photo 2: 40° of latitude off on the 250 km ring, tapped: nothing.
  await expect(page.getByText("Bullseye: photo 2 of 5")).toBeVisible();
  // The ring bet last time is where the next photo starts.
  await expect(page.getByRole("radio", { name: /^250 km/ })).toBeChecked();
  truth = await photoAt(page);
  await pinNear(page, { lng: truth.lng, lat: truth.lat > 0 ? truth.lat - 40 : truth.lat + 40 });
  await page.getByRole("button", { name: "Bet the 250 km ring for 1,000" }).click();
  await expect(card).toContainText("Outside your ring");
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("0 points");
  await expect(score).toHaveText("1,000");
  await page.keyboard.press("Enter");

  // Photos 3 to 5: on the place, the widest ring, picked by tap.
  for (let i = 3; i <= 5; i++) {
    await expect(page.getByText(`Bullseye: photo ${i} of 5`)).toBeVisible();
    truth = await photoAt(page);
    await pinNear(page, truth);
    await page.getByText("5,000 km", { exact: true }).click();
    await page.keyboard.press("g");
    await expect(card.getByRole("heading", { level: 2 })).toHaveText("100 points");
    if (i === 5) await expect(card.getByRole("button", { name: "See your score" })).toBeFocused();
    await page.keyboard.press("Enter");
  }

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("1,300 points");
  await expect(page.getByText(/Your rings held 4 of 5 photos\./)).toContainText(
    "That's your new best!",
  );
  await expect(page.getByTestId("bullseye-atlas-total")).toHaveText(/^Atlas scored [\d,]+/);
  await expect(page.getByRole("list", { name: "Your photos" }).getByRole("listitem")).toHaveCount(
    5,
  );
  expect(await page.evaluate(() => localStorage.getItem("whereabout:bullseye-best"))).toBe("1300");

  // A new game starts at nothing, with the best in the Games menu.
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByText("Bullseye: photo 1 of 5")).toBeVisible();
  await expect(score).toHaveText("0");
  await page.getByRole("button", { name: "Games" }).click();
  await expect(page.getByTestId("best-bullseye")).toHaveText("Best: 1,300 points");
  await expect(page.getByRole("dialog").getByText("Playing now")).toBeVisible();
  expect(errors).toEqual([]);
});

test("today's Bullseye deals the day's five once, picks up after a reload, and shares the rings", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const today = new Date().toISOString().slice(0, 10);

  // The free game links to today's.
  await page.goto("./bullseye");
  await page.getByRole("link", { name: "Today's game" }).click();
  await expect(page).toHaveURL(/\/bullseye\/daily\/?$/, { timeout: 20_000 });
  await expect(page.getByText("Bullseye, today: photo 1 of 5")).toBeVisible();
  const first = await page.locator("main[data-photo]").getAttribute("data-photo");

  // Everyone on one day gets the same photos: a fresh player is dealt the same first one.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("main[data-photo]")).toHaveAttribute("data-photo", first!);

  const score = page.getByTestId("bullseye-score");
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });

  // Photo 1 on the place with the tightest ring; once bet, a reload can't take it back.
  let truth = await photoAt(page);
  await pinNear(page, truth);
  await page.keyboard.press("1");
  await page.keyboard.press("g");
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("1,000 points");
  await page.reload();
  await expect(page.getByText("Bullseye, today: photo 2 of 5")).toBeVisible();
  await expect(score).toHaveText("1,000");
  await expect(page.getByRole("radio", { name: /^250 km/ })).toBeChecked();
  await expect(page.getByText("Best", { exact: true })).toHaveCount(0);

  // Photos 2 to 5 on the place with the widest ring.
  for (let i = 2; i <= 5; i++) {
    await expect(page.getByText(`Bullseye, today: photo ${i} of 5`)).toBeVisible();
    truth = await photoAt(page);
    await pinNear(page, truth);
    await page.keyboard.press("4");
    await page.keyboard.press("g");
    await expect(card.getByRole("heading", { level: 2 })).toHaveText("100 points");
    await page.keyboard.press("Enter");
  }

  // The day's result, again after a reload: never dealt a second time.
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText("1,400 points");
  await page.reload();
  await expect(heading).toHaveText("1,400 points");
  await expect(page.getByText(/Your rings held 5 of 5 photos\..*The next game is dealt in \d+/)).toBeVisible();
  await expect(page.getByRole("application")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Your photos" }).getByRole("listitem")).toHaveCount(5);

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
  expect(sent).toContain(
    `Whereabout · Bullseye · ${today}\n🎯 1,400 of 5,000 · 5 of 5 rings held\n🟩 250 km  🟩 5,000 km  🟩 5,000 km  🟩 5,000 km  🟩 5,000 km\n`,
  );
  expect(sent).toMatch(/\/whereabout\/bullseye\/daily\/?$/);
  expect(sent).not.toContain(first!);

  // The free game's best is its own, and Today counts the day once Bullseye is one of its games.
  expect(await page.evaluate(() => localStorage.getItem("whereabout:bullseye-best"))).toBe(null);
  const since = TODAY_GAMES.find((g) => g.id === "bullseye")!.since!;
  if (today >= since) {
    await page.goto("./today");
    const today_ = page.getByTestId("today-bullseye");
    await expect(today_).toHaveAttribute("data-status", "done");
    await expect(today_).toContainText("1,400 of 5,000");
  }
  expect(errors).toEqual([]);
});

test("the ring buttons and the bet fit a 320px phone, today's game too", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 640 });
  for (const [path, link] of [
    ["./bullseye", "Today's game"],
    ["./bullseye/daily", "Free games"],
  ] as const) {
    await page.goto(path);
    await photoAt(page);
    for (const name of [/^250 km/, /^750 km/, /^2,000 km/, /^5,000 km/]) {
      await expectOnScreen(page.getByRole("radio", { name }).locator(".."));
    }
    await expectOnScreen(page.getByRole("link", { name: link }));
    await expectOnScreen(page.getByTestId("bullseye-score"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  }
});

test("a Bullseye challenge deals a friend the same five, with the sender's ring shown after theirs", async ({
  page,
}) => {
  test.setTimeout(300_000);
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
  const sent = () => page.evaluate(() => (window as unknown as { sent: string }).sent);
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });

  // The sender pins each photo where the keyboard first drops the pin, on the widest ring.
  await page.goto("./bullseye");
  const game: string[] = [];
  for (let i = 1; i <= 5; i++) {
    await expect(page.getByText(`Bullseye: photo ${i} of 5`)).toBeVisible();
    await photoAt(page);
    game.push((await page.locator("main[data-photo]").getAttribute("data-photo"))!);
    await page.getByRole("application", { name: /Globe/ }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("4");
    await page.keyboard.press("g");
    await card.getByRole("button", { name: /Next photo|See your score/ }).click();
  }
  const total = (await page.getByRole("heading", { level: 1 }).innerText()).replace(" points", "");
  await page.getByRole("button", { name: "Challenge a friend" }).click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const message = await sent();
  expect(message).toMatch(new RegExp(`^Whereabout · Bullseye: ${total} points, \\d of 5 rings held\\.`));
  const link = message.split("\n").at(-1)!;
  expect(link).toMatch(
    new RegExp(`/whereabout/bullseye/?\\?challenge=${game.join("\\.")}_44444_\\d+(\\.\\d+){4}$`),
  );

  // The friend, with nothing kept, gets the same five and pins each on the place, tightest ring.
  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  await expect(page.getByTestId("bullseye-challenge")).toHaveText(
    `A friend's challenge: ${total} to beat`,
  );
  for (let i = 0; i < 5; i++) {
    await expect(page.locator("main[data-photo]")).toHaveAttribute("data-photo", game[i]!);
    const truth = await photoAt(page);
    await expect(page.getByTestId("bullseye-friend")).toHaveCount(0);
    await pinNear(page, truth);
    await page.keyboard.press("1");
    await page.keyboard.press("g");
    await expect(card.getByTestId("bullseye-friend")).toHaveText(
      /^Friend: (Inside the 5,000 km ring, [\d,]+ km off: 100 points|Outside the 5,000 km ring, [\d,]+ km off: no points)\.$/,
    );
    await settled(card);
    await expectOnScreen(card.getByRole("button", { name: /Next photo|See your score/ }));
    await page.keyboard.press("Enter");
  }
  await expect(page.getByTestId("bullseye-challenge-line")).toHaveText(
    /^(You beat your friend's|Your friend's|A dead heat)/,
  );
  await expect(page.getByTestId("bullseye-row")).toHaveCount(5);
  await expect(page.getByTestId("bullseye-row").first()).toContainText("Friend: ");
  expect(await page.evaluate(() => localStorage.getItem("whereabout:bullseye-best"))).toBeNull();

  await page.getByRole("button", { name: "Send yours back" }).click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const reply = await sent();
  expect(reply.split("\n").at(-1)).toMatch(new RegExp(`\\?challenge=${game.join("\\.")}_11111_`));

  // Head to head: both games as a 1080px picture, saved, with the reply link copied.
  await page.evaluate(() => ((window as unknown as { sent: string }).sent = ""));
  const picture = page.getByRole("button", { name: "Share head to head" });
  const [download] = await Promise.all([page.waitForEvent("download"), picture.click()]);
  expect(download.suggestedFilename()).toBe("whereabout-bullseye-head-to-head.png");
  const png = readFileSync((await download.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1080]);
  expect(await sent()).toBe(reply);
  const kept = await page.evaluate(() => localStorage.getItem("whereabout:head-to-head"));
  expect(JSON.parse(kept!)).toEqual([expect.objectContaining({ game: "Bullseye" })]);

  // A fresh game drops the link.
  await page.getByRole("button", { name: "Play a fresh game" }).click();
  await expect(page.getByText("Bullseye: photo 1 of 5")).toBeVisible();
  await expect(page.getByTestId("bullseye-challenge")).toHaveCount(0);
  expect(new URL(page.url()).search).toBe("");
  expect(errors).toEqual([]);
});

test("a broken Bullseye challenge says so and deals a fresh game", async ({ page }) => {
  await page.goto("./bullseye?challenge=wm001_111_1");
  await expect(page.getByText(/That challenge link was cut short/)).toBeVisible();
  await expect(page.getByTestId("bullseye-challenge")).toHaveCount(0);
  await expect(page.getByText("Bullseye: photo 1 of 5")).toBeVisible();
});

test("a Bullseye challenge's answer card and end buttons fit a 320px phone", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 320, height: 568 });
  const ids = [...CATALOG.keys()].slice(0, 5);
  await page.goto(`./bullseye?challenge=${ids.join(".")}_12341_120.900.1999.251.20050`);
  await expect(page.getByTestId("bullseye-challenge")).toHaveText(
    "A friend's challenge: 1,350 to beat",
  );
  await expectOnScreen(page.getByTestId("bullseye-friend-score"));
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  for (let i = 0; i < 5; i++) {
    await photoAt(page);
    await page.getByRole("application", { name: /Globe/ }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("g");
    await expect(card.getByTestId("bullseye-friend")).toBeVisible();
    await settled(card);
    await expectOnScreen(card);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await page.keyboard.press("Enter");
  }
  for (const name of ["Play a fresh game", "Send yours back", "Share head to head"]) {
    const button = page.getByRole("button", { name });
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(321);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("Your map shows how often each of your rings held against Atlas's, counted bet by bet", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 320, height: 640 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./bullseye");
  await expect(page.getByText("Bullseye: photo 1 of 5")).toBeVisible();
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });

  // Photo 1 held on the tightest ring, photo 2 missed on it.
  let truth = await photoAt(page);
  await pinNear(page, truth);
  await page.keyboard.press("1");
  await page.keyboard.press("g");
  await expect(card).toContainText("Inside your ring");
  const atlasFirst = await card.getByTestId("bullseye-atlas").innerText();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Bullseye: photo 2 of 5")).toBeVisible();
  truth = await photoAt(page);
  await pinNear(page, { lng: truth.lng, lat: truth.lat > 0 ? truth.lat - 40 : truth.lat + 40 });
  await page.keyboard.press("g");
  await expect(card).toContainText("Outside your ring");
  const atlasSecond = await card.getByTestId("bullseye-atlas").innerText();

  // Leaving mid-game still counts the two photos bet.
  await page.goto("./map");
  const section = page.getByTestId("calibration");
  await expect(section.getByRole("heading", { name: "Your calibration" })).toBeVisible();
  await expect(page.getByTestId("calibration-line")).toContainText(
    "Your rings held 1 of 2 photos (50%)",
  );
  const tight = page.getByTestId("calibration-ring-0-you");
  await expect(tight).toHaveAttribute("data-bet", "2");
  await expect(tight).toHaveAttribute("data-held", "1");
  await expect(tight.getByRole("meter", { name: "You: the 250 km ring held" })).toHaveAttribute(
    "aria-valuenow",
    "50",
  );
  await expect(page.getByTestId("calibration-ring-3-you")).toContainText("Not bet yet");

  // Atlas's rings: as many bets in all as photos it played, held as its answer cards said.
  const atlasBets = [atlasFirst, atlasSecond].filter((t) => t.startsWith("Atlas"));
  const atlasHeld = atlasBets.filter((t) => t.includes(": Inside")).length;
  let bet = 0;
  let held = 0;
  for (let i = 0; i < 4; i++) {
    const bar = page.getByTestId(`calibration-ring-${i}-atlas`);
    bet += Number(await bar.getAttribute("data-bet"));
    held += Number(await bar.getAttribute("data-held"));
  }
  expect(bet).toBe(atlasBets.length);
  expect(held).toBe(atlasHeld);

  // The chart fits a 320px phone with no sideways scroll.
  await section.scrollIntoViewIfNeeded();
  const scrolls = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(scrolls).toBe(false);
  await page.getByRole("link", { name: "Play Bullseye" }).click();
  await expect(page).toHaveURL(/\/bullseye\/?$/);
  expect(errors).toEqual([]);
});
