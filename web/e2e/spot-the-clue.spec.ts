import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const ATLAS: { guesses: Record<string, { looked?: { grid: number; cells: number[] } }> } =
  JSON.parse(readFileSync(resolve(process.cwd(), "src/data/atlas.json"), "utf8"));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

/** The photo on screen's map, with its hottest square and a square that mattered nothing. */
async function mapOnScreen(page: Page) {
  const main = page.locator("main[data-photo]");
  await expect(main).toHaveAttribute("data-photo", /.+/);
  const looked = ATLAS.guesses[(await main.getAttribute("data-photo"))!]!.looked!;
  const top = Math.max(...looked.cells);
  return {
    grid: looked.grid,
    hottest: looked.cells.indexOf(top),
    cold: looked.cells.indexOf(0),
  };
}

const name = (grid: number, cell: number) =>
  `Row ${Math.floor(cell / grid) + 1}, column ${(cell % grid) + 1}`;

test("Spot the clue scores the square picked by Atlas's real map, by tap and by keys, and keeps the best", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./");
  await page.getByRole("button", { name: "Games" }).click();
  await page
    .getByRole("dialog", { name: "Ways to play" })
    .getByRole("link", { name: /^Spot the clue/ })
    .click();
  await expect(page).toHaveURL(/\/spot-the-clue\/?$/, { timeout: 20_000 });
  await expect(page.getByTestId("spot-question")).toContainText("Atlas said ");

  const { width, height } = page.viewportSize()!;
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  let total = 0;
  for (let n = 0; n < 5; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 5`, { exact: true })).toBeVisible();
    const { grid, hottest, cold } = await mapOnScreen(page);
    const lock = page.getByRole("button", { name: /^Lock in row/ });
    await expect(lock).toBeEnabled();
    // The square photo and the button fit the screen.
    const box = (await page.getByTestId("spot-photo").boundingBox())!;
    expect(box.width).toBeGreaterThan(200);
    expect(Math.abs(box.width - box.height)).toBeLessThan(2);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect((await lock.boundingBox())!.y + 40).toBeLessThanOrEqual(height + 1);

    if (n === 0) {
      // Tap Atlas's hottest square: the full 1,000.
      await page.getByRole("button", { name: name(grid, hottest), exact: true }).click();
      await page
        .getByRole("button", { name: `Lock in ${name(grid, hottest).toLowerCase()}` })
        .click();
      await expect(card.getByRole("heading")).toHaveText("Spot on: 1,000 points");
      total += 1000;
    } else if (n === 1 && cold >= 0) {
      // Walk to a square Atlas never needed with the arrows, then G: nothing.
      const mid = Math.floor(grid / 2);
      const [row, col] = [Math.floor(cold / grid), cold % grid];
      for (let i = 0; i < Math.abs(row - mid); i++) {
        await page.keyboard.press(row > mid ? "ArrowDown" : "ArrowUp");
      }
      for (let i = 0; i < Math.abs(col - mid); i++) {
        await page.keyboard.press(col > mid ? "ArrowRight" : "ArrowLeft");
      }
      await expect(
        page.getByRole("button", { name: name(grid, cold), exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("g");
      await expect(card.getByRole("heading")).toHaveText("Cold: 0 points");
    } else {
      await lock.click();
      const heading = (await card.getByRole("heading").textContent())!;
      total += Number(heading.replace(/^.*: ([\d,]+) points$/, "$1").replace(",", ""));
    }
    await expect(page.getByTestId("spot-heat")).toBeAttached();
    await expect(page.getByTestId("spot-yours")).toBeVisible();
    await expect(card.getByTestId("spot-atlas")).toContainText("Atlas said ");
    // The answer card fits under the photo, its button on screen.
    const next = card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" });
    await expect(next).toBeFocused();
    const nextBox = (await next.boundingBox())!;
    expect(nextBox.y + nextBox.height).toBeLessThanOrEqual(height + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.keyboard.press("Enter");
  }

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    `${total.toLocaleString("en-US")} points`,
  );
  await expect(page.getByTestId("spot-row")).toHaveCount(5);
  await expect(page.getByText("That's your new best!")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("whereabout:spot-the-clue-best"))).toBe(
    String(total),
  );

  // A new game, with the best in the Games menu.
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByText("Photo 1 of 5", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Games" }).click();
  await expect(page.getByTestId("best-spot-the-clue")).toHaveText(
    `Best: ${total.toLocaleString("en-US")} points`,
  );
  await expect(page.getByRole("dialog").getByText("Playing now")).toBeVisible();
  expect(errors).toEqual([]);
});

test("on a 320px phone the photo, its grid and the answer fit without scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./spot-the-clue");
  const lock = page.getByRole("button", { name: /^Lock in row/ });
  await expect(lock).toBeEnabled();
  const photo = (await page.getByTestId("spot-photo").boundingBox())!;
  expect(photo.x).toBeGreaterThanOrEqual(0);
  expect(photo.x + photo.width).toBeLessThanOrEqual(321);
  expect(photo.width).toBeGreaterThan(150);
  const lockBox = (await lock.boundingBox())!;
  expect(lockBox.y + lockBox.height).toBeLessThanOrEqual(569);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await lock.click();
  const next = page.getByRole("button", { name: "Next photo" });
  await expect(next).toBeFocused();
  const nextBox = (await next.boundingBox())!;
  expect(nextBox.y + nextBox.height).toBeLessThanOrEqual(569);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
