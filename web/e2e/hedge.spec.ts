import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG: { id: string; country: string }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const COUNTRY = new Map(CATALOG.map((p) => [p.id, p.country]));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

/** The photo on screen and which of the four rows (0 to 3) is its real country. */
async function onScreen(page: Page) {
  const main = page.locator("main[data-photo]");
  await expect(main).toHaveAttribute("data-photo", /.+/);
  await expect(page.getByTestId("hedge-option")).toHaveCount(4);
  const id = (await main.getAttribute("data-photo"))!;
  const country = COUNTRY.get(id)!;
  const offered = await page
    .getByTestId("hedge-option")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-country")!));
  const labels = await page
    .getByRole("button", { name: /^Put a chip on / })
    .evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label")!.slice("Put a chip on ".length)),
    );
  return { id, right: offered.indexOf(country), labels };
}

test("Hedge your bets scores a spread by tap and by key against Atlas's, and keeps the best", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./");
  await page.getByRole("button", { name: "Games" }).click();
  await page
    .getByRole("dialog", { name: "Ways to play" })
    .getByRole("link", { name: /^Hedge your bets/ })
    .click();
  await expect(page).toHaveURL(/\/hedge\/?$/, { timeout: 20_000 });

  const { width, height } = page.viewportSize()!;
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  const bet = page.getByRole("button", { name: "Bet", exact: true });
  for (let n = 0; n < 5; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 5`, { exact: true })).toBeVisible();
    const { right, labels } = await onScreen(page);
    expect(right, "the photo's country is offered").toBeGreaterThanOrEqual(0);
    await expect(page.getByTestId("hedge-left")).toHaveText("10 chips to place");
    await expect(bet).toBeDisabled();
    // The bet, and every row's buttons, sit on screen under the photo.
    for (const b of [bet, page.getByRole("button", { name: /^Put a chip on / }).last()]) {
      const box = (await b.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }

    if (n === 0) {
      // Tap: everything on the right country.
      const plus = page.getByRole("button", { name: `Put a chip on ${labels[right]}` });
      for (let i = 0; i < 10; i++) await plus.click();
      await expect(plus).toBeDisabled();
      await bet.click();
      await expect(card.getByTestId("hedge-points")).toContainText("You scored 1,000 of 1,000");
    } else if (n === 1) {
      // Keys: all in on a wrong country, with one taken back and put on again.
      const wrong = String(((right + 1) % 4) + 1);
      for (let i = 0; i < 10; i++) await page.keyboard.press(wrong);
      await page.keyboard.press("Backspace");
      await expect(page.getByTestId("hedge-left")).toHaveText("1 chip to place");
      await page.keyboard.press(wrong);
      await page.keyboard.press("g");
      await expect(card.getByTestId("hedge-points")).toContainText("You scored 0 of 1,000");
    } else {
      // An even-as-can-be spread: three, three, two, two.
      for (const [i, chips] of [3, 3, 2, 2].entries()) {
        for (let c = 0; c < chips; c++) await page.keyboard.press(String(i + 1));
      }
      await page.keyboard.press("g");
      await expect(card.getByTestId("hedge-points")).toContainText(
        `You scored ${right < 2 ? 670 : 570} of 1,000`,
      );
    }
    await expect(card.getByTestId("hedge-both")).toHaveCount(4);
    await expect(card.getByTestId("hedge-both").nth(right)).toContainText("the right country");
    const next = card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" });
    await expect(next).toBeFocused();
    const nextBox = (await next.boundingBox())!;
    expect(nextBox.y + nextBox.height).toBeLessThanOrEqual(height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.keyboard.press("Enter");
  }

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/ points$/);
  const points = (await page.getByRole("heading", { level: 1 }).textContent())!.replace(
    / points$/,
    "",
  );
  await expect(page.getByTestId("hedge-end")).toContainText(/^Atlas scored [\d,]+\./);
  await expect(page.getByTestId("hedge-row")).toHaveCount(5);
  await expect(page.getByText("That's your new best!")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("whereabout:hedge-best"))).toBe(
    points.replace(/,/g, ""),
  );

  // A new game, with the best in the Games menu.
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByText("Photo 1 of 5", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Games" }).click();
  await expect(page.getByTestId("best-hedge")).toHaveText(`Best: ${points} points`);
  await expect(page.getByRole("dialog").getByText("Playing now")).toBeVisible();
  expect(errors).toEqual([]);
});

test("your bets show on Your map's odds, by the chips on each country, beside Atlas's", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./hedge");
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  const bands = ["long", "maybe", "likely", "sure"] as const;
  const bandOf = (c: number) => (c <= 2 ? 0 : c <= 4 ? 1 : c <= 7 ? 2 : 3);
  const blank = () => bands.map(() => ({ bets: 0, chips: 0, right: 0 }));
  const expected = { you: blank(), atlas: blank() };
  for (let n = 0; n < 3; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 5`, { exact: true })).toBeVisible();
    const { right } = await onScreen(page);
    // All in on the right country, all in on a wrong one, then three, three, two, two.
    const spread =
      n === 0
        ? [0, 1, 2, 3].map((i) => (i === right ? 10 : 0))
        : n === 1
          ? [0, 1, 2, 3].map((i) => (i === (right + 1) % 4 ? 10 : 0))
          : [3, 3, 2, 2];
    for (const [i, chips] of spread.entries()) {
      for (let c = 0; c < chips; c++) await page.keyboard.press(String(i + 1));
    }
    await page.keyboard.press("g");
    const both = card.getByTestId("hedge-both");
    await expect(both).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      for (const side of ["you", "atlas"] as const) {
        const chips = Number(await both.nth(i).getAttribute(`data-${side}`));
        if (side === "you") expect(chips).toBe(spread[i]);
        if (chips === 0) continue;
        const b = expected[side][bandOf(chips)]!;
        b.bets++;
        b.chips += chips;
        if (i === right) b.right++;
      }
    }
    if (n < 2) await card.getByRole("button", { name: "Next photo" }).click();
  }

  // Leave mid-game: all three bets already count.
  await page.goto("./map");
  const section = page.getByTestId("hedge-odds");
  await expect(section.getByRole("heading", { name: "Your odds" })).toBeVisible();
  await expect(page.getByTestId("hedge-odds-line")).toContainText(
    /^Over 3 photos, your chips were/,
  );
  for (const [i, b] of bands.entries()) {
    for (const side of ["you", "atlas"] as const) {
      const row = page.getByTestId(`hedge-odds-${b}-${side}`);
      const want = expected[side][i]!;
      await expect(row).toHaveAttribute("data-bets", String(want.bets));
      await expect(row).toHaveAttribute("data-chips", String(want.chips));
      await expect(row).toHaveAttribute("data-right", String(want.right));
    }
  }
  const box = (await page.getByTestId("hedge-odds-sure").boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(321);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await section.getByRole("link", { name: "Play Hedge your bets" }).click();
  await expect(page).toHaveURL(/\/hedge\/?$/);
});

