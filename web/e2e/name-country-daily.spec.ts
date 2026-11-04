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

const option = (page: Page, n: number) => page.getByTestId(`name-option-${n}`);

async function shown(page: Page) {
  await expect(option(page, 4)).toBeEnabled();
  const id = (await page.locator("main").getAttribute("data-photo"))!;
  const names = await Promise.all(
    [1, 2, 3, 4].map(async (n) => (await option(page, n).getAttribute("data-country"))!),
  );
  return { id, names, right: names.indexOf(COUNTRY.get(id)!) + 1 };
}

test("today's Name the country deals the day's photos once, resumes, and shares as counts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const today = new Date().toISOString().slice(0, 10);

  // The free runs link to today's run.
  await page.goto("./name-country");
  await page.getByRole("link", { name: "Today's run" }).click();
  await expect(page.getByText(`Today's run, ${today}`)).toBeVisible();

  // Everyone on one day gets the same photo and names: a fresh player is dealt the same.
  const first = await shown(page);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  expect(await shown(page)).toEqual(first);

  // A right tap, then a reload: the run carries on at the next photo with the streak so far.
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  await option(page, first.right).click();
  await expect(card.getByRole("heading")).toHaveText(/^Right: /);
  await page.reload();
  const second = await shown(page);
  expect(second.id).not.toBe(first.id);
  await expect(page.getByText("Streak", { exact: true }).locator("+ dd")).toHaveText("1");

  // A wrong tap ends today's run.
  await option(page, (second.right % 4) + 1).click();
  await expect(card.getByRole("heading")).toHaveText(/^Wrong: /);
  await expect(card).toContainText("Today's run is over: 1 country in a row.");
  await expect(card.getByRole("button", { name: "Share today's run" })).toBeInViewport();
  await expect(card.getByRole("button", { name: "Start a new run" })).toHaveCount(0);

  // A reload shows the day's result, never the photos again.
  await page.reload();
  await expect(page.getByRole("heading", { name: "1 country in a row" })).toBeVisible();
  await expect(page.getByText(/The next run is dealt in \d+/)).toBeVisible();
  await expect(option(page, 1)).toHaveCount(0);

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
  expect(sent).toContain(`Whereabout · Name the country · ${today}\n🗺️ 1 country in a row\n🟩🟥\n`);
  expect(sent).toMatch(/\/whereabout\/name-country\/daily\/?$/);
  for (const id of [first.id, second.id]) expect(sent).not.toContain(id);

  // The free runs' best is its own.
  expect(await page.evaluate(() => localStorage.getItem("whereabout:name-country-best"))).toBe(
    null,
  );
  await page.getByRole("link", { name: "Play a free run" }).click();
  await expect(page.getByText("Name the country: which of these four?")).toBeVisible();
  expect(errors).toEqual([]);
});

test("today's run keeps its share in view on a 320px phone, and Today counts it", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./name-country/daily");
  const { right } = await shown(page);
  const wrong = (right % 4) + 1;
  await option(page, wrong).click();

  const share = page.getByRole("button", { name: "Share today's run" });
  await expect(share).toBeInViewport({ ratio: 1 });
  const box = (await share.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(568);

  await page.goto("./today");
  const card = page.getByTestId("today-name-country");
  await expect(card).toHaveAttribute("data-status", "done");
  await expect(card).toContainText("0 countries in a row");
});
