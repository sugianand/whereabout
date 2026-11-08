import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG: { id: string; lng: number; place: string }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const BY_ID = new Map(CATALOG.map((p) => [p.id, p]));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

const tile = (page: Page, n: number) => page.getByTestId(`line-photo-${n}`);
const lock = (page: Page) => page.getByRole("button", { name: "Lock it in" });

async function row(page: Page): Promise<string[]> {
  return Promise.all(
    [1, 2, 3, 4].map(async (n) => (await tile(page, n).getAttribute("data-photo"))!),
  );
}

const west = (a: string, b: string) => BY_ID.get(a)!.lng - BY_ID.get(b)!.lng;

/** Hold a tile by its middle and let go over the middle of another place. */
async function drag(page: Page, from: number, to: number) {
  const a = (await tile(page, from).boundingBox())!;
  const b = (await tile(page, to).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

test("Line them up plays five rows by drag and tap, against Atlas, and keeps the best", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./line-up");
  await expect(page.getByText("Line them up: west to east")).toBeVisible();
  const { width, height } = page.viewportSize()!;
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });

  // A drag lifts a photo into another place, and the rest close up, without counting as a tap.
  await expect(lock(page)).toBeEnabled();
  const before = await row(page);
  await drag(page, 1, 3);
  expect(await row(page)).toEqual([before[1], before[2], before[0], before[3]]);
  await expect(page.getByRole("status")).toHaveText(/^Tap two photos/);

  for (let i = 1; i <= 5; i++) {
    await expect(lock(page)).toBeEnabled();
    await expect(page.getByText(`Row ${i} of 5`, { exact: true })).toBeVisible();
    for (const n of [1, 2, 3, 4]) {
      const box = (await tile(page, n).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.height).toBeGreaterThan(80);
    }
    const lockBox = (await lock(page).boundingBox())!;
    expect(lockBox.y + lockBox.height).toBeLessThanOrEqual(height + 1);

    // Tap each photo to its place, west first.
    const want = [...(await row(page))].sort(west);
    for (let place = 0; place < want.length; place++) {
      const at = (await row(page)).indexOf(want[place]);
      if (at === place) continue;
      await tile(page, place + 1).getByRole("button", { name: /^Photo in place/ }).click();
      await expect(page.getByRole("status")).toHaveText("Now tap the place it goes.");
      await tile(page, at + 1).getByRole("button", { name: /^Photo in place/ }).click();
    }
    expect(await row(page)).toEqual(want);

    await lock(page).click();
    await expect(card.getByRole("heading")).toHaveText("All four in place");
    // The reveal names the places, in order, and every photo's credit.
    for (const [place, id] of want.entries()) {
      await expect(tile(page, place + 1)).toContainText(BY_ID.get(id)!.place);
      await expect(tile(page, place + 1).getByRole("link", { name: /^Photo: / })).toBeVisible();
    }
    const next = card.getByRole("button", { name: i < 5 ? "Next row" : "See your score" });
    await expect(next).toBeFocused();
    await expect(next).toBeInViewport();
    await page.keyboard.press("Enter");
  }

  await expect(page.getByRole("heading", { name: "20 in place" })).toBeVisible();
  await expect(page.getByText(/That's your new best!/)).toBeVisible();
  await expect(page.getByTestId("line-atlas-total")).toHaveText(/^Atlas: \d+ of \d+ in place\.$/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("whereabout:line-up-best")))
    .toBe("20");

  await page.getByRole("button", { name: "Play again" }).click();
  await expect(lock(page)).toBeEnabled();
  await expect(page.getByText("Row 1 of 5", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a photo can be looked at closer, and the row waits", async ({ page }) => {
  await page.goto("./line-up");
  await expect(lock(page)).toBeEnabled();
  const before = await row(page);
  await page.getByRole("button", { name: "Look closer at the photo in place 3" }).click();
  const dialog = page.getByRole("dialog", { name: "The photo, closer" });
  await expect(dialog.getByRole("button", { name: "Back to the row" })).toBeFocused();
  await expect(dialog.getByRole("link", { name: /^Photo: / })).toBeVisible();
  await dialog.getByRole("button", { name: "Back to the row" }).click();
  await expect(dialog).toBeHidden();
  expect(await row(page)).toEqual(before);
});

test("it is in the Games menu, with its best", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("whereabout:line-up-best", "13"));
  await page.goto("./");
  await page.getByRole("button", { name: "Games" }).click();
  const link = page.getByRole("link", { name: /^Line them up/ });
  await expect(link).toContainText("Best: 13 of 20 in place");
  await link.click();
  await expect(page).toHaveURL(/\/line-up\/?$/);
});