test("on a 320px phone the photo, the four countries and the bet fit without scrolling", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./hedge");
  const { right } = await onScreen(page);
  const photo = (await page.getByTestId("hedge-photo").boundingBox())!;
  expect(photo.height, "the photo keeps real room").toBeGreaterThan(100);
  const bet = page.getByRole("button", { name: "Bet", exact: true });
  const box = (await bet.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(568);
  for (let i = 0; i < 10; i++) await page.keyboard.press(String(right + 1));
  await bet.tap();
  const next = page.getByRole("button", { name: "Next photo" });
  await expect(next).toBeVisible();
  const nextBox = (await next.boundingBox())!;
  expect(nextBox.y + nextBox.height).toBeLessThanOrEqual(568);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("today's Hedge your bets deals the day once, keeps each bet through a reload, and shares points", async ({
  page,
}) => {
  test.setTimeout(180_000);
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
  const day = new Date().toISOString().slice(0, 10);

  // From a free game to today's.
  await page.goto("./hedge");
  await page.getByRole("link", { name: "Today's game" }).click();
  await expect(page).toHaveURL(/\/hedge\/daily\/?$/);
  await expect(page.getByText("Hedge your bets today: spread ten chips")).toBeVisible();
  await expect(page.getByText("Best", { exact: true })).toHaveCount(0);

  // Every photo all in on its real country, so the total is known: 5,000.
  const dealt: { id: string; offered: string[] }[] = [];
  const allIn = async (n: number) => {
    await expect(page.getByText(`Photo ${n + 1} of 5`, { exact: true })).toBeVisible();
    const { id, right } = await onScreen(page);
    const offered = await page
      .getByTestId("hedge-option")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-country")!));
    dealt.push({ id, offered });
    for (let i = 0; i < 10; i++) await page.keyboard.press(String(right + 1));
    await page.keyboard.press("g");
    await expect(card.getByTestId("hedge-points")).toContainText("You scored 1,000 of 1,000");
    await card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }).click();
  };
  await allIn(0);
  await allIn(1);

  // A reload can't take a bet back: it picks up at the third photo, the points kept.
  await page.reload();
  await expect(page.getByText("Photo 3 of 5", { exact: true })).toBeVisible();
  await expect(page.locator("dd", { hasText: /^2,000$/ })).toBeVisible();
  for (let n = 2; n < 5; n++) await allIn(n);
  expect(new Set(dealt.map((d) => d.id)).size).toBe(5);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("5,000 points");
  await expect(page.getByText(`Hedge your bets · today's game · ${day}`)).toBeVisible();
  const summary = page.getByText(/^Atlas's probabilities scored [\d,]+\./);
  const atlas = (await summary.textContent())!.match(/scored ([\d,]+)\./)![1]!;
  await expect(page.getByTestId("hedge-row")).toHaveCount(5);
  await page.getByRole("button", { name: "Share today's game" }).click();
  await expect(page.getByRole("status")).toHaveText("Result copied. Paste it anywhere.");
  const sent = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(sent).toContain(`Whereabout · Hedge your bets · ${day}`);
  expect(sent).toContain(`🎲 5,000 of 5,000 · Atlas's probabilities ${atlas}`);
  expect(sent).toContain("🟩".repeat(5));
  expect(sent).toMatch(/\/hedge\/daily\/$/);
  // No place and no country: the share spoils no photo.
  for (const { id, offered } of dealt) {
    expect(sent).not.toContain(id);
    for (const c of offered) expect(sent).not.toContain(c);
  }
  // The free game's best is untouched.
  expect(await page.evaluate(() => localStorage.getItem("whereabout:hedge-best"))).toBe(null);

  // The day is never dealt again, and a second visit deals the same countries in the same order.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("5,000 points");
  await expect(page.getByRole("button", { name: "Bet", exact: true })).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem("whereabout:hedge-daily"));
  await page.reload();
  const again = await onScreen(page);
  expect(again.id).toBe(dealt[0]!.id);
  expect(
    await page
      .getByTestId("hedge-option")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-country")!)),
  ).toEqual(dealt[0]!.offered);
  expect(errors).toEqual([]);
});

