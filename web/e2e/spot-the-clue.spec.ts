import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const ATLAS: { guesses: Record<string, { looked?: { grid: number; cells: number[] } }> } =
  JSON.parse(readFileSync(resolve(process.cwd(), "src/data/atlas.json"), "utf8"));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

/** The photo on screen's map, with its hottest square and a square that mattered nothing. */
async function mapOnScreen(page: Page) {
  const main = page.locator("main[data-photo]");
  await expect(main).toHaveAttribute("data-photo", /.+/);
  const looked = ATLAS.guesses[(await main.getAttribute("data-photo"))!]!.looked!;
  const top = Math.max(...looked.cells);
  return {
    grid: looked.grid,
    hottest: looked.cells.indexOf(top),
    cold: looked.cells.indexOf(0),
  };
}

const name = (grid: number, cell: number) =>
  `Row ${Math.floor(cell / grid) + 1}, column ${(cell % grid) + 1}`;

test("Spot the clue scores the square picked by Atlas's real map, by tap and by keys, and keeps the best", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./");
  await page.getByRole("button", { name: "Games" }).click();
  await page
    .getByRole("dialog", { name: "Ways to play" })
    .getByRole("link", { name: /^Spot the clue/ })
    .click();
  await expect(page).toHaveURL(/\/spot-the-clue\/?$/, { timeout: 20_000 });
  await expect(page.getByTestId("spot-question")).toContainText("Atlas said ");

  const { width, height } = page.viewportSize()!;
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  let total = 0;
  for (let n = 0; n < 5; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 5`, { exact: true })).toBeVisible();
    const { grid, hottest, cold } = await mapOnScreen(page);
    const lock = page.getByRole("button", { name: /^Lock in row/ });
    await expect(lock).toBeEnabled();
    // The square photo and the button fit the screen.
    const box = (await page.getByTestId("spot-photo").boundingBox())!;
    expect(box.width).toBeGreaterThan(200);
    expect(Math.abs(box.width - box.height)).toBeLessThan(2);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect((await lock.boundingBox())!.y + 40).toBeLessThanOrEqual(height + 1);

    if (n === 0) {
      // Tap Atlas's hottest square: the full 1,000.
      await page.getByRole("button", { name: name(grid, hottest), exact: true }).click();
      await page
        .getByRole("button", { name: `Lock in ${name(grid, hottest).toLowerCase()}` })
        .click();
      await expect(card.getByRole("heading")).toHaveText("Spot on: 1,000 points");
      total += 1000;
    } else if (n === 1 && cold >= 0) {
      // Walk to a square Atlas never needed with the arrows, then G: nothing.
      const mid = Math.floor(grid / 2);
      const [row, col] = [Math.floor(cold / grid), cold % grid];
      for (let i = 0; i < Math.abs(row - mid); i++) {
        await page.keyboard.press(row > mid ? "ArrowDown" : "ArrowUp");
      }
      for (let i = 0; i < Math.abs(col - mid); i++) {
        await page.keyboard.press(col > mid ? "ArrowRight" : "ArrowLeft");
      }
      await expect(
        page.getByRole("button", { name: name(grid, cold), exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("g");
      await expect(card.getByRole("heading")).toHaveText("Cold: 0 points");
    } else {
      await lock.click();
      const heading = (await card.getByRole("heading").textContent())!;
      total += Number(heading.replace(/^.*: ([\d,]+) points$/, "$1").replace(",", ""));
    }
    await expect(page.getByTestId("spot-heat")).toBeAttached();
    await expect(page.getByTestId("spot-yours")).toBeVisible();
    await expect(card.getByTestId("spot-atlas")).toContainText("Atlas said ");
    // The answer card fits under the photo, its button on screen.
    const next = card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" });
    await expect(next).toBeFocused();
    const nextBox = (await next.boundingBox())!;
    expect(nextBox.y + nextBox.height).toBeLessThanOrEqual(height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.keyboard.press("Enter");
  }

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `${total.toLocaleString("en-US")} points`,
  );
  await expect(page.getByTestId("spot-row")).toHaveCount(5);
  await expect(page.getByText("That's your new best!")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("whereabout:spot-the-clue-best"))).toBe(
    String(total),
  );

  // A new game, with the best in the Games menu.
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByText("Photo 1 of 5", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Games" }).click();
  await expect(page.getByTestId("best-spot-the-clue")).toHaveText(
    `Best: ${total.toLocaleString("en-US")} points`,
  );
  await expect(page.getByRole("dialog").getByText("Playing now")).toBeVisible();
  expect(errors).toEqual([]);
});

test("on a 320px phone the photo, its grid and the answer fit without scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./spot-the-clue");
  const lock = page.getByRole("button", { name: /^Lock in row/ });
  await expect(lock).toBeEnabled();
  const photo = (await page.getByTestId("spot-photo").boundingBox())!;
  expect(photo.x).toBeGreaterThanOrEqual(0);
  expect(photo.x + photo.width).toBeLessThanOrEqual(321);
  expect(photo.width).toBeGreaterThan(150);
  const lockBox = (await lock.boundingBox())!;
  expect(lockBox.y + lockBox.height).toBeLessThanOrEqual(569);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await lock.click();
  const next = page.getByRole("button", { name: "Next photo" });
  await expect(next).toBeFocused();
  const nextBox = (await next.boundingBox())!;
  expect(nextBox.y + nextBox.height).toBeLessThanOrEqual(569);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("today's Spot the clue deals the day's five once, resumes after a reload, and shares the points", async ({
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
  await page.goto("./spot-the-clue");
  await page.getByRole("link", { name: "Today's game" }).click();
  await expect(page).toHaveURL(/\/spot-the-clue\/daily\/?$/);
  await expect(page.getByText("Spot the clue, today: what told Atlas?")).toBeVisible();
  await expect(page.getByText("Best", { exact: true })).toHaveCount(0);

  // Every photo on Atlas's hottest square, so the total is known: 1,000 a photo.
  const dealt: string[] = [];
  const answer = async (n: number) => {
    await expect(page.getByText(`Photo ${n + 1} of 5`, { exact: true })).toBeVisible();
    const { grid, hottest } = await mapOnScreen(page);
    dealt.push((await page.locator("main[data-photo]").getAttribute("data-photo"))!);
    await page.getByRole("button", { name: name(grid, hottest), exact: true }).click();
    await page
      .getByRole("button", { name: `Lock in ${name(grid, hottest).toLowerCase()}` })
      .click();
    await expect(card.getByRole("heading")).toHaveText("Spot on: 1,000 points");
  };
  await answer(0);
  await card.getByRole("button", { name: "Next photo" }).click();
  await answer(1);

  // A reload can't take a square back: it picks up at the third photo, the points kept.
  await page.reload();
  await expect(page.getByText("Photo 3 of 5", { exact: true })).toBeVisible();
  await expect(page.getByText("2,000", { exact: true })).toBeVisible();
  for (let n = 2; n < 5; n++) {
    await answer(n);
    await card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }).click();
  }
  expect(new Set(dealt).size).toBe(5);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("5,000 points");
  await expect(page.getByText(`Spot the clue · today's game · ${day}`)).toBeVisible();
  await page.getByRole("button", { name: "Share today's game" }).click();
  await expect(page.getByRole("status")).toHaveText("Result copied. Paste it anywhere.");
  const sent = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(sent).toContain(`Whereabout · Spot the clue · ${day}`);
  expect(sent).toContain("🔍 5,000 of 5,000 · Atlas's clue found on 5 of 5");
  expect(sent).toContain("🟩🟩🟩🟩🟩");
  expect(sent).toMatch(/\/spot-the-clue\/daily\/$/);
  // No place: the share spoils no photo.
  const places = await page.getByTestId("spot-row").allTextContents();
  for (const row of places) expect(sent).not.toContain(row.split(/Spot on/)[0]!.trim());
  // The free game's best is untouched.
  expect(await page.evaluate(() => localStorage.getItem("whereabout:spot-the-clue-best"))).toBe(
    null,
  );

  // The day is never dealt again.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("5,000 points");
  await expect(page.getByRole("group", { name: /grid of/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("today's Spot the clue fits a 320px phone, its link to free games on screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const [path, link] of [
    ["./spot-the-clue", "Today's game"],
    ["./spot-the-clue/daily", "Free games"],
  ] as const) {
    await page.goto(path);
    const lock = page.getByRole("button", { name: /^Lock in row/ });
    await expect(lock).toBeEnabled();
    const linkBox = (await page.getByRole("link", { name: link }).boundingBox())!;
    expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(321);
    const lockBox = (await lock.boundingBox())!;
    expect(lockBox.y + lockBox.height).toBeLessThanOrEqual(569);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  }
});

test("a Spot the clue challenge deals a friend the same five, with the sender's square shown after theirs", async ({
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

  // The sender locks in Atlas's hottest square on every photo: 5,000 to beat.
  await page.goto("./spot-the-clue");
  const game: string[] = [];
  const cells: number[] = [];
  for (let n = 0; n < 5; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 5`, { exact: true })).toBeVisible();
    const { grid, hottest } = await mapOnScreen(page);
    game.push((await page.locator("main[data-photo]").getAttribute("data-photo"))!);
    cells.push(hottest);
    await page.getByRole("button", { name: name(grid, hottest), exact: true }).click();
    await page.keyboard.press("g");
    await expect(card.getByRole("heading")).toHaveText("Spot on: 1,000 points");
    await page.keyboard.press("Enter");
  }
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("5,000 points");
  await page.getByRole("button", { name: "Challenge a friend" }).click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const message = await sent();
  expect(message.split("\n")[0]).toBe(
    "Whereabout · Spot the clue: 5,000 points, Atlas's most telling square found on 5 of 5.",
  );
  const link = message.split("\n").at(-1)!;
  expect(link).toMatch(
    new RegExp(`/whereabout/spot-the-clue/?\\?challenge=${game.join("\\.")}_${cells.join("\\.")}$`),
  );

  // The friend, with nothing kept, gets the same five and picks a square Atlas never needed
  // where there is one, else the middle.
  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  await expect(page.getByTestId("spot-challenge")).toHaveText("5,000");
  for (let n = 0; n < 5; n++) {
    await expect(page.locator("main[data-photo]")).toHaveAttribute("data-photo", game[n]!);
    await expect(page.getByTestId("spot-friend-score")).toHaveText(
      (n * 1000).toLocaleString("en-US"),
    );
    const { grid, cold } = await mapOnScreen(page);
    await expect(page.getByTestId("spot-friend")).toHaveCount(0);
    if (cold >= 0) await page.getByRole("button", { name: name(grid, cold), exact: true }).click();
    await page.keyboard.press("g");
    await expect(card.getByTestId("spot-friend-line")).toHaveText(
      `Friend (red): ${name(grid, cells[n]!).toLowerCase()}, 1,000 points.`,
    );
    await expect(page.getByTestId("spot-friend")).toHaveAttribute("data-cell", String(cells[n]));
    await expect(page.getByTestId("spot-friend")).toBeVisible();
    await page.keyboard.press("Enter");
  }
  await expect(page.getByTestId("spot-challenge-line")).toHaveText(/^Your friend's 5,000 wins/);
  await expect(page.getByTestId("spot-row")).toHaveCount(5);
  await expect(page.getByTestId("spot-row").first()).toContainText("Friend: 1,000 points");
  expect(
    await page.evaluate(() => localStorage.getItem("whereabout:spot-the-clue-best")),
  ).toBeNull();

  await page.getByRole("button", { name: "Send yours back" }).click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const reply = await sent();
  expect(reply.split("\n")[1]).toBe("Your 5,000 wins this time. Try them again?");
  expect(reply.split("\n").at(-1)).toMatch(new RegExp(`\\?challenge=${game.join("\\.")}_`));

  // Head to head: both games as a 1080px picture, saved, with the reply link copied.
  await page.evaluate(() => ((window as unknown as { sent: string }).sent = ""));
  const picture = page.getByRole("button", { name: "Share head to head" });
  const [download] = await Promise.all([page.waitForEvent("download"), picture.click()]);
  expect(download.suggestedFilename()).toBe("whereabout-spot-the-clue-head-to-head.png");
  const png = readFileSync((await download.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1080]);
  expect(await sent()).toBe(reply);
  const kept = await page.evaluate(() => localStorage.getItem("whereabout:head-to-head"));
  expect(JSON.parse(kept!)).toEqual([expect.objectContaining({ game: "Spot the clue" })]);

  // A fresh game drops the link.
  await page.getByRole("button", { name: "Play a fresh game" }).click();
  await expect(page.getByText("Photo 1 of 5", { exact: true })).toBeVisible();
  await expect(page.getByTestId("spot-challenge")).toHaveCount(0);
  expect(new URL(page.url()).search).toBe("");
  expect(errors).toEqual([]);
});

test("a broken Spot the clue challenge says so and deals a fresh game", async ({ page }) => {
  await page.goto("./spot-the-clue?challenge=wm001_1");
  await expect(page.getByText(/That challenge link was cut short/)).toBeVisible();
  await expect(page.getByTestId("spot-challenge")).toHaveCount(0);
  await expect(page.getByText("Photo 1 of 5", { exact: true })).toBeVisible();
});

test("a Spot the clue challenge's answer card and end buttons fit a 320px phone", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 320, height: 568 });
  const catalog = new Set(
    (
      JSON.parse(readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8")) as {
        id: string;
      }[]
    ).map((p) => p.id),
  );
  const ids = Object.entries(ATLAS.guesses)
    .filter(([id, g]) => catalog.has(id) && g.looked && Math.max(...g.looked.cells) > 0)
    .map(([id]) => id)
    .slice(0, 5);
  await page.goto(`./spot-the-clue?challenge=${ids.join(".")}_0.1.2.3.4`);
  await expect(page.getByTestId("spot-challenge")).toHaveText(/^[\d,]+$/);
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  for (let n = 0; n < 5; n++) {
    await expect(page.getByRole("button", { name: /^Lock in row/ })).toBeEnabled();
    await page.keyboard.press("g");
    await expect(card.getByTestId("spot-friend-line")).toBeVisible();
    const next = card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" });
    const box = (await next.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(569);
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
