import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const ATLAS: { guesses: Record<string, { lat: number; lng: number; confidence: number }> } =
  JSON.parse(readFileSync(resolve(process.cwd(), "src/data/atlas.json"), "utf8"));
const CATALOG: { id: string; lat: number; lng: number }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const PLACE = new Map(CATALOG.map((p) => [p.id, p]));

/** How far Atlas's pin landed from photo `id`, from the shipped data. */
function missKm(id: string): number {
  const a = PLACE.get(id)!;
  const b = ATLAS.guesses[id]!;
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}

/** The photos on screen, and which one Atlas really missed by more, or null on a dead heat. */
async function pairOnScreen(page: Page) {
  const id = async (n: number) =>
    (await page.getByTestId(`fooled-photo-${n}`).getAttribute("data-photo"))!;
  const ids = [await id(1), await id(2)] as const;
  const [a, b] = ids.map(missKm);
  const [low, high] = a <= b ? [a, b] : [b, a];
  const tie = high < 25 || high <= low * 1.5;
  return { ids, fooled: tie ? null : a >= b ? 1 : 2 };
}

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

test("Which fooled Atlas? judges each pair on Atlas's real misses, ends on a wrong pick, and keeps the best", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./");
  await page.getByRole("button", { name: "Games" }).click();
  await page
    .getByRole("dialog", { name: "Ways to play" })
    .getByRole("link", { name: /^Which fooled Atlas\?/ })
    .click();
  await expect(page).toHaveURL(/\/fooled-atlas\/?$/, { timeout: 20_000 });

  const { width, height } = page.viewportSize()!;
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });

  // Both photos and their pick buttons are on screen, side by side or stacked.
  for (const n of [1, 2]) {
    await expect(page.getByRole("button", { name: `Photo ${n} fooled Atlas` })).toBeEnabled();
    const box = (await page.getByTestId(`fooled-photo-${n}`).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    expect(box.height).toBeGreaterThan(120);
  }

  // Three right picks, by tap and then by key, from what the data says Atlas missed by more.
  let streak = 0;
  while (streak < 3) {
    await expect(page.getByRole("button", { name: "Photo 1 fooled Atlas" })).toBeEnabled();
    const { ids, fooled } = await pairOnScreen(page);
    if (streak === 0)
      await page.getByRole("button", { name: `Photo ${fooled ?? 1} fooled Atlas` }).click();
    else await page.keyboard.press(String(fooled ?? 2));
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading")).toHaveText(fooled ? "Right" : "Too close to call");
    await expect(card).toContainText(/Atlas this run: \d+ of \d+ pairs?\./);
    // The misses show only now, on both photos.
    await expect(page.getByTestId("fooled-photo-1")).toContainText(/Atlas off by [\d.,]+ (km|mi)/);
    const box = (await card.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    streak++;
    await expect(card.getByRole("button", { name: "Next pair" })).toBeFocused();
    await page.keyboard.press("Enter");
    // The second photo moves to the first place, beside a new one.
    await expect(page.getByTestId("fooled-photo-1")).toHaveAttribute("data-photo", ids[1]);
  }
  await expect(page.getByText("Streak", { exact: true }).locator("+ dd")).toHaveText("3");

  // Then the wrong photo on the first pair that can be called, which ends the run.
  for (;;) {
    await expect(page.getByRole("button", { name: "Photo 1 fooled Atlas" })).toBeEnabled();
    const { fooled } = await pairOnScreen(page);
    await page.getByRole("button", { name: `Photo ${fooled === 1 ? 2 : 1} fooled Atlas` }).click();
    if (fooled !== null) break;
    streak++;
    await card.getByRole("button", { name: "Next pair" }).click();
  }
  await expect(card.getByRole("heading")).toHaveText("Wrong");
  await expect(card).toContainText(`Run over: ${streak} pairs in a row. That's your new best!`);
  expect(await page.evaluate(() => localStorage.getItem("whereabout:fooled-atlas-best"))).toBe(
    String(streak),
  );

  // A new run starts at 0, and the best is in the Games menu after a reload.
  await card.getByRole("button", { name: "Start a new run" }).click();
  await expect(page.getByText("Streak", { exact: true }).locator("+ dd")).toHaveText("0");
  await page.reload();
  await expect(page.getByText("Best", { exact: true }).locator("+ dd")).toHaveText(String(streak));
  await page.getByRole("button", { name: "Games" }).click();
  await expect(
    page.getByRole("dialog", { name: "Ways to play" }).getByText(`Best: ${streak} in a row`),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("on a 320px phone both photos, their buttons and the answer fit without scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./fooled-atlas");
  for (const n of [1, 2]) {
    const button = page.getByRole("button", { name: `Photo ${n} fooled Atlas` });
    await expect(button).toBeEnabled();
    const label = (await button.locator("span").boundingBox())!;
    expect(label.x).toBeGreaterThanOrEqual(0);
    expect(label.x + label.width).toBeLessThanOrEqual(321);
    expect(label.y + label.height).toBeLessThanOrEqual(569);
  }
  const games = (await page.getByRole("button", { name: "Games" }).boundingBox())!;
  expect(games.x + games.width).toBeLessThanOrEqual(321);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await page.getByRole("button", { name: "Photo 1 fooled Atlas" }).click();
  const next = page.getByRole("button", { name: /^(Next pair|Start a new run)$/ });
  await expect(next).toBeFocused();
  const box = (await next.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(569);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("your picks show on Your map's What fools Atlas, by how far apart the misses were", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./fooled-atlas");
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  const bands = ["close", "clear", "far"] as const;
  const expected = new Map(bands.map((b) => [b, { pairs: 0, you: 0, atlas: 0 }]));
  let ties = 0;
  // Three right picks, then leave mid-run: all three already count.
  for (let n = 0; n < 3; n++) {
    await expect(page.getByRole("button", { name: "Photo 1 fooled Atlas" })).toBeEnabled();
    const { ids, fooled } = await pairOnScreen(page);
    await page.keyboard.press(String(fooled ?? 1));
    await expect(card.getByRole("heading")).toBeVisible();
    if (fooled === null) ties++;
    else {
      const [a, b] = ids.map(missKm);
      const ratio = Math.max(a, b) / Math.max(Math.min(a, b), 1);
      const t = expected.get(ratio < 3 ? "close" : ratio < 10 ? "clear" : "far")!;
      // Atlas's own pick is the photo it was less sure of.
      const [sureA, sureB] = ids.map((id) => ATLAS.guesses[id]!.confidence);
      const own = sureB < sureA ? 2 : 1;
      t.pairs++;
      t.you++;
      if (own === fooled) t.atlas++;
    }
    await card.getByRole("button", { name: "Next pair" }).click();
  }

  await page.goto("./map");
  const section = page.getByTestId("fooled-read");
  await expect(section.getByRole("heading", { name: "What fools Atlas" })).toBeVisible();
  const pairs = 3 - ties;
  const atlas = [...expected.values()].reduce((s, t) => s + t.atlas, 0);
  if (pairs > 0) {
    await expect(page.getByTestId("fooled-read-line")).toContainText(
      `You picked ${pairs} of ${pairs} pair`,
    );
    await expect(page.getByTestId("fooled-read-line")).toContainText(
      `Atlas's own sureness picked ${atlas} (`,
    );
  }
  if (ties > 0) await expect(page.getByTestId("fooled-read-ties")).toContainText(`${ties} dead`);
  for (const b of bands) {
    const t = expected.get(b)!;
    await expect(page.getByTestId(`fooled-read-${b}`)).toHaveAttribute(
      "data-pairs",
      String(t.pairs),
    );
    await expect(page.getByTestId(`fooled-read-${b}-you`)).toHaveAttribute(
      "data-correct",
      String(t.you),
    );
    await expect(page.getByTestId(`fooled-read-${b}-atlas`)).toHaveAttribute(
      "data-correct",
      String(t.atlas),
    );
  }
  const box = (await page.getByTestId("fooled-read-far").boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(321);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await section.getByRole("link", { name: "Play Which fooled Atlas?" }).click();
  await expect(page).toHaveURL(/\/fooled-atlas\/?$/);
});

test("a challenge link deals a friend the same pairs, with the run to beat and the photo they picked", async ({
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
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  const sent = () => page.evaluate(() => (window as unknown as { sent: string }).sent);
  const pick = (n: number) => page.getByRole("button", { name: `Photo ${n} fooled Atlas` });

  // The sender calls one pair right, then misses the first pair that can be called.
  await page.goto("./fooled-atlas");
  const chain: string[] = [];
  let streak = 0;
  let missPick = 0;
  for (let i = 0; i < 40; i++) {
    await expect(pick(2)).toBeEnabled();
    const { ids, fooled } = await pairOnScreen(page);
    if (chain.length === 0) chain.push(ids[0]);
    chain.push(ids[1]);
    if (streak >= 1 && fooled !== null) {
      missPick = fooled === 1 ? 2 : 1;
      await pick(missPick).click();
      break;
    }
    await pick(fooled ?? 1).click();
    streak++;
    await card.getByRole("button", { name: "Next pair" }).click();
  }
  await expect(card).toContainText(`Run over: ${streak} pair`);
  const challengeButton = card.getByRole("button", { name: "Challenge a friend" });
  await expect(challengeButton).toBeInViewport();
  await challengeButton.click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const message = await sent();
  expect(message).toContain(`I called ${streak} pair`);
  expect(message).toMatch(/Atlas's own pick: \d+ of \d+ pairs?\./);
  const link = message.split("\n").at(-1)!;
  expect(link).toMatch(
    new RegExp(`/whereabout/fooled-atlas/?\\?challenge=${chain.join("\\.")}_[0-9a-z]+_${streak}$`),
  );

  // The friend, with nothing kept, gets the same chain and calls every pair of it right.
  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  await expect(page.getByText(`A friend's challenge: ${streak} pair`)).toBeVisible();
  for (let i = 0; i + 1 < chain.length; i++) {
    await expect(pick(2)).toBeEnabled();
    const { ids, fooled } = await pairOnScreen(page);
    expect(ids).toEqual([chain[i], chain[i + 1]]);
    await pick(fooled ?? 1).click();
    if (i === chain.length - 2) {
      await expect(card).toContainText(`That beats your friend's ${streak} in a row!`);
      await expect(card).toContainText(
        `Your friend's run ended here: they picked photo ${missPick}.`,
      );
      await expect(page.getByTestId(`fooled-photo-${missPick}`)).toContainText("Friend's pick");
      await expect(page.getByTestId(`fooled-photo-${3 - missPick}`)).not.toContainText(
        "Friend's pick",
      );
    } else {
      await expect(card).not.toContainText("Your friend's run ended here");
    }
    await card.getByRole("button", { name: "Next pair" }).click();
  }

  // Past the friend's photos the run plays on with new ones; miss the first pair we can.
  let mine = chain.length - 1;
  for (let i = 0; i < 40; i++) {
    await expect(pick(2)).toBeEnabled();
    const { ids, fooled } = await pairOnScreen(page);
    expect(chain).not.toContain(ids[1]);
    if (fooled !== null) {
      await pick(fooled === 1 ? 2 : 1).click();
      break;
    }
    await pick(1).click();
    mine++;
    await card.getByRole("button", { name: "Next pair" }).click();
  }
  await expect(card).toContainText(
    `Run over: ${mine} pairs in a row. You beat your friend's ${streak} in a row by ${mine - streak}.`,
  );
  const { width, height } = page.viewportSize()!;
  const box = (await card.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  expect(await page.evaluate(() => localStorage.getItem("whereabout:fooled-atlas-best"))).toBe(
    null,
  );

  const back = card.getByRole("button", { name: "Send yours back" });
  await expect(back).toBeInViewport();
  await back.click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const reply = await sent();
  expect(reply).toContain(`That beats your ${streak}. Your turn to read Atlas's misses.`);
  expect(reply).toMatch(new RegExp(`_${mine}$`));

  // Head to head: both runs drawn as a 1080px picture, saved, with the reply link copied.
  await page.evaluate(() => ((window as unknown as { sent: string }).sent = ""));
  const picture = card.getByRole("button", { name: "Share head to head" });
  await expect(picture).toBeInViewport({ ratio: 1 });
  const [download] = await Promise.all([page.waitForEvent("download"), picture.click()]);
  expect(download.suggestedFilename()).toBe("whereabout-which-fooled-atlas-head-to-head.png");
  const png = readFileSync((await download.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1080]);
  await expect(page.getByText("Head to head saved.", { exact: false })).toBeVisible();
  expect(await sent()).toBe(reply);

  // A fresh run drops the link, so a reload doesn't deal the challenge again.
  await card.getByRole("button", { name: "Play a fresh run" }).click();
  await expect(
    page.getByText("Which fooled Atlas? Pick the photo Atlas placed further from home."),
  ).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(errors).toEqual([]);
});

test("a broken Which fooled Atlas? challenge says so and deals a fresh run", async ({ page }) => {
  await page.goto("./fooled-atlas?challenge=wm001_3_9");
  await expect(page.getByText(/That challenge link was cut short/)).toBeVisible();
  await expect(
    page.getByText("Which fooled Atlas? Pick the photo Atlas placed further from home."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Photo 2 fooled Atlas" })).toBeEnabled();
});

test("the end of a Which fooled Atlas? run keeps both its buttons on a 320px phone", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./fooled-atlas");
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  for (let i = 0; i < 40; i++) {
    await expect(page.getByRole("button", { name: "Photo 2 fooled Atlas" })).toBeEnabled();
    const { fooled } = await pairOnScreen(page);
    await page.getByRole("button", { name: `Photo ${fooled === 1 ? 2 : 1} fooled Atlas` }).click();
    if (fooled !== null) break;
    await card.getByRole("button", { name: "Next pair" }).click();
  }
  for (const name of ["Start a new run", "Challenge a friend"]) {
    await expect(card.getByRole("button", { name })).toBeInViewport();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("ten right picks in one run earn Blind spot, with every pair counted toward Mind over model", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./stamps");
  await expect(page.getByRole("heading", { name: "Which fooled Atlas?", level: 2 })).toBeVisible();
  const blindSpot = page.getByTestId("stamp-fooled-blind-spot");
  await expect(blindSpot).toHaveAttribute("data-earned", "false");
  await expect(page.getByTestId("stamp-fooled-blind-spot-progress")).toHaveText(
    "0 of 10 picks in a row",
  );
  await expect(page.getByTestId("stamp-fooled-mind-over-model-progress")).toHaveText(
    "0 of 50 pairs read",
  );

  // Ten right picks from the shipped data, by key, then leave mid-run.
  await page
    .getByTestId("stamps-fooled-intro")
    .getByRole("link", { name: "Which fooled Atlas?", exact: true })
    .click();
  await expect(page).toHaveURL(/\/fooled-atlas\/?$/);
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  // Dead heats are never read as right, so only pairs that can be called count, for both sides.
  let pairs = 0;
  let atlas = 0;
  for (let n = 0; n < 10; n++) {
    await expect(page.getByRole("button", { name: "Photo 1 fooled Atlas" })).toBeEnabled();
    const { ids, fooled } = await pairOnScreen(page);
    if (fooled !== null) {
      pairs++;
      // Atlas's own pick is the photo it was less sure of; even sureness picks the first.
      const [a, b] = ids.map((id) => ATLAS.guesses[id]!.confidence);
      if ((b < a ? 2 : 1) === fooled) atlas++;
    }
    await page.keyboard.press(String(fooled ?? 1));
    await expect(card).toBeVisible();
    await page.keyboard.press("Enter");
  }
  await expect(page.getByText("Streak", { exact: true }).locator("+ dd")).toHaveText("10");

  await page.goto("./stamps");
  await expect(blindSpot).toHaveAttribute("data-earned", "true");
  await expect(page.getByTestId("stamps-standing")).toContainText("since you last looked");
  await expect(page.getByTestId("stamp-fooled-mind-over-model-progress")).toHaveText(
    `${pairs} of 50 ${pairs === 1 ? "pair" : "pairs"} read`,
  );
  if (pairs > 0)
    await expect(page.getByTestId("stamp-fooled-mind-over-model")).toContainText(
      `Pairs right so far: yours ${pairs}, Atlas's own sureness ${atlas}`,
    );

  await page.setViewportSize({ width: 320, height: 700 });
  await blindSpot.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page
    .getByTestId("stamps-fooled-intro")
    .getByRole("link", { name: /what fools Atlas on Your map/ })
    .click();
  await expect(page).toHaveURL(/\/map\/?$/);
  expect(errors).toEqual([]);
});
