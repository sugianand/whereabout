import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const ATLAS: { guesses: Record<string, { lat: number; lng: number }> } = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/atlas.json"), "utf8"),
);
const CATALOG: { id: string; lat: number; lng: number; place: string }[] = JSON.parse(
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

test("today's Which fooled Atlas? deals the day's pairs once, resumes after a reload, and shares as counts", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const today = new Date().toISOString().slice(0, 10);

  // The free runs link to today's run.
  await page.goto("./fooled-atlas");
  await page.getByRole("link", { name: "Today's run" }).click();
  await expect(page).toHaveURL(/\/fooled-atlas\/daily\/?$/);
  await expect(page.getByText(`today's run (${today})`)).toBeVisible();
  await expect(page.getByText("Best", { exact: true })).toHaveCount(0);
  const { width, height } = page.viewportSize()!;

  // Everyone on one day gets the same pairs: a fresh player (nothing kept) is dealt the same.
  await expect(page.getByRole("button", { name: "Photo 1 fooled Atlas" })).toBeEnabled();
  const first = (await pairOnScreen(page)).ids;
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("fooled-photo-1")).toHaveAttribute("data-photo", first[0]);
  await expect(page.getByTestId("fooled-photo-2")).toHaveAttribute("data-photo", first[1]);

  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  const streakShown = page.getByText("Streak", { exact: true }).locator("+ dd");

  // One right pick (from what the data says Atlas missed by more), then a reload mid-run picks
  // up at the next pair with the streak so far.
  const { ids, fooled } = await pairOnScreen(page);
  await page.getByRole("button", { name: `Photo ${fooled ?? 1} fooled Atlas` }).click();
  await expect(card.getByRole("heading")).toHaveText(fooled ? "Right" : "Too close to call");
  await page.reload();
  await expect(page.getByTestId("fooled-photo-1")).toHaveAttribute("data-photo", ids[1]);
  await expect(streakShown).toHaveText("1");

  // Then the wrong photo on the first pair that can be called, which ends today's run.
  let streak = 1;
  for (;;) {
    await expect(page.getByRole("button", { name: "Photo 1 fooled Atlas" })).toBeEnabled();
    const pair = await pairOnScreen(page);
    await page.keyboard.press(pair.fooled === 1 ? "2" : "1");
    if (pair.fooled !== null) break;
    streak++;
    await card.getByRole("button", { name: "Next pair" }).click();
  }
  await expect(card.getByRole("heading")).toHaveText("Wrong");
  const plural = streak === 1 ? "pair" : "pairs";
  await expect(card).toContainText(`Today's run is over: ${streak} ${plural} in a row.`);
  await expect(card.getByRole("button", { name: "Start a new run" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Share today's run" })).toBeFocused();
  const box = (await card.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);

  // A reload shows the day's result, never the pairs again.
  await page.reload();
  await expect(page.getByRole("heading", { name: `${streak} ${plural} in a row` })).toBeVisible();
  await expect(page.getByText(/The next run is dealt in \d+/)).toBeVisible();
  await expect(page.getByRole("button", { name: /fooled Atlas$/ })).toHaveCount(0);

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
    `Whereabout · Which fooled Atlas? · ${today}\n🤖 ${streak} ${plural} in a row\n`,
  );
  expect(sent).toContain(`${"🟩".repeat(streak)}🟥`);
  expect(sent).toMatch(/\/whereabout\/fooled-atlas\/daily\/?$/);
  // Counts only: no place from the catalog reaches the share.
  for (const p of CATALOG) {
    expect(sent).not.toContain(p.id);
    expect(sent).not.toContain(p.place);
  }

  // The free runs' best is its own.
  expect(await page.evaluate(() => localStorage.getItem("whereabout:fooled-atlas-best"))).toBe(
    null,
  );
  await page.getByRole("link", { name: "Play a free run" }).click();
  await expect(
    page.getByText("Which fooled Atlas? Pick the photo Atlas placed further from home."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("today's Which fooled Atlas? fits a 320px phone, its link to free runs on screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./fooled-atlas/daily");
  for (const n of [1, 2]) {
    const button = page.getByRole("button", { name: `Photo ${n} fooled Atlas` });
    await expect(button).toBeEnabled();
    const label = (await button.locator("span").boundingBox())!;
    expect(label.x + label.width).toBeLessThanOrEqual(321);
    expect(label.y + label.height).toBeLessThanOrEqual(569);
  }
  const free = (await page.getByRole("link", { name: "Free runs" }).boundingBox())!;
  expect(free.x + free.width).toBeLessThanOrEqual(321);
  expect(free.y).toBeGreaterThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
