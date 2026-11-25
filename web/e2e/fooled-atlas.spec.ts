import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const ATLAS: { guesses: Record<string, { lat: number; lng: number }> } = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/atlas.json"), "utf8"),
);
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
