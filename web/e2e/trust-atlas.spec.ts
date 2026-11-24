import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const ATLAS: {
  guesses: Record<string, { confidence?: number; topCountries: { country: string; p: number }[] }>;
} = JSON.parse(readFileSync(resolve(process.cwd(), "src/data/atlas.json"), "utf8"));
const CATALOG: { id: string; country: string }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const COUNTRY = new Map(CATALOG.map((p) => [p.id, p.country]));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

/** Whether Atlas named the real country of the photo on screen, from the shipped data. */
async function atlasRightOnScreen(page: Page) {
  const main = page.locator("main[data-photo]");
  await expect(main).toHaveAttribute("data-photo", /.+/);
  const id = (await main.getAttribute("data-photo"))!;
  const top = ATLAS.guesses[id]!.topCountries[0]!;
  return { right: top.country === COUNTRY.get(id), sure: Math.round(top.p * 100) };
}

test("Trust Atlas? judges each call on the real country, by tap and by key, and keeps the best", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./");
  await page.getByRole("button", { name: "Games" }).click();
  await page
    .getByRole("dialog", { name: "Ways to play" })
    .getByRole("link", { name: /^Trust Atlas\?/ })
    .click();
  await expect(page).toHaveURL(/\/trust-atlas\/?$/, { timeout: 20_000 });

  const { width, height } = page.viewportSize()!;
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  const trust = page.getByRole("button", { name: "Trust it: Atlas is right" });
  const doubt = page.getByRole("button", { name: "Doubt it: Atlas is wrong" });
  let called = 0;
  let atlasRight = 0;
  for (let n = 0; n < 10; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 10`, { exact: true })).toBeVisible();
    await expect(trust).toBeEnabled();
    const { right, sure } = await atlasRightOnScreen(page);
    if (right) atlasRight++;
    await expect(page.getByTestId("trust-question")).toContainText(`${sure}% sure. Is it right?`);
    await expect(page.getByRole("meter", { name: "How sure Atlas is" })).toHaveAttribute(
      "aria-valuenow",
      String(sure),
    );
    // Both buttons sit on screen, under the photo.
    const doubtBox = (await doubt.boundingBox())!;
    expect(doubtBox.y + doubtBox.height).toBeLessThanOrEqual(height + 1);
    expect(doubtBox.x + doubtBox.width).toBeLessThanOrEqual(width + 1);

    if (n === 0) {
      // Tap the right call.
      await (right ? trust : doubt).click();
      await expect(card.getByRole("heading")).toHaveText("Called it");
      called++;
    } else if (n === 1) {
      // Key the wrong one.
      await page.keyboard.press(right ? "n" : "y");
      await expect(card.getByRole("heading")).toHaveText("Missed it");
    } else {
      await page.keyboard.press(right ? "y" : "n");
      await expect(card.getByRole("heading")).toHaveText("Called it");
      called++;
    }
    await expect(card.getByTestId("trust-truth")).toContainText(
      right ? "Atlas was right: it is " : "Atlas was wrong: it is ",
    );
    await expect(card.getByTestId("trust-atlas")).toContainText(
      sure >= 50 ? "Atlas trusted its answer" : "Atlas doubted its answer",
    );
    const next = card.getByRole("button", { name: n === 9 ? "See the results" : "Next photo" });
    await expect(next).toBeFocused();
    const nextBox = (await next.boundingBox())!;
    expect(nextBox.y + nextBox.height).toBeLessThanOrEqual(height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.keyboard.press("Enter");
  }

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${called} of 10 called right`);
  await expect(page.getByTestId("trust-end")).toContainText(
    `Atlas was right on ${atlasRight} of 10.`,
  );
  await expect(page.getByTestId("trust-row")).toHaveCount(10);
  await expect(page.getByText("That's your new best!")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("whereabout:trust-atlas-best"))).toBe(
    String(called),
  );

  // A new game, with the best in the Games menu.
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByText("Photo 1 of 10", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Games" }).click();
  await expect(page.getByTestId("best-trust-atlas")).toHaveText(
    `Best: ${called} of 10 called right`,
  );
  await expect(page.getByRole("dialog").getByText("Playing now")).toBeVisible();
  expect(errors).toEqual([]);
});