test("fits a 320px phone, placing and at the reveal", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./line-up");
  await expect(lock(page)).toBeEnabled();

  const title = (await page.getByRole("link", { name: "Whereabout" }).boundingBox())!;
  const score = (await page.getByText("Row 1 of 5", { exact: true }).boundingBox())!;
  expect(title.x + title.width).toBeLessThanOrEqual(score.x);
  await expect(lock(page)).toBeInViewport();

  const first = (await tile(page, 1).boundingBox())!;
  const last = (await tile(page, 4).boundingBox())!;
  expect(first.height).toBeGreaterThan(44);
  expect(last.y).toBeGreaterThan(first.y);
  await expect(page.getByRole("button", { name: /^Look closer/ }).first()).toBeInViewport();

  await lock(page).click();
  await expect(page.getByRole("button", { name: "Next row" })).toBeInViewport();
  for (const n of [1, 2, 3, 4]) {
    const box = (await tile(page, n).boundingBox())!;
    expect(box.height).toBeGreaterThan(44);
    await expect(tile(page, n).getByRole("link", { name: /^Photo: / })).toBeInViewport();
  }
  const scroll = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll[0]).toBeLessThanOrEqual(scroll[1]);
});

test("today's Line them up deals the day's rows once, resumes after a reload, and shares squares", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const today = new Date().toISOString().slice(0, 10);
  const { width, height } = page.viewportSize()!;

  // The free game links to today's.
  await page.goto("./line-up");
  await page.getByRole("link", { name: "Today's game" }).click();
  await expect(page.getByText(`Today's rows (${today}): west to east`)).toBeVisible();

  // A fresh player (nothing kept) is dealt the same photos.
  await expect(lock(page)).toBeEnabled();
  const first = [...(await row(page))].sort();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(lock(page)).toBeEnabled();
  expect([...(await row(page))].sort()).toEqual(first);

  // Everything fits with the header's extra link, down to a 320px phone.
  for (const w of [width, 320]) {
    await page.setViewportSize({ width: w, height: Math.min(height, 700) });
    const box = (await lock(page).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(Math.min(height, 700) + 1);
    expect((await tile(page, 1).boundingBox())!.height).toBeGreaterThan(70);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
  }
  await page.setViewportSize({ width, height });

  for (let i = 1; i <= 5; i++) {
    await expect(lock(page)).toBeEnabled();
    await expect(page.getByText(`Row ${i} of 5`, { exact: true })).toBeVisible();
    await lock(page).click();
    if (i === 2) {
      // A reload on the reveal picks up at the next row, the score kept.
      const kept = await page.getByText("Row 2 of 5", { exact: true }).locator("+ dd").textContent();
      await page.reload();
      await expect(page.getByText("Row 3 of 5", { exact: true })).toBeVisible();
      await expect(page.getByText("Row 3 of 5", { exact: true }).locator("+ dd")).toHaveText(kept!);
      continue;
    }
    await page.getByRole("button", { name: i === 5 ? "See your score" : "Next row" }).click();
  }

  const headline = page.getByRole("heading", { level: 1 });
  await expect(headline).toHaveText(/^\d+ in place$/);
  const total = await headline.textContent();
  await expect(page.getByRole("list", { name: "Your rows" }).getByRole("listitem")).toHaveCount(5);

  // A reload shows the day's result, never the rows again.
  await page.reload();
  await expect(headline).toHaveText(total!);
  await expect(page.getByText(/The next run is dealt in \d+/)).toBeVisible();
  await expect(lock(page)).toHaveCount(0);

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
  const points = total!.replace(" in place", "");
  expect(sent).toContain(`Whereabout · Line them up · ${today}\n↔️ ${points} of 20 in place\n`);
  expect(sent).toMatch(/(\n[🟩🟥]{4}){5}\n/u);
  expect(sent).toMatch(/\/whereabout\/line-up\/daily\/?$/);

  // Today counts it, and the free games' best is its own.
  expect(await page.evaluate(() => localStorage.getItem("whereabout:line-up-best"))).toBe(null);
  await page.goto("./today");
  await expect(page.getByTestId("today-line-up")).toHaveAttribute("data-status", "done");
  expect(errors).toEqual([]);
});

