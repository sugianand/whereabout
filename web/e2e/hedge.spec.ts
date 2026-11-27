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
