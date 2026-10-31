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

test("Odd one out deals four photos until the first wrong tap, and keeps the best", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./odd-one-out");
  await expect(page.getByText(/Odd one out: three photos share a continent/)).toBeVisible();
  const { width, height } = page.viewportSize()!;

  // All four photos and their tap targets fit on screen, in a two-by-two grid.
  for (const n of [1, 2, 3, 4]) {
    await expect(page.getByRole("button", { name: `Photo ${n} is the odd one out` })).toBeEnabled();
    const box = (await page.getByTestId(`odd-photo-${n}`).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    expect(box.height).toBeGreaterThan(100);
  }

  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  // Always tapping photo 1 is right about a quarter of the time: play until a miss.
  let streak = 0;
  for (let i = 0; i < 40; i++) {
    const ids = await shown(page);
    expect(new Set(ids).size).toBe(4);
    // From the catalog, not the page: three photos share a continent, and one doesn't.
    const continents = ids.map((id) => continentOf(COUNTRY.get(id)));
    const odd = continents.findIndex((c) => continents.filter((d) => d === c).length === 1);
    expect(continents.filter((c) => c !== continents[odd])).toHaveLength(3);
    await page.getByRole("button", { name: "Photo 1 is the odd one out" }).click();
    await expect(card).toBeVisible();
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    await expect(card).toContainText(
      `Photo ${odd + 1} was taken in ${continents[odd]}; the other three in ${continents[(odd + 1) % 4]}.`,
    );
    await expect(card.getByRole("heading")).toHaveText(odd === 0 ? "Right" : "Wrong");
    // Every photo now names its continent.
    for (const n of [1, 2, 3, 4]) {
      await expect(page.getByTestId(`odd-photo-${n}`)).toContainText(continents[n - 1]!);
    }

    if ((await card.getByRole("heading").textContent()) === "Wrong") break;
    streak++;
    await card.getByRole("button", { name: "Next four" }).click();
    await expect(card).toBeHidden();
    await expect.poll(() => shown(page)).not.toEqual(ids);
  }

  await expect(card).toContainText(`Run over: ${streak} quad`);
  expect(await page.evaluate(() => localStorage.getItem("whereabout:odd-one-out-best"))).toBe(
    streak > 0 ? String(streak) : null,
  );

  // A new run starts at 0, and the best survives a reload.
  await card.getByRole("button", { name: "Start a new run" }).click();
  await expect(page.getByText("Streak", { exact: true }).locator("+ dd")).toHaveText("0");
  await page.reload();
  await expect(page.getByText("Best", { exact: true }).locator("+ dd")).toHaveText(String(streak));
  // Keys 1 to 4 tap a photo.
  await expect(page.getByRole("button", { name: "Photo 4 is the odd one out" })).toBeEnabled();
  await page.keyboard.press("4");
  await expect(card).toBeVisible();
  expect(errors).toEqual([]);
});
