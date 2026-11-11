import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { countryAt } from "../src/lib/countryHit";
import { nudge, type LngLat } from "../src/lib/geo";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG = new Map(
  (
    JSON.parse(readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8")) as {
      id: string;
      country: string;
    }[]
  ).map((p) => [p.id, p.country]),
);

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

const points = (text: string | null) => Number((text ?? "").replace(/[^\d]/g, ""));

/** Arrow presses from `from`, with Shift moving 10°, to the nearest whole-degree point wanted. */
function keysTo(from: LngLat, wanted: (country: string | null) => boolean): string[] {
  let best: string[] | null = null;
  for (let dy = Math.ceil(-85 - from.lat); dy <= Math.floor(85 - from.lat); dy++) {
    for (let dx = -180; dx <= 180; dx++) {
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const cost = Math.floor(ax / 10) + (ax % 10) + Math.floor(ay / 10) + (ay % 10);
      if (best && cost >= best.length) continue;
      const moves: [string, "east" | "west" | "north" | "south", number][] = [
        [dx < 0 ? "Shift+ArrowLeft" : "Shift+ArrowRight", dx < 0 ? "west" : "east", 10],
        [dx < 0 ? "ArrowLeft" : "ArrowRight", dx < 0 ? "west" : "east", 1],
        [dy < 0 ? "Shift+ArrowDown" : "Shift+ArrowUp", dy < 0 ? "south" : "north", 10],
        [dy < 0 ? "ArrowDown" : "ArrowUp", dy < 0 ? "south" : "north", 1],
      ];
      const counts = [Math.floor(ax / 10), ax % 10, Math.floor(ay / 10), ay % 10];
      let at = from;
      const keys: string[] = [];
      moves.forEach(([key, direction, step], i) => {
        for (let n = 0; n < counts[i]!; n++) {
          at = nudge(at, direction, step);
          keys.push(key);
        }
      });
      if (wanted(countryAt(at))) best = keys;
    }
  }
  if (!best) throw new Error("No point on the globe matches");
  return best;
}

/** Drop this pin with the keyboard, walked into a country `wanted` accepts, with G. */
async function pinWithKeyboard(page: Page, wanted: (country: string | null) => boolean) {
  await page.getByRole("application", { name: /Globe/ }).focus();
  await page.keyboard.press("Enter");
  const status = await page.getByText(/^Your pin: /).innerText();
  const m = status.match(/([\d.]+)° ([NS]), ([\d.]+)° ([EW])/)!;
  const from = {
    lat: Number(m[1]) * (m[2] === "S" ? -1 : 1),
    lng: Number(m[3]) * (m[4] === "W" ? -1 : 1),
  };
  for (const key of keysTo(from, wanted)) await page.keyboard.press(key);
  await page.keyboard.press("g");
}

async function photoCountry(page: Page): Promise<string> {
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  const id = await page.locator("main[data-photo]").getAttribute("data-photo");
  return CATALOG.get(id!)!;
}