/** Tap each photo of the row to its place, west first. */
async function solve(page: Page) {
  const want = [...(await row(page))].sort(west);
  for (let place = 0; place < want.length; place++) {
    const at = (await row(page)).indexOf(want[place]);
    if (at === place) continue;
    await tile(page, place + 1).getByRole("button", { name: /^Photo in place/ }).click();
    await tile(page, at + 1).getByRole("button", { name: /^Photo in place/ }).click();
  }
}

test("a challenge link deals a friend the same rows, opening as they did, with the count to beat", async ({
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

  // The sender lines every row up.
  await page.goto("./line-up");
  const opened: string[][] = [];
  for (let i = 1; i <= 5; i++) {
    await expect(lock(page)).toBeEnabled();
    await expect(page.getByText(`Row ${i} of 5`, { exact: true })).toBeVisible();
    opened.push(await row(page));
    await solve(page);
    await lock(page).click();
    await card.getByRole("button", { name: i < 5 ? "Next row" : "See your score" }).click();
  }
  await expect(page.getByRole("heading", { name: "20 in place" })).toBeVisible();
  await page.getByRole("button", { name: "Challenge a friend" }).click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(sent).toContain("I put 20 of 20 photos in place, west to east.");
  for (const p of CATALOG) expect(sent).not.toContain(p.place);
  const link = sent.split("\n").at(-1)!;
  expect(link).toMatch(/\/whereabout\/line-up\/?\?challenge=[\w.-]+_4\.4\.4\.4\.4$/);

  // The friend opens it with nothing kept, and locks each row just as it opens.
  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  await expect(page.getByText("A friend's challenge: 20 in place to beat")).toBeVisible();
  const theirs: number[] = [];
  for (let i = 0; i < 5; i++) {
    await expect(lock(page)).toBeEnabled();
    await expect(page.getByText(`Row ${i + 1} of 5`, { exact: true })).toBeVisible();
    expect(await row(page)).toEqual(opened[i]);
    await lock(page).click();
    const verdict = (await card.getByRole("heading").textContent())!;
    theirs.push(Number(verdict.match(/^(\d) of 4 in place$/)![1]));
    await expect(card).toContainText("Your friend: 4 in place.");
    await card.getByRole("button", { name: i < 4 ? "Next row" : "See your score" }).click();
  }
  const total = theirs.reduce((a, b) => a + b, 0);
  // A row never opens already in order, so the friend's 20 can't be matched by leaving them.
  expect(total).toBeLessThan(20);
  await expect(page.getByRole("heading", { name: `${total} in place` })).toBeVisible();
  await expect(
    page.getByText(new RegExp(`Your friend won by ${20 - total} in place\\. Your friend had 20\\.`)),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("whereabout:line-up-best"))).toBe(null);

  await page.getByRole("button", { name: "Send yours back" }).click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const reply = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(reply).toContain("Your 20 wins this time. Try them again?");
  expect(reply.endsWith(`_${theirs.join(".")}`)).toBe(true);

  // A fresh game drops the link, so a reload doesn't deal the challenge again.
  await page.getByRole("button", { name: "Play a fresh game" }).click();
  await expect(page.getByText("Line them up: west to east")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(errors).toEqual([]);
});

test("a broken Line them up challenge says so and deals a fresh game", async ({ page }) => {
  await page.goto("./line-up?challenge=wm001.wm002_3");
  await expect(page.getByText(/That challenge link was cut short/)).toBeVisible();
  await expect(page.getByText("Line them up: west to east")).toBeVisible();
  await expect(lock(page)).toBeEnabled();
});
