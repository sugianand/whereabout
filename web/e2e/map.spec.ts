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
    await expect(page).toHaveURL(/\?region=[a-z-]+$/);
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
