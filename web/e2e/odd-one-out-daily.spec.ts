import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { continentOf } from "../src/lib/continents";

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

async function shown(page: Page): Promise<string[]> {
  return Promise.all(
    [1, 2, 3, 4].map(
      async (n) => (await page.getByTestId(`odd-photo-${n}`).getAttribute("data-photo"))!,
    ),
  );
}

/** The slot (1 to 4) of the photo from another continent, from the catalog, not the page. */
function oddSlot(ids: string[]): number {
  const continents = ids.map((id) => continentOf(COUNTRY.get(id)));
  return continents.findIndex((c) => continents.filter((d) => d === c).length === 1) + 1;
}

const tap = (page: Page, n: number) =>
  page.getByRole("button", { name: `Photo ${n} is the odd one out` });

test("today's Odd one out deals the day's quads once, resumes after a reload, and shares as counts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const today = new Date().toISOString().slice(0, 10);

  // The free runs link to today's run.
  await page.goto("./odd-one-out");
  await page.getByRole("link", { name: "Today's run" }).click();
  await expect(page.getByText(`today's run (${today})`)).toBeVisible();
  const { width, height } = page.viewportSize()!;

  // Everyone on one day gets the same quad: a fresh player (nothing kept) is dealt the same.
  await expect(tap(page, 1)).toBeEnabled();
  const first = await shown(page);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(tap(page, 1)).toBeEnabled();
  expect(await shown(page)).toEqual(first);

  // A right tap, then a reload: the run carries on at the next quad with the streak so far.
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  await tap(page, oddSlot(first)).click();
  await expect(card.getByRole("heading")).toHaveText("Right");
  await page.reload();
  await expect(tap(page, 1)).toBeEnabled();
  await expect(page.getByText("Streak", { exact: true }).locator("+ dd")).toHaveText("1");
  const second = await shown(page);
  expect(second).not.toEqual(first);

  // A wrong tap ends today's run.
  await tap(page, (oddSlot(second) % 4) + 1).click();
  await expect(card.getByRole("heading")).toHaveText("Wrong");
  await expect(card).toContainText("Today's run is over: 1 quad in a row.");
  const box = (await card.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  await expect(card.getByRole("button", { name: "Start a new run" })).toHaveCount(0);

  // A reload shows the day's result, never the quads again.
  await page.reload();
  await expect(page.getByRole("heading", { name: "1 quad in a row" })).toBeVisible();
  await expect(page.getByText(/The next run is dealt in \d+/)).toBeVisible();
  await expect(page.getByRole("button", { name: /is the odd one out/ })).toHaveCount(0);

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
  expect(sent).toContain(`Whereabout · Odd one out · ${today}\n🧩 1 quad in a row\n🟩🟥\n`);
  expect(sent).toMatch(/\/whereabout\/odd-one-out\/daily\/?$/);
  for (const id of [...first, ...second]) expect(sent).not.toContain(id);

  // The free runs' best is its own.
  expect(await page.evaluate(() => localStorage.getItem("whereabout:odd-one-out-best"))).toBe(null);
  await page.getByRole("link", { name: "Play a free run" }).click();
  await expect(page.getByText(/^Odd one out: three photos share a continent/)).toBeVisible();
  expect(errors).toEqual([]);
});
