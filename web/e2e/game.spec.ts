import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

// The real photos are hot-linked from Wikimedia. Serve a local stand-in instead, so the test
// doesn't depend on the network and never hammers Wikimedia from CI.
const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

async function playRoundWithKeyboard(page: Page) {
  const globe = page.getByRole("application", { name: /Globe/ });
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  await globe.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByText(/^Your pin: /)).toBeVisible();
  await page.getByRole("button", { name: "Guess here" }).click();
  const card = page.getByRole("region").filter({ hasText: "It was taken in" });
  await expect(card).toBeVisible();
  return card;
}

test("a whole Daily Five can be played with the keyboard", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./?daily");
  await expect(page.getByText(/^Daily Five, /)).toBeVisible();
  await expect(page.getByText("Round 1 of 5", { exact: true })).toBeVisible();

  for (let round = 1; round <= 5; round++) {
    const card = await playRoundWithKeyboard(page);
    await expect(card.getByText(/points$/).first()).toBeVisible();
    await expect(card.getByRole("link", { name: /^Photo: / })).toHaveAttribute(
      "href",
      /^https:\/\/commons\.wikimedia\.org\//,
    );
    const next = card.getByRole("button", { name: round < 5 ? "Next photo" : "See your results" });
    await expect(next).toBeFocused();
    await page.keyboard.press("Enter");
  }

  await expect(page.getByText("out of 25,000 points")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(5);
  expect(errors).toEqual([]);
});

test("the globe renders with WebGL and accepts a click", async ({ page }) => {
  await page.goto("./");
  const globe = page.locator(".globe[data-ready]");
  await expect(globe).toBeVisible({ timeout: 20_000 });
  const box = await globe.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(page.getByText(/^Your pin: /)).toBeVisible();
  await expect(page.getByRole("button", { name: "Guess here" })).toBeEnabled();
});

test("everyone gets the same five photos on the same day", async ({ browser }) => {
  const first = async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route(/wikimedia\.org/, (route) =>
      route.fulfill({ body: PHOTO, contentType: "image/png" }),
    );
    await page.goto("./?daily");
    const src = await page.getByRole("img").getAttribute("src");
    await context.close();
    return src;
  };
  expect(await first()).toBe(await first());
});

test("each visit opens a fresh game that avoids recently played photos", async ({ page }) => {
  const recent = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("whereabout:recent-photos") ?? "[]"));

  await page.goto("./");
  await expect(page.getByText("Fresh game", { exact: true })).toBeVisible();
  await expect(page.getByRole("img")).toHaveAttribute("src", /.+/);
  await expect.poll(async () => (await recent()).length).toBe(5);

  await page.goto("./");
  await expect(page.getByText("Fresh game", { exact: true })).toBeVisible();
  await expect.poll(async () => (await recent()).length).toBe(10);
  expect(new Set(await recent()).size).toBe(10);
});

test("the Daily Five is one button away from a fresh game", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "Play the Daily Five" }).click();
  await expect(page.getByText(/^Daily Five, /)).toBeVisible();
  await expect(page.getByText("Round 1 of 5", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?daily/);
});
