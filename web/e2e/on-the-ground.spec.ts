import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG: { id: string; landCover?: string }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const COVER = new Map(CATALOG.map((p) => [p.id, p.landCover]));
const COVERS = [
  "Built-up",
  "Tree cover",
  "Grassland",
  "Permanent water bodies",
  "Bare / sparse vegetation",
];

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

async function coverOnScreen(page: Page) {
  const photo = page.getByTestId("ground-photo");
  await expect(photo).toHaveAttribute("data-photo", /.+/);
  const cover = COVER.get((await photo.getAttribute("data-photo"))!);
  expect(COVERS).toContain(cover);
  return cover!;
}

const coverButton = (page: Page, cover: string) =>
  page.getByTestId(`ground-${COVERS.indexOf(cover) + 1}`);
const wrongFor = (cover: string) => (cover === "Grassland" ? "Built-up" : "Grassland");

test("What's on the ground? plays five photos against Atlas, lights each on the band of covers, and keeps the best", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./on-the-ground");
  await expect(page.getByText("What's on the ground? Name the cover.")).toBeVisible();
  const { width, height } = page.viewportSize()!;
  // All five covers sit on screen, under a photo big enough to read.
  for (const cover of COVERS) {
    const button = coverButton(page, cover);
    await expect(button).toBeEnabled();
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  }
  expect((await page.getByTestId("ground-photo").boundingBox())!.height).toBeGreaterThan(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );

  // Three right calls (the first two by tap, the third by key), then two wrong ones.
  for (let n = 0; n < 5; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 5`, { exact: true })).toBeVisible();
    const truth = await coverOnScreen(page);
    const pick = n < 3 ? truth : wrongFor(truth);
    await expect(coverButton(page, pick)).toBeEnabled();
    if (n === 2) await page.keyboard.press(String(COVERS.indexOf(pick) + 1));
    else await coverButton(page, pick).click();
    const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
    await expect(card.getByRole("heading")).toHaveText(n < 3 ? "Correct" : "Wrong");
    const band = card.getByTestId("ground-band");
    await expect(band.locator("[aria-current='location']")).toHaveAttribute("data-cover", truth);
    await expect(band.locator(`[data-cover='${pick}']`)).toContainText("You");
    await expect(card).toContainText(/Atlas('s clues named no| read it as)/);
    // The answer card fits the screen, with its button in reach.
    const box = (await card.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    await card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }).click();
  }

  await expect(page.getByRole("heading", { level: 1, name: "3 of 5" })).toBeVisible();
  await expect(page.getByTestId("ground-row")).toHaveCount(5);
  await expect(page.getByText("That's your new best!")).toBeVisible();

  // The best is kept, and the Games menu shows it beside the game's name.
  await page.reload();
  await expect(page.getByText("Best").locator("xpath=following-sibling::dd")).toHaveText("3");
  await page.getByRole("button", { name: "Games" }).click();
  await expect(page.getByTestId("best-on-the-ground")).toHaveText("Best: 3 of 5 right");
  expect(errors).toEqual([]);
});

test("today's What's on the ground? deals the day's five once, resumes after a reload, and shares the score", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const today = new Date().toISOString().slice(0, 10);

  // The free games link to today's game.
  await page.goto("./on-the-ground");
  await page.getByRole("link", { name: "Today's game" }).click();
  await expect(page.getByText(`today's game (${today})`)).toBeVisible();
  await expect(page.getByText("Best", { exact: true })).toHaveCount(0);
  const { width, height } = page.viewportSize()!;
  // The day's header still leaves the photo room and every cover in reach.
  expect((await page.getByTestId("ground-photo").boundingBox())!.height).toBeGreaterThan(200);
  for (const cover of COVERS) {
    const box = (await coverButton(page, cover).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  }

  // Everyone on one day gets the same photos: a fresh player (nothing kept) is dealt the same.
  await coverOnScreen(page);
  const first = await page.getByTestId("ground-photo").getAttribute("data-photo");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("ground-photo")).toHaveAttribute("data-photo", first!);

  // A right call on the first photo, then a reload picks up at the second with the score so far.
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  const truth = await coverOnScreen(page);
  await expect(coverButton(page, truth)).toBeEnabled();
  await coverButton(page, truth).click();
  await expect(card.getByRole("heading")).toHaveText("Correct");
  await page.reload();
  await expect(page.getByText("Photo 2 of 5", { exact: true })).toBeVisible();
  await expect(page.getByTestId("ground-photo")).not.toHaveAttribute("data-photo", first!);
  await expect(page.getByText("Score", { exact: true }).locator("+ dd")).toHaveText("1");

  // Two more right, then two wrong.
  for (let n = 1; n < 5; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 5`, { exact: true })).toBeVisible();
    const cover = await coverOnScreen(page);
    const pick = n < 3 ? cover : wrongFor(cover);
    await expect(coverButton(page, pick)).toBeEnabled();
    await coverButton(page, pick).click();
    await expect(card.getByRole("heading")).toHaveText(n < 3 ? "Correct" : "Wrong");
    await card.getByRole("button", { name: n === 4 ? "See today's result" : "Next photo" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "3 of 5" })).toBeVisible();
  await expect(page.getByTestId("ground-row")).toHaveCount(5);
  await expect(page.getByTestId("ground-row").first()).not.toContainText("Photo 1");

  // A reload shows the day's result, never the photos again.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "3 of 5" })).toBeVisible();
  await expect(page.getByText(/The next game is dealt in \d+/)).toBeVisible();
  await expect(page.getByTestId("ground-photo")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
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
  await page.getByRole("button", { name: "Share today's game" }).click();
  await expect(page.getByText("Result copied. Paste it anywhere.")).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(sent).toContain(`Whereabout · What's on the ground? · ${today}\n🌱 3 of 5\n🟩🟩🟩🟥🟥\n`);
  expect(sent).toMatch(/\/whereabout\/on-the-ground\/daily\/?$/);
  for (const cover of COVERS) expect(sent).not.toContain(cover);

  // The free games' best is its own.
  expect(await page.evaluate(() => localStorage.getItem("whereabout:on-the-ground-best"))).toBe(
    null,
  );
  expect(errors).toEqual([]);
});

test("a 320px phone fits every cover, the answer and the end of a game", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./on-the-ground");
  for (const cover of COVERS) {
    const box = (await coverButton(page, cover).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(321);
    expect(box.y + box.height).toBeLessThanOrEqual(569);
  }
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  for (let n = 0; n < 5; n++) {
    const truth = await coverOnScreen(page);
    await coverButton(page, truth).click();
    const box = (await card.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(569);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "5 of 5" })).toBeVisible();
  for (const name of ["Play again", "Challenge a friend"]) {
    const button = page.getByRole("button", { name });
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(321);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

const LETTER: Record<string, string> = {
  "Built-up": "b",
  "Tree cover": "t",
  Grassland: "g",
  "Permanent water bodies": "w",
  "Bare / sparse vegetation": "s",
};

test("a challenge link deals a friend the same five photos, with the sender's call shown after theirs", async ({
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

  // The sender names the first two right and the other three wrong: 2 of 5.
  await page.goto("./on-the-ground");
  const game: string[] = [];
  const senderCalls: string[] = [];
  for (let n = 0; n < 5; n++) {
    const truth = await coverOnScreen(page);
    game.push((await page.getByTestId("ground-photo").getAttribute("data-photo"))!);
    const pick = n < 2 ? truth : wrongFor(truth);
    senderCalls.push(pick);
    await coverButton(page, pick).click();
    await card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "2 of 5" })).toBeVisible();
  await page.getByRole("button", { name: "Challenge a friend" }).click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const message = await sent();
  expect(message).toContain("I named 2 of 5 covers right.");
  const link = message.split("\n").at(-1)!;
  expect(link).toMatch(
    new RegExp(
      `/whereabout/on-the-ground/?\\?challenge=${game.join("\\.")}_${senderCalls.map((c) => LETTER[c]).join("")}$`,
    ),
  );

  // The friend, with nothing kept, gets the same five and names them all right.
  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  await expect(page.getByText("A friend's challenge: 2 of 5 to beat.")).toBeVisible();
  const { width, height } = page.viewportSize()!;
  for (let n = 0; n < 5; n++) {
    await expect(page.getByTestId("ground-photo")).toHaveAttribute("data-photo", game[n]);
    const truth = await coverOnScreen(page);
    await expect(page.getByTestId("ground-friend")).toHaveCount(0);
    await coverButton(page, truth).click();
    await expect(card.getByTestId("ground-friend")).toContainText(
      n < 2 ? ", and got it." : ": wrong.",
    );
    await expect(
      card.getByTestId("ground-band").locator(`[data-cover='${senderCalls[n]}']`),
    ).toContainText("Friend");
    // The card, with the friend's line on it, still fits the screen.
    const box = (await card.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    await card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "5 of 5" })).toBeVisible();
  await expect(page.getByText("You beat your friend's 2 of 5 by 3.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("whereabout:on-the-ground-best"))).toBe(
    null,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );

  await page.getByRole("button", { name: "Send yours back" }).click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const reply = await sent();
  expect(reply).toContain("That beats your 2. Your turn to read the ground.");

  // Head to head: both games drawn as a 1080px picture, saved, with the reply link copied.
  await page.evaluate(() => ((window as unknown as { sent: string }).sent = ""));
  const picture = page.getByRole("button", { name: "Share head to head" });
  const [download] = await Promise.all([page.waitForEvent("download"), picture.click()]);
  expect(download.suggestedFilename()).toBe("whereabout-whats-on-the-ground-head-to-head.png");
  const png = readFileSync((await download.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1080]);
  expect(await sent()).toBe(reply);
  const kept = await page.evaluate(() => localStorage.getItem("whereabout:head-to-head"));
  expect(JSON.parse(kept!)).toEqual([
    expect.objectContaining({ game: "What's on the ground?", outcome: "won", you: "5 of 5" }),
  ]);

  // A fresh game drops the link.
  await page.getByRole("button", { name: "Play a fresh game" }).click();
  await expect(page.getByText("What's on the ground? Name the cover.")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(errors).toEqual([]);
});

test("a broken What's on the ground? challenge says so and deals a fresh game", async ({
  page,
}) => {
  await page.goto("./on-the-ground?challenge=wm001_btg");
  await expect(page.getByText(/That challenge link was cut short/)).toBeVisible();
  await expect(page.getByText("What's on the ground? Name the cover.")).toBeVisible();
  await expect(coverButton(page, "Grassland")).toBeEnabled();
});

test("a challenge's answer card, with the friend's call on it, fits a 320px phone", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  // Five photos, one of each cover where the catalog has it, with the friend's call on each the
  // truth, so the band's busiest mark ("You · Friend", or with Atlas too) is on every card.
  const ids = COVERS.map((cover) => CATALOG.find((p) => p.landCover === cover)!.id);
  await page.goto(
    `./on-the-ground?challenge=${ids.join(".")}_${ids.map((id) => LETTER[COVER.get(id)!]).join("")}`,
  );
  await expect(page.getByText("A friend's challenge: 5 of 5 to beat.")).toBeVisible();
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  for (let n = 0; n < 5; n++) {
    const truth = await coverOnScreen(page);
    await coverButton(page, truth).click();
    await expect(card.getByTestId("ground-friend")).toContainText(", and got it.");
    const box = (await card.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(569);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
    await card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }).click();
  }
  await expect(page.getByText("A dead heat: you both named 5 of 5.")).toBeVisible();
  for (const name of ["Play a fresh game", "Send yours back", "Share head to head"]) {
    const button = page.getByRole("button", { name });
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(321);
  }
});