test("Hot and cold gives three pins with a heading after each miss, against Atlas, and keeps the best", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./");
  await page.getByRole("button", { name: "Games" }).click();
  await page
    .getByRole("dialog", { name: "Ways to play" })
    .getByRole("link", { name: /^Hot and cold/ })
    .click();
  await expect(page).toHaveURL(/\/hot-cold\/?$/, { timeout: 20_000 });
  await expect(page.getByText("Hot and cold: photo 1 of 5")).toBeVisible();

  const clue = page.getByTestId("hot-cold-clue");
  const arrow = page.getByTestId("hot-cold-arrow");
  const score = page.getByTestId("hot-cold-score");
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });

  // Photo 1: three misses. Each clue fits the screen, and the misses stay on the globe.
  let truth = await photoCountry(page);
  const wrong = (c: string | null) => c !== truth;
  await pinWithKeyboard(page, wrong);
  await expect(clue).toHaveText(/^[\d,]+ km off\. Head [a-z-]+\.$/);
  await expectOnScreen(clue);
  await expectOnScreen(arrow);
  await expect(page.locator(".globe-pin--trail")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Tap the globe: pin 2 of 3" })).toBeDisabled();
  await pinWithKeyboard(page, wrong);
  await expect(clue).toHaveText(/^(Warmer|Colder)\. [\d,]+ km off\. Head [a-z-]+\.$/);
  await expect(page.locator(".globe-pin--trail")).toHaveCount(2);
  await pinWithKeyboard(page, wrong);
  await expect(card).toContainText("Three pins, and it was ");
  await expect(page.locator(".globe-pin--trail")).toHaveCount(0);
  await expect(card.getByRole("link", { name: /^Photo: / })).toHaveAttribute(
    "href",
    /^https:\/\/commons\.wikimedia\.org\//,
  );
  await expectOnScreen(card.getByRole("button", { name: "Next photo" }));
  await page.keyboard.press("Enter");

  // Photo 2: a miss, then the country: the second pin's bonus.
  await expect(page.getByText("Hot and cold: photo 2 of 5")).toBeVisible();
  truth = await photoCountry(page);
  await expect(clue).toHaveCount(0);
  const before = points(await score.textContent());
  await pinWithKeyboard(page, (c) => c !== truth);
  await pinWithKeyboard(page, (c) => c === truth);
  await expect(card).toContainText("on pin 2");
  await expect(card).toContainText("+ 500 for 2 pins");
  const earned = points(await card.getByRole("heading", { level: 2 }).textContent());
  await expect(score).toHaveText(new Intl.NumberFormat("en-US").format(before + earned));
  await page.keyboard.press("Enter");

  // Photos 3 to 5: found on the first pin.
  for (let i = 3; i <= 5; i++) {
    await expect(page.getByText(`Hot and cold: photo ${i} of 5`)).toBeVisible();
    truth = await photoCountry(page);
    await pinWithKeyboard(page, (c) => c === truth);
    await expect(card).toContainText("on pin 1");
    await expect(card).toContainText("+ 1,000 for 1 pin");
    if (i === 5) await expect(card.getByRole("button", { name: "See your score" })).toBeFocused();
    await page.keyboard.press("Enter");
  }

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^[\d,]+ points$/);
  const total = points(await heading.textContent());
  await expect(page.getByText("That's your new best!")).toBeVisible();
  await expect(page.getByRole("list", { name: "Your photos" }).getByRole("listitem")).toHaveCount(
    5,
  );
  expect(await page.evaluate(() => localStorage.getItem("whereabout:hot-cold-best"))).toBe(
    String(total),
  );

  // A new game starts at nothing, with the best on the board and in the menu.
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByText("Hot and cold: photo 1 of 5")).toBeVisible();
  await expect(score).toHaveText("0");
  await page.getByRole("button", { name: "Games" }).click();
  await expect(page.getByTestId("best-hot-cold")).toHaveText(
    `Best: ${new Intl.NumberFormat("en-US").format(total)} points`,
  );
  await expect(page.getByRole("dialog").getByText("Playing now")).toBeVisible();
  expect(errors).toEqual([]);
});

