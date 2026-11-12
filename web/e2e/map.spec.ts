import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

async function playRound(page: Page) {
  const globe = page.getByRole("application", { name: /Globe/ });
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  await globe.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^Your pin: /)).toBeVisible();
  await page.getByRole("button", { name: "Guess here" }).click();
  const card = page.getByRole("region").filter({ hasText: "It was taken in" });
  await expect(card).toBeVisible();
  return card;
}

test("an empty map points to a first game", async ({ page }) => {
  await page.goto("./map/");
  await expect(page.getByRole("heading", { name: "Your map" })).toBeVisible();
  await expect(page.getByText(/Nothing on your map yet/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Play a game" })).toBeVisible();
});

test("every round played lands on your map, coloured and counted", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./?daily");
  for (let round = 1; round <= 2; round++) {
    const card = await playRound(page);
    if (round < 2) await card.getByRole("button", { name: "Next photo" }).click();
  }
  const kept = JSON.parse(
    (await page.evaluate(() => localStorage.getItem("whereabout:played"))) ?? "[]",
  ) as { id: string; place: string; country: string | null; km: number }[];
  expect(kept).toHaveLength(2);
  const countries = new Set(kept.map((p) => p.country).filter(Boolean)).size;

  await page.goto("./map/");
  const numbers = page.getByLabel("Your map in numbers");
  await expect(numbers.getByText("Photos").locator("+ dd")).toHaveText("2");
  await expect(numbers.getByText("Countries").locator("+ dd")).toHaveText(String(countries));
  // Both photos are drawn on the globe once it has loaded.
  await expect(page.getByTestId("played-globe")).toHaveAttribute("data-dots", "2", {
    timeout: 15_000,
  });
  const canvas = page.locator("canvas.maplibregl-canvas");
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  expect(box.height, "the globe gets a real share of the screen").toBeGreaterThan(300);

  // The newest round is listed first; picking it rings it on the globe.
  const rounds = page.getByRole("list", { name: "Your rounds" }).getByRole("button");
  await expect(rounds).toHaveCount(2);
  await expect(rounds.first()).toContainText(kept[1].place);
  await rounds.first().click();
  await expect(rounds.first()).toHaveAttribute("aria-pressed", "true");

  // Both rounds are closest calls, nearest first, each with its photo and Atlas's distance.
  const calls = page.getByTestId("closest-call");
  await expect(calls).toHaveCount(2);
  const nearest = [...kept].sort((a, b) => a.km - b.km)[0];
  await expect(calls.first()).toContainText(nearest.place);
  for (const card of await calls.all()) {
    await expect(card.getByRole("img")).toHaveJSProperty("complete", true);
    // The fixture photo stands in for Wikimedia's thumbnail.
    expect(
      await card.getByRole("img").evaluate((i: HTMLImageElement) => i.naturalWidth),
    ).toBeGreaterThan(0);
    await expect(card).toContainText(/Atlas\s*([\d.,]+ k?m|No guess)/);
  }
  // A closest call opens a game on its photo's continent.
  const play = calls.getByRole("link", { name: /^Play .+ →$/ }).first();
  if ((await play.count()) > 0) {
    const name = (await play.textContent())!.replace(/^Play | →$/g, "");
    await play.click();
    // A client-side navigation away from a spinning, software-rendered globe; on the CI
    // runner's two cores it has taken longer than the default 5 s to commit the new URL.
    await expect(page).toHaveURL(/\?region=[a-z-]+$/, { timeout: 20_000 });
    await expect(page.getByText(`${name} game`, { exact: true })).toBeVisible();
    await page.goBack();
    await expect(calls).toHaveCount(2);
  }

  // Nothing spills sideways on a phone.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("your continents name the weak spot and practise it, and fit a 320px phone", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // Five rounds near the mark in Europe and five far off in Oceania, kept as the game keeps them.
  const round = (i: number, country: string, km: number) => ({
    id: `seed${i}`,
    lng: 0,
    lat: 0,
    place: `Seeded place ${i}`,
    country,
    km,
    score: 3000,
    day: "2026-11-01",
  });
  const history = [
    ...[40, 60, 80, 120, 30].map((km, i) => round(i, "FR", km)),
    ...[3000, 4200, 3800, 5000, 2600].map((km, i) => round(i + 5, "AU", km)),
  ];
  await page.addInitScript((h) => {
    localStorage.setItem("whereabout:played", h);
    localStorage.setItem("whereabout:units", "km");
  }, JSON.stringify(history));
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("./map/");

  const rows = page.getByTestId("continent-form-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Your strong suit");
  await expect(rows.nth(0)).toContainText("60 km");
  await expect(rows.nth(1)).toContainText("Your weak spot");
  await expect(rows.nth(1)).toContainText("3,800 km");

  const weak = page.getByTestId("weak-spot");
  await expect(weak).toContainText("furthest off in Oceania, about 3,800 km away");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await weak.getByRole("link", { name: "Practise Oceania" }).click();
  await expect(page).toHaveURL(/\?region=oceania$/, { timeout: 20_000 });
  await expect(page.getByText("Oceania game", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