test("today's Hedge your bets fits a 320px phone, its link to free games on screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const [path, link] of [
    ["./hedge", "Today's game"],
    ["./hedge/daily", "Free games"],
  ] as const) {
    await page.goto(path);
    await onScreen(page);
    const linkBox = (await page.getByRole("link", { name: link }).boundingBox())!;
    expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(321);
    const bet = (await page.getByRole("button", { name: "Bet", exact: true }).boundingBox())!;
    expect(bet.y + bet.height).toBeLessThanOrEqual(569);
    expect((await page.getByTestId("hedge-photo").boundingBox())!.height).toBeGreaterThan(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  }
});

test("a Hedge your bets challenge deals a friend the same five and countries, with the sender's chips shown after theirs", async ({
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
  const sent = () => page.evaluate(() => (window as unknown as { sent: string }).sent);
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  const offered = () =>
    page
      .getByTestId("hedge-option")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-country")!));

  // The sender goes all in on the right country every time: 5,000 to beat.
  await page.goto("./hedge");
  const game: { id: string; offered: string[]; right: number }[] = [];
  for (let n = 0; n < 5; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 5`, { exact: true })).toBeVisible();
    const { id, right } = await onScreen(page);
    game.push({ id, offered: await offered(), right });
    for (let i = 0; i < 10; i++) await page.keyboard.press(String(right + 1));
    await page.keyboard.press("g");
    await expect(card.getByTestId("hedge-friend-line")).toHaveCount(0);
    await page.keyboard.press("Enter");
  }
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("5,000 points");
  await page.getByRole("button", { name: "Challenge a friend" }).click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const message = await sent();
  expect(message.split("\n")[0]).toMatch(
    /^Whereabout · Hedge your bets: 5,000 points\. Atlas's probabilities: [\d,]+\.$/,
  );
  const link = message.split("\n").at(-1)!;
  const bets = game.map((g) => g.offered.map((_, i) => (i === g.right ? "a" : "0")).join(""));
  expect(link).toMatch(
    new RegExp(
      `/whereabout/hedge/?\\?challenge=[0-9a-z]+_${game.map((g) => g.id).join("\\.")}_${bets.join("\\.")}$`,
    ),
  );
  for (const country of new Set(game.flatMap((g) => g.offered))) {
    expect(message).not.toContain(`_${country}`);
  }

  // The friend, with nothing kept, gets the same five and the same countries in the same order,
  // and spreads three, three, two, two on each.
  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  await expect(page.getByTestId("hedge-challenge")).toHaveText("5,000");
  await expect(page.getByText("Best", { exact: true })).toHaveCount(0);
  let mine = 0;
  for (let n = 0; n < 5; n++) {
    const g = game[n]!;
    await expect(page.locator("main[data-photo]")).toHaveAttribute("data-photo", g.id);
    await expect(page.getByTestId("hedge-friend-score")).toHaveText(
      (1000 * n).toLocaleString("en-US"),
    );
    const { labels } = await onScreen(page);
    expect(await offered()).toEqual(g.offered);
    await expect(card).toHaveCount(0);
    for (const [i, chips] of [3, 3, 2, 2].entries()) {
      for (let c = 0; c < chips; c++) await page.keyboard.press(String(i + 1));
    }
    await page.keyboard.press("g");
    mine += g.right < 2 ? 670 : 570;
    await expect(card.getByTestId("hedge-friend-line")).toHaveText(
      `Friend: Your friend had 10 chips on ${labels[g.right]}: 1,000.`,
    );
    await expect(card.getByTestId("hedge-friend-chips").nth(g.right)).toContainText("10 chips");
    await page.keyboard.press("Enter");
  }
  const total = mine.toLocaleString("en-US");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${total} points`);
  await expect(page.getByTestId("hedge-challenge-line")).toHaveText(
    `Your friend's 5,000 wins, by ${(5000 - mine).toLocaleString("en-US")}.`,
  );
  await expect(page.getByTestId("hedge-row-friend")).toHaveCount(5);
  await expect(page.getByTestId("hedge-row-friend").first()).toHaveText(
    "Friend: 10 chips on it, 1,000.",
  );
  expect(await page.evaluate(() => localStorage.getItem("whereabout:hedge-best"))).toBeNull();

  await page.getByRole("button", { name: "Send yours back" }).click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const reply = await sent();
  expect(reply.split("\n")[1]).toBe("Your 5,000 wins this time. Try them again?");
  expect(reply.split("\n").at(-1)).toMatch(
    new RegExp(`_${game.map((g) => g.id).join("\\.")}_${game.map(() => "3322").join("\\.")}$`),
  );

  // Head to head: both games as a 1080px picture, saved, with the reply link copied.
  await page.evaluate(() => ((window as unknown as { sent: string }).sent = ""));
  const picture = page.getByRole("button", { name: "Share head to head" });
  const [download] = await Promise.all([page.waitForEvent("download"), picture.click()]);
  expect(download.suggestedFilename()).toBe("whereabout-hedge-your-bets-head-to-head.png");
  const png = readFileSync((await download.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1080]);
  expect(await sent()).toBe(reply);

  // A fresh game drops the link.
  await page.getByRole("button", { name: "Play a fresh game" }).click();
  await expect(page.getByText("Photo 1 of 5", { exact: true })).toBeVisible();
  await expect(page.getByTestId("hedge-challenge")).toHaveCount(0);
  expect(new URL(page.url()).search).toBe("");
  expect(errors).toEqual([]);
});

test("a broken Hedge your bets challenge says so and deals a fresh game", async ({ page }) => {
  await page.goto("./hedge?challenge=7_wm001_a000");
  await expect(page.getByText(/That challenge link was cut short/)).toBeVisible();
  await expect(page.getByTestId("hedge-challenge")).toHaveCount(0);
  await expect(page.getByText("Photo 1 of 5", { exact: true })).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
});

test("a Hedge your bets challenge's answer card and end buttons fit a 320px phone", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 320, height: 568 });
  // A free game first, to get a real link; then play it as the friend.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (t: string) => void ((window as unknown as { sent: string }).sent = t),
      },
      configurable: true,
    });
  });
  await page.goto("./hedge");
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  for (let n = 0; n < 5; n++) {
    await onScreen(page);
    for (let i = 0; i < 10; i++) await page.keyboard.press("1");
    await page.keyboard.press("g");
    await page.keyboard.press("Enter");
  }
  await page.getByRole("button", { name: "Challenge a friend" }).click();
  const link = (await page.evaluate(() => (window as unknown as { sent: string }).sent))
    .split("\n")
    .at(-1)!;
  await page.goto(link);
  await expect(page.getByTestId("hedge-challenge")).toHaveText(/^[\d,]+$/);
  for (let n = 0; n < 5; n++) {
    await onScreen(page);
    for (let i = 0; i < 10; i++) await page.keyboard.press("2");
    await page.keyboard.press("g");
    await expect(card.getByTestId("hedge-friend-line")).toBeVisible();
    const next = card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" });
    const box = (await next.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(569);
    for (const row of await card.getByTestId("hedge-both").all()) {
      const r = (await row.boundingBox())!;
      expect(r.x + r.width).toBeLessThanOrEqual(321);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await page.keyboard.press("Enter");
  }
  for (const label of ["Play a fresh game", "Send yours back", "Share head to head"]) {
    const button = page.getByRole("button", { name: label });
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(321);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
