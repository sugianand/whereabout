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

test("an empty album counts every photo still to find and points to a first game", async ({
  page,
}) => {
  await page.goto("./album/");
  await expect(page.getByRole("heading", { name: "Your album", level: 1 })).toBeVisible();
  await expect(page.getByTestId("album-found")).toHaveText("0");
  await expect(page.getByRole("link", { name: "Play a game →" })).toBeVisible();
  const total = Number(
    (await page.getByText(/of [\d,]+ photos found/).textContent())!
      .match(/of ([\d,]+)/)![1]
      .replace(/,/g, ""),
  );
  // The continents' blank cards add up to the whole album.
  let left = 0;
  for (const card of await page.getByTestId("album-left").all()) {
    left += Number((await card.locator("span").first().textContent())!.replace(/,/g, ""));
  }
  expect(left).toBe(total);
  await expect(page.getByTestId("album-photo")).toHaveCount(0);
});

test("the photos of a game land in the album under their continents, with their pictures", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./?daily");
  for (let round = 1; round <= 2; round++) {
    const card = await playRound(page);
    if (round < 2) await card.getByRole("button", { name: "Next photo" }).click();
  }
  const kept = JSON.parse(
    (await page.evaluate(() => localStorage.getItem("whereabout:played"))) ?? "[]",
  ) as { id: string; place: string }[];
  expect(kept).toHaveLength(2);

  await page.goto("./map/");
  await page.getByRole("link", { name: "Your album →" }).click();
  await expect(page).toHaveURL(/\/album\/?$/);
  await expect(page.getByTestId("album-found")).toHaveText("2");

  const photos = page.getByTestId("album-photo");
  await expect(photos).toHaveCount(2);
  for (const { place } of kept) {
    const card = photos.filter({ hasText: place });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(/off|No pin/);
    const img = card.locator("img");
    await expect(img).toHaveJSProperty("complete", true);
    expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  }

  // Each continent's count of found photos adds up to the two played.
  let found = 0;
  for (const row of await page.getByTestId("album-continent").all()) {
    const m = (await row.getByText(/^[\d,]+ of [\d,]+ found$/).textContent())!.match(/^(\d+)/)!;
    found += Number(m[1]);
  }
  expect(found).toBe(2);

  // No sideways scroll, even on a phone.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("a continent's blank card leads to a game on that continent", async ({ page }) => {
  await page.goto("./album/");
  const play = page
    .getByTestId("album-left")
    .getByRole("link", { name: /^Play .+ →$/ })
    .first();
  await expect(play).toHaveAttribute("href", /\?region=[a-z-]+$/);
  await play.click();
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
});

test("a found photo opens large with the day found and both distances, and turns through its continent", async ({
  page,
}) => {
  await page.goto("./?daily");
  for (let round = 1; round <= 3; round++) {
    const card = await playRound(page);
    if (round < 3) await card.getByRole("button", { name: "Next photo" }).click();
  }
  const kept = JSON.parse(
    (await page.evaluate(() => localStorage.getItem("whereabout:played"))) ?? "[]",
  ) as { id: string; place: string; day: string }[];

  await page.goto("./album/");
  const newest = kept[kept.length - 1];
  const opener = page.getByRole("button", { name: `Open your photo from ${newest.place}` });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: newest.place });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`Found ${newest.day}`);
  await expect(dialog.getByText("You", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Atlas", { exact: true })).toBeVisible();
  const img = dialog.locator("img");
  await expect(img).toHaveJSProperty("complete", true);
  expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  // The whole sheet fits the screen's width, phone included.
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  // The arrow keys turn through the continent the photo was found on, held at its ends.
  const counter = dialog.getByText(/ · \d+ of \d+$/);
  const total = Number((await counter.textContent())!.match(/of (\d+)$/)![1]);
  await expect(counter).toHaveText(/ · 1 of \d+$/);
  if (total > 1) {
    await page.keyboard.press("ArrowRight");
    await expect(counter).toHaveText(/ · 2 of \d+$/);
    await expect(dialog.getByRole("heading")).not.toHaveText(newest.place);
    await page.keyboard.press("ArrowLeft");
  }
  await page.keyboard.press("ArrowLeft");
  await expect(counter).toHaveText(/ · 1 of \d+$/);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(opener).toBeFocused();
});
