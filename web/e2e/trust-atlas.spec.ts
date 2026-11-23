import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const ATLAS: { guesses: Record<string, { topCountries: { country: string; p: number }[] }> } =
  JSON.parse(readFileSync(resolve(process.cwd(), "src/data/atlas.json"), "utf8"));
const CATALOG: { id: string; country: string }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const COUNTRY = new Map(CATALOG.map((p) => [p.id, p.country]));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

/** Whether Atlas named the real country of the photo on screen, from the shipped data. */
async function atlasRightOnScreen(page: Page) {
  const main = page.locator("main[data-photo]");
  await expect(main).toHaveAttribute("data-photo", /.+/);
  const id = (await main.getAttribute("data-photo"))!;
  const top = ATLAS.guesses[id]!.topCountries[0]!;
  return { right: top.country === COUNTRY.get(id), sure: Math.round(top.p * 100) };
}

test("Trust Atlas? judges each call on the real country, by tap and by key, and keeps the best", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./");
  await page.getByRole("button", { name: "Games" }).click();
  await page
    .getByRole("dialog", { name: "Ways to play" })
    .getByRole("link", { name: /^Trust Atlas\?/ })
    .click();
  await expect(page).toHaveURL(/\/trust-atlas\/?$/, { timeout: 20_000 });

  const { width, height } = page.viewportSize()!;
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  const trust = page.getByRole("button", { name: "Trust it: Atlas is right" });
  const doubt = page.getByRole("button", { name: "Doubt it: Atlas is wrong" });
  let called = 0;
  let atlasRight = 0;
  for (let n = 0; n < 10; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 10`, { exact: true })).toBeVisible();
    await expect(trust).toBeEnabled();
    const { right, sure } = await atlasRightOnScreen(page);
    if (right) atlasRight++;
    await expect(page.getByTestId("trust-question")).toContainText(`${sure}% sure. Is it right?`);
    await expect(page.getByRole("meter", { name: "How sure Atlas is" })).toHaveAttribute(
      "aria-valuenow",
      String(sure),
    );
    // Both buttons sit on screen, under the photo.
    const doubtBox = (await doubt.boundingBox())!;
    expect(doubtBox.y + doubtBox.height).toBeLessThanOrEqual(height + 1);
    expect(doubtBox.x + doubtBox.width).toBeLessThanOrEqual(width + 1);

    if (n === 0) {
      // Tap the right call.
      await (right ? trust : doubt).click();
      await expect(card.getByRole("heading")).toHaveText("Called it");
      called++;
    } else if (n === 1) {
      // Key the wrong one.
      await page.keyboard.press(right ? "n" : "y");
      await expect(card.getByRole("heading")).toHaveText("Missed it");
    } else {
      await page.keyboard.press(right ? "y" : "n");
      await expect(card.getByRole("heading")).toHaveText("Called it");
      called++;
    }
    await expect(card.getByTestId("trust-truth")).toContainText(
      right ? "Atlas was right: it is " : "Atlas was wrong: it is ",
    );
    await expect(card.getByTestId("trust-atlas")).toContainText(
      sure >= 50 ? "Atlas trusted its answer" : "Atlas doubted its answer",
    );
    const next = card.getByRole("button", { name: n === 9 ? "See the results" : "Next photo" });
    await expect(next).toBeFocused();
    const nextBox = (await next.boundingBox())!;
    expect(nextBox.y + nextBox.height).toBeLessThanOrEqual(height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.keyboard.press("Enter");
  }

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`${called} of 10 called right`);
  await expect(page.getByTestId("trust-end")).toContainText(
    `Atlas was right on ${atlasRight} of 10.`,
  );
  await expect(page.getByTestId("trust-row")).toHaveCount(10);
  await expect(page.getByText("That's your new best!")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("whereabout:trust-atlas-best"))).toBe(
    String(called),
  );

  // A new game, with the best in the Games menu.
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByText("Photo 1 of 10", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Games" }).click();
  await expect(page.getByTestId("best-trust-atlas")).toHaveText(
    `Best: ${called} of 10 called right`,
  );
  await expect(page.getByRole("dialog").getByText("Playing now")).toBeVisible();
  expect(errors).toEqual([]);
});

test("on a 320px phone the photo, the calls and the answer fit without scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./trust-atlas");
  const trust = page.getByRole("button", { name: "Trust it: Atlas is right" });
  const doubt = page.getByRole("button", { name: "Doubt it: Atlas is wrong" });
  await expect(trust).toBeEnabled();
  const photo = (await page.getByTestId("trust-photo").boundingBox())!;
  expect(photo.height).toBeGreaterThan(120);
  expect(photo.x + photo.width).toBeLessThanOrEqual(321);
  for (const button of [trust, doubt]) {
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(321);
    expect(box.y + box.height).toBeLessThanOrEqual(569);
  }
  // The header's buttons stay on screen beside the title.
  const games = (await page.getByRole("button", { name: "Games" }).boundingBox())!;
  expect(games.x + games.width).toBeLessThanOrEqual(321);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await doubt.click();
  const next = page.getByRole("button", { name: "Next photo" });
  await expect(next).toBeFocused();
  const nextBox = (await next.boundingBox())!;
  expect(nextBox.y + nextBox.height).toBeLessThanOrEqual(569);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