test("today's Hot and cold deals the day's photos once, keeps a miss through a reload, and shares pins", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const today = new Date().toISOString().slice(0, 10);

  // The free game links to today's.
  await page.goto("./hot-cold");
  await page.getByRole("link", { name: "Today's game" }).click();
  await expect(page.getByText("Hot and cold, today: photo 1 of 5")).toBeVisible();
  const first = await page.locator("main[data-photo]").getAttribute("data-photo");

  // Everyone on one day gets the same photo: a fresh player is dealt it too.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator("main[data-photo]")).toHaveAttribute("data-photo", first!);

  // A miss can't be taken back: the reload keeps its clue and its pin on the globe.
  const clue = page.getByTestId("hot-cold-clue");
  const truth = await photoCountry(page);
  await pinWithKeyboard(page, (c) => c !== truth);
  const said = (await clue.textContent())!;
  await page.reload();
  await expect(clue).toHaveText(said);
  await expect(page.locator(".globe-pin--trail")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Tap the globe: pin 2 of 3" })).toBeDisabled();

  // Found on the second pin; the next reload picks up at photo 2.
  await pinWithKeyboard(page, (c) => c === truth);
  await expect(page.getByRole("button", { name: "Next photo" })).toBeFocused();
  await page.reload();
  await expect(page.getByText("Hot and cold, today: photo 2 of 5")).toBeVisible();

  for (let i = 2; i <= 5; i++) {
    await expect(page.getByText(`Hot and cold, today: photo ${i} of 5`)).toBeVisible();
    const country = await photoCountry(page);
    await pinWithKeyboard(page, (c) => c === country);
    await expect(
      page.getByRole("button", { name: i === 5 ? "See your score" : "Next photo" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
  }

  // The day's result, again after a reload: never the photos.
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^[\d,]+ points$/);
  const total = await heading.textContent();
  await page.reload();
  await expect(heading).toHaveText(total!);
  await expect(page.getByText(/The next run is dealt in \d+/)).toBeVisible();
  await expect(page.getByRole("application")).toHaveCount(0);

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
    `Whereabout · Hot and cold · ${today}\n🔥 ${total!.replace(" points", "")} of 30,000\n🟥🟩 🟩 🟩 🟩 🟩\n`,
  );
  expect(sent).toMatch(/\/whereabout\/hot-cold\/daily\/?$/);
  expect(sent).not.toContain(first!);

  // The free game's best is its own, and Today counts the day.
  expect(await page.evaluate(() => localStorage.getItem("whereabout:hot-cold-best"))).toBe(null);
  await page.goto("./today");
  const card = page.getByTestId("today-hot-cold");
  await expect(card).toHaveAttribute("data-status", "done");
  await expect(card).toContainText(`${total!.replace(" points", "")} of 30,000`);
  expect(errors).toEqual([]);
});

test("today's game keeps its header and clue on a 320px phone", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./hot-cold/daily");
  const truth = await photoCountry(page);
  await expectOnScreen(page.getByRole("link", { name: "Free games" }));
  await expectOnScreen(page.getByTestId("hot-cold-score"));
  await pinWithKeyboard(page, (c) => c !== truth);
  await expectOnScreen(page.getByTestId("hot-cold-clue"));
  await expectOnScreen(page.getByRole("link", { name: "Free games" }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("a challenge link deals a friend the same five photos, with the points to beat on each", async ({
  page,
}) => {
  test.setTimeout(240_000);
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
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });

  // The sender finds every country with the first pin.
  await page.goto("./hot-cold");
  const dealt: string[] = [];
  for (let i = 1; i <= 5; i++) {
    await expect(page.getByText(`Hot and cold: photo ${i} of 5`)).toBeVisible();
    const truth = await photoCountry(page);
    dealt.push((await page.locator("main[data-photo]").getAttribute("data-photo"))!);
    await pinWithKeyboard(page, (c) => c === truth);
    await expect(card).toContainText("on pin 1");
    await page.keyboard.press("Enter");
  }
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/^[\d,]+ points$/);
  const total = (await heading.textContent())!.replace(" points", "");
  await page.getByRole("button", { name: "Challenge a friend" }).click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(sent).toContain(`Hot and cold: ${total} of 30,000 points, 5 of 5 countries`);
  const link = sent.split("\n").at(-1)!;
  expect(link).toMatch(
    new RegExp(
      `/whereabout/hot-cold/?\\?challenge=${dealt.join("\\.")}_[\\d.]+_1\\.1\\.1\\.1\\.1$`,
    ),
  );

  // The friend opens it in a browser of their own: the same photos, in order, with no best kept.
  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  const subtitle = page.getByText(`A friend's challenge: ${total} to beat, photo 1 of 5`);
  await expect(subtitle).toBeVisible();
  await expectOnScreen(subtitle);
  for (let i = 0; i < 5; i++) {
    await expect(page.locator("main[data-photo]")).toHaveAttribute("data-photo", dealt[i]!);
    const truth = await photoCountry(page);
    // A miss first on the last photo, so the friend's game isn't the sender's.
    if (i === 4) await pinWithKeyboard(page, (c) => c !== truth);
    await pinWithKeyboard(page, (c) => c === truth);
    await expect(page.getByTestId("hot-cold-friend")).toHaveText(
      /^Your friend: [\d,]+ points, found on pin 1\.$/,
    );
    await expectOnScreen(page.getByTestId("hot-cold-friend"));
    await page.keyboard.press("Enter");
  }
  await expect(heading).toHaveText(/^[\d,]+ points$/);
  await expect(
    page.getByText(
      new RegExp(
        `(You won the challenge|Your friend won) by [\\d,]+ points?\\. Your friend scored ${total}\\.`,
      ),
    ),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("whereabout:hot-cold-best"))).toBe(null);

  const back = page.getByRole("button", { name: "Send yours back" });
  await back.scrollIntoViewIfNeeded();
  await expectOnScreen(back);
  await back.click();
  const reply = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(reply).toMatch(/_1\.1\.1\.1\.2$/);

  // Head to head: both results drawn as a 1080px picture, saved, with the reply link copied.
  await page.evaluate(() => ((window as unknown as { sent: string }).sent = ""));
  const picture = page.getByRole("button", { name: "Share head to head" });
  await picture.scrollIntoViewIfNeeded();
  await expectOnScreen(picture);
  const [download] = await Promise.all([page.waitForEvent("download"), picture.click()]);
  expect(download.suggestedFilename()).toBe("whereabout-hot-and-cold-head-to-head.png");
  const png = readFileSync((await download.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1080]);
  await expect(page.getByText("Head to head saved.", { exact: false })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { sent: string }).sent)).toBe(reply);

  // A fresh game drops the link, so a reload doesn't deal the challenge again.
  await page.getByRole("button", { name: "Play a fresh game" }).click();
  await expect(page.getByText("Hot and cold: photo 1 of 5")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(errors).toEqual([]);
});

test("a broken Hot and cold challenge says so and deals a fresh game", async ({ page }) => {
  await page.goto("./hot-cold?challenge=wm001.wm002_1_1");
  await expect(page.getByText(/That challenge link was cut short/)).toBeVisible();
  await expect(page.getByText("Hot and cold: photo 1 of 5")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tap the globe: pin 1 of 3" })).toBeVisible();
});