test("your calls show on Your map's trust, by how sure Atlas was, beside its own rule", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./trust-atlas");
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  const trust = page.getByRole("button", { name: "Trust it: Atlas is right" });
  const bands = ["low", "middling", "high"] as const;
  const expected = new Map(bands.map((b) => [b, { photos: 0, you: 0, rule: 0, right: 0 }]));
  for (let n = 0; n < 3; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 10`, { exact: true })).toBeVisible();
    await expect(trust).toBeEnabled();
    const id = (await page.locator("main[data-photo]").getAttribute("data-photo"))!;
    const guess = ATLAS.guesses[id]!;
    const p = guess.confidence ?? guess.topCountries[0]!.p;
    const right = guess.topCountries[0]!.country === COUNTRY.get(id);
    // Trust the first two, doubt the third.
    const call = n < 2 ? "trust" : "doubt";
    await page.keyboard.press(call === "trust" ? "y" : "n");
    await expect(card.getByRole("heading")).toBeVisible();
    const t = expected.get(p < 0.25 ? "low" : p < 0.5 ? "middling" : "high")!;
    t.photos++;
    if (right) t.right++;
    if ((call === "trust") === right) t.you++;
    if (p >= 0.5 === right) t.rule++;
    if (n < 2) await card.getByRole("button", { name: "Next photo" }).click();
  }

  // Leave mid-game: all three calls already count.
  await page.goto("./map");
  const section = page.getByTestId("trust-read");
  await expect(section.getByRole("heading", { name: "Your trust" })).toBeVisible();
  const you = [...expected.values()].reduce((s, t) => s + t.you, 0);
  const rule = [...expected.values()].reduce((s, t) => s + t.rule, 0);
  await expect(page.getByTestId("trust-read-line")).toContainText(
    `You called ${you} of 3 photos right`,
  );
  await expect(page.getByTestId("trust-read-line")).toContainText(
    `Atlas's own rule called ${rule} (`,
  );
  for (const b of bands) {
    const t = expected.get(b)!;
    await expect(page.getByTestId(`trust-read-${b}`)).toHaveAttribute(
      "data-right",
      String(t.right),
    );
    await expect(page.getByTestId(`trust-read-${b}-you`)).toHaveAttribute(
      "data-correct",
      String(t.you),
    );
    await expect(page.getByTestId(`trust-read-${b}-atlas`)).toHaveAttribute(
      "data-correct",
      String(t.rule),
    );
    await expect(page.getByTestId(`trust-read-${b}-you`)).toHaveAttribute(
      "data-photos",
      String(t.photos),
    );
  }
  const box = (await page.getByTestId("trust-read-high").boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(321);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await section.getByRole("link", { name: "Play Trust Atlas?" }).click();
  await expect(page).toHaveURL(/\/trust-atlas\/?$/);
});

