import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

// The real photos are hot-linked from Wikimedia; serve a local stand-in instead.
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
  return page.getByRole("region").filter({ hasText: "It was taken in" });
}

test("the results screen shows each quick game's best beside its name, and Blitz starts from it", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Bests kept by earlier runs in this browser, under each mode's own key.
  await page.goto("./");
  await page.evaluate(() => {
    localStorage.setItem("whereabout:blitz-best", "17400");
    localStorage.setItem("whereabout:country-streak-best", "2");
    localStorage.setItem("whereabout:country-streak-best:europe", "6");
    localStorage.setItem("whereabout:survival-best", JSON.stringify({ survived: 3, total: 12650 }));
    localStorage.setItem("whereabout:further-north-best", "8");
  });

  await page.goto("./?daily");
  for (let round = 1; round <= 5; round++) {
    const card = await playRound(page);
    await card.getByRole("button", { name: round < 5 ? "Next photo" : "See your results" }).click();
  }
  await expect(page.getByText("out of 25,000 points")).toBeVisible();

  const quick = page.getByRole("region", { name: "Quick games" });
  await expect(quick.getByTestId("best-blitz")).toHaveText("Best: 17,400 points");
  await expect(quick.getByTestId("best-streak")).toHaveText("Best: 6 in a row in Europe");
  await expect(quick.getByTestId("best-survival")).toHaveText("Best: 3 photos, 12,650 points");
  await expect(quick.getByTestId("best-further-north")).toHaveText("Best: 8 in a row");
  await expect(quick.getByTestId("best-odd-one-out")).toHaveText("No best yet");

  // Every card fits the screen's width, a phone's too, with its best on it.
  const width = page.viewportSize()!.width;
  for (const item of await quick.getByRole("listitem").all()) {
    await item.scrollIntoViewIfNeeded();
    const box = (await item.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
  await expect(quick.getByRole("link", { name: /^Survival/ })).toHaveAttribute(
    "href",
    /\/survival\/?$/,
  );

  // The Blitz card deals a Blitz game straight away, its clock running.
  await quick.getByRole("button", { name: /^Blitz/ }).click();
  await expect(page).toHaveURL(/\?blitz$/);
  await expect(page.getByText("Round 1 of 5", { exact: true })).toBeVisible();
  await expect(page.getByTestId("blitz-clock")).toBeVisible();
  expect(errors).toEqual([]);
});
