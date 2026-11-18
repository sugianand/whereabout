import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

async function playGame(page: Page) {
  const globe = page.getByRole("application", { name: /Globe/ });
  for (let round = 1; round <= 5; round++) {
    await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
    await globe.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(/^Your pin: /)).toBeVisible();
    await page.getByRole("button", { name: "Guess here" }).click();
    const card = page.getByRole("region").filter({ hasText: "It was taken in" });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: round < 5 ? "Next photo" : "See your results" }).click();
  }
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("the tour starts in Europe, a leg's game lands on the tour, and the results say who holds it", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./");
  await page.getByRole("button", { name: "Games" }).click();
  await page.getByRole("link", { name: /World Tour/ }).click();
  await expect(page).toHaveURL(/\/tour\/?$/);
  await expect(page.getByRole("heading", { name: "World Tour", level: 1 })).toBeVisible();
  await expect(page.getByTestId("tour-progress")).toHaveText(/^0 of \d continents cleared$/);
  const first = page.getByTestId("tour-stop").first();
  await expect(first).toHaveAttribute("data-continent", "Europe");
  await expect(first).toHaveAttribute("data-state", "next");
  await expect(first).toContainText("Not visited yet.");
  await noSidewaysScroll(page);

  await first.getByRole("link", { name: "Play Europe" }).click();
  await expect(page.getByText("Europe game", { exact: true })).toBeVisible();
  await playGame(page);

  const card = page.getByRole("region", { name: "World Tour" });
  await expect(card).toBeVisible();
  await expect(card).toContainText(
    /Europe cleared: you beat Atlas|Atlas holds Europe by [\d,]+ points|A tie with Atlas in Europe/,
  );
  const kept = JSON.parse(
    (await page.evaluate(() => localStorage.getItem("whereabout:tour"))) ?? "{}",
  );
  expect(kept.Europe.tries).toBe(1);
  // The leg is judged on the same points the results show for you and Atlas.
  const atlasShown = Number(
    (await page
      .getByText(/Atlas scored/)
      .locator("span.tabular")
      .textContent())!.replace(/,/g, ""),
  );
  expect(kept.Europe.best.atlas).toBe(atlasShown);
  expect(Boolean(kept.Europe.cleared)).toBe(kept.Europe.best.you > kept.Europe.best.atlas);

  await card.getByRole("link", { name: "See the tour →" }).click();
  await expect(page).toHaveURL(/\/tour\/?$/);
  const europe = page.getByTestId("tour-stop").first();
  await expect(europe).not.toContainText("Not visited yet.");
  await expect(europe).toContainText(kept.Europe.cleared ? /^.*Cleared/ : /over 1 game/);
  expect(errors).toEqual([]);
});

test("after a cleared leg the results lead to the next stop, and the tour fits a 320px phone", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem(
      "whereabout:tour",
      JSON.stringify({
        Europe: { tries: 1, best: { you: 20000, atlas: 15000 }, cleared: "2026-11-17" },
      }),
    );
  });
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("./tour/");
  await expect(page.getByTestId("tour-progress")).toHaveText(/^1 of \d continents cleared$/);
  const stops = page.getByTestId("tour-stop");
  await expect(stops.first()).toHaveAttribute("data-state", "cleared");
  await expect(stops.first()).toContainText("Cleared 17 Nov 2026. Best: 20,000 to Atlas's 15,000.");
  const second = stops.nth(1);
  await expect(second).toHaveAttribute("data-state", "next");
  const nextStop = (await second.getAttribute("data-continent"))!;
  await noSidewaysScroll(page);

  // Europe again: whatever this game does, Europe stays cleared and the next stop is offered.
  await stops.first().getByRole("link", { name: "Play Europe again" }).click();
  await expect(page.getByText("Europe game", { exact: true })).toBeVisible();
  await playGame(page);
  const card = page.getByRole("region", { name: "World Tour" });
  await expect(card).toContainText(/^.*1 of \d continents cleared\./);
  await noSidewaysScroll(page);
  await card.getByRole("button", { name: `Next stop: ${nextStop}` }).click();
  await expect(page.getByText(`${nextStop} game`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
});