test("on a 320px phone the photo, the calls and the answer fit without scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./trust-atlas");
  const trust = page.getByRole("button", { name: "Trust it: Atlas is right" });
  const doubt = page.getByRole("button", { name: "Doubt it: Atlas is wrong" });
  await expect(trust).toBeEnabled();
  const photo = (await page.getByTestId("trust-photo").boundingBox())!;
  expect(photo.height).toBeGreaterThan(120);
  expect(photo.x + photo.width).toBeLessThanOrEqual(321);
  for (const button of [trust, doubt]) {
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(321);
    expect(box.y + box.height).toBeLessThanOrEqual(569);
  }
  // The header's buttons stay on screen beside the title.
  const games = (await page.getByRole("button", { name: "Games" }).boundingBox())!;
  expect(games.x + games.width).toBeLessThanOrEqual(321);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await doubt.click();
  const next = page.getByRole("button", { name: "Next photo" });
  await expect(next).toBeFocused();
  const nextBox = (await next.boundingBox())!;
  expect(nextBox.y + nextBox.height).toBeLessThanOrEqual(569);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("today's Trust Atlas? deals the day's ten once, resumes after a reload, and shares the calls", async ({
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
  await page.goto("./trust-atlas");
  await page.getByRole("link", { name: "Today's game" }).click();
  await expect(page).toHaveURL(/\/trust-atlas\/daily\/?$/);
  await expect(page.getByText("Trust Atlas? Today: Is its answer right?")).toBeVisible();
  await expect(page.getByText("Best", { exact: true })).toHaveCount(0);

  // Every photo called right, so the total is known: ten of ten. Atlas's own count comes from
  // the shipped data, by its rule of trusting itself at 50% sure or more.
  const dealt: string[] = [];
  let atlasOwn = 0;
  const callRight = async (n: number) => {
    await expect(page.getByText(`Photo ${n + 1} of 10`, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Trust it: Atlas is right" })).toBeEnabled();
    const { right } = await atlasRightOnScreen(page);
    const id = (await page.locator("main[data-photo]").getAttribute("data-photo"))!;
    dealt.push(id);
    if (ATLAS.guesses[id]!.topCountries[0]!.p >= 0.5 === right) atlasOwn++;
    await page.keyboard.press(right ? "y" : "n");
    await expect(card.getByRole("heading")).toHaveText("Called it");
  };
  await callRight(0);
  await card.getByRole("button", { name: "Next photo" }).click();
  await callRight(1);

  // A reload can't take a call back: it picks up at the third photo, the calls kept.
  await page.reload();
  await expect(page.getByText("Photo 3 of 10", { exact: true })).toBeVisible();
  await expect(page.locator("dd", { hasText: /^2$/ })).toBeVisible();
  for (let n = 2; n < 10; n++) {
    await callRight(n);
    await card.getByRole("button", { name: n === 9 ? "See the results" : "Next photo" }).click();
  }
  expect(new Set(dealt).size).toBe(10);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("10 of 10 called right");
  await expect(page.getByText(`Trust Atlas? · today's game · ${day}`)).toBeVisible();
  await page.getByRole("button", { name: "Share today's game" }).click();
  await expect(page.getByRole("status")).toHaveText("Result copied. Paste it anywhere.");
  const sent = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(sent).toContain(`Whereabout · Trust Atlas? · ${day}`);
  expect(sent).toContain(`🤔 10 of 10 called right · Atlas's own sureness ${atlasOwn} of 10`);
  expect(sent).toContain("🟩".repeat(10));
  expect(sent).toMatch(/\/trust-atlas\/daily\/$/);
  // No place: the share spoils no photo.
  for (const row of await page.getByTestId("trust-row").allTextContents()) {
    expect(sent).not.toContain(row.split("Atlas said")[0]!.trim());
  }
  // The free game's best is untouched.
  expect(await page.evaluate(() => localStorage.getItem("whereabout:trust-atlas-best"))).toBe(null);

  // The day is never dealt again.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("10 of 10 called right");
  await expect(page.getByRole("button", { name: "Trust it: Atlas is right" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("today's Trust Atlas? fits a 320px phone, its link to free games on screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const [path, link] of [
    ["./trust-atlas", "Today's game"],
    ["./trust-atlas/daily", "Free games"],
  ] as const) {
    await page.goto(path);
    const doubt = page.getByRole("button", { name: "Doubt it: Atlas is wrong" });
    await expect(doubt).toBeEnabled();
    const linkBox = (await page.getByRole("link", { name: link }).boundingBox())!;
    expect(linkBox.x + linkBox.width).toBeLessThanOrEqual(321);
    const box = (await doubt.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(569);
    expect((await page.getByTestId("trust-photo").boundingBox())!.height).toBeGreaterThan(120);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  }
});

test("a Trust Atlas? challenge deals a friend the same ten, with the sender's call shown after theirs", async ({
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
  const trust = page.getByRole("button", { name: "Trust it: Atlas is right" });

  // The sender makes the right call on every photo: ten to beat.
  await page.goto("./trust-atlas");
  const game: string[] = [];
  const calls: string[] = [];
  for (let n = 0; n < 10; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 10`, { exact: true })).toBeVisible();
    await expect(trust).toBeEnabled();
    const { right } = await atlasRightOnScreen(page);
    game.push((await page.locator("main[data-photo]").getAttribute("data-photo"))!);
    calls.push(right ? "t" : "d");
    await page.keyboard.press(right ? "y" : "n");
    await expect(card.getByRole("heading")).toHaveText("Called it");
    await expect(card.getByTestId("trust-friend-line")).toHaveCount(0);
    await page.keyboard.press("Enter");
  }
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("10 of 10 called right");
  await page.getByRole("button", { name: "Challenge a friend" }).click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const message = await sent();
  expect(message.split("\n")[0]).toMatch(
    /^Whereabout · Trust Atlas\?: 10 of 10 called right\. Atlas's own sureness: \d+ of 10\.$/,
  );
  const link = message.split("\n").at(-1)!;
  expect(link).toMatch(
    new RegExp(`/whereabout/trust-atlas/?\\?challenge=${game.join("\\.")}_${calls.join("")}$`),
  );

  // The friend, with nothing kept, gets the same ten and trusts Atlas every time.
  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  await expect(page.getByTestId("trust-challenge")).toHaveText("10");
  await expect(page.getByText("Best", { exact: true })).toHaveCount(0);
  let mine = 0;
  for (let n = 0; n < 10; n++) {
    await expect(page.locator("main[data-photo]")).toHaveAttribute("data-photo", game[n]!);
    await expect(page.getByTestId("trust-friend-score")).toHaveText(String(n));
    await expect(trust).toBeEnabled();
    await expect(card).toHaveCount(0);
    await trust.click();
    const right = calls[n] === "t";
    if (right) mine++;
    await expect(card.getByTestId("trust-friend-line")).toHaveText(
      right
        ? "Friend: Your friend trusted it too: called it."
        : "Friend: Your friend doubted it: called it.",
    );
    await page.keyboard.press("Enter");
  }
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${mine} of 10 called right`);
  await expect(page.getByTestId("trust-challenge-line")).toHaveText(
    mine === 10
      ? "A dead heat: you both called 10 of 10 right."
      : `Your friend's 10 of 10 wins, by ${10 - mine}.`,
  );
  await expect(page.getByTestId("trust-row")).toHaveCount(10);
  await expect(page.getByTestId("trust-row").first()).toContainText("Friend: ");
  expect(await page.evaluate(() => localStorage.getItem("whereabout:trust-atlas-best"))).toBeNull();

  await page.getByRole("button", { name: "Send yours back" }).click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const reply = await sent();
  expect(reply.split("\n").at(-1)).toMatch(
    new RegExp(`\\?challenge=${game.join("\\.")}_tttttttttt$`),
  );

  // Head to head: both games as a 1080px picture, saved, with the reply link copied.
  await page.evaluate(() => ((window as unknown as { sent: string }).sent = ""));
  const picture = page.getByRole("button", { name: "Share head to head" });
  const [download] = await Promise.all([page.waitForEvent("download"), picture.click()]);
  expect(download.suggestedFilename()).toBe("whereabout-trust-atlas-head-to-head.png");
  const png = readFileSync((await download.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1080]);
  expect(await sent()).toBe(reply);
  const kept = await page.evaluate(() => localStorage.getItem("whereabout:head-to-head"));
  expect(JSON.parse(kept!)).toEqual([expect.objectContaining({ game: "Trust Atlas?" })]);

  // A fresh game drops the link.
  await page.getByRole("button", { name: "Play a fresh game" }).click();
  await expect(page.getByText("Photo 1 of 10", { exact: true })).toBeVisible();
  await expect(page.getByTestId("trust-challenge")).toHaveCount(0);
  expect(new URL(page.url()).search).toBe("");
  expect(errors).toEqual([]);
});

test("a broken Trust Atlas? challenge says so and deals a fresh game", async ({ page }) => {
  await page.goto("./trust-atlas?challenge=wm001_t");
  await expect(page.getByText(/That challenge link was cut short/)).toBeVisible();
  await expect(page.getByTestId("trust-challenge")).toHaveCount(0);
  await expect(page.getByText("Photo 1 of 10", { exact: true })).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
});

test("a Trust Atlas? challenge's answer card and end buttons fit a 320px phone", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 320, height: 568 });
  const ids = CATALOG.map((p) => p.id)
    .filter((id) => ATLAS.guesses[id]?.topCountries?.length)
    .slice(0, 10);
  await page.goto(`./trust-atlas?challenge=${ids.join(".")}_tdtdtdtdtd`);
  await expect(page.getByTestId("trust-challenge")).toHaveText(/^\d+$/);
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  const games = (await page.getByRole("button", { name: "Games" }).boundingBox())!;
  expect(games.x + games.width).toBeLessThanOrEqual(321);
  for (let n = 0; n < 10; n++) {
    await expect(page.getByRole("button", { name: "Doubt it: Atlas is wrong" })).toBeEnabled();
    await page.keyboard.press("n");
    await expect(card.getByTestId("trust-friend-line")).toBeVisible();
    const next = card.getByRole("button", { name: n === 9 ? "See the results" : "Next photo" });
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
