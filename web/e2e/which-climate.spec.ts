import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG: { id: string; climateGroup?: string }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const GROUP = new Map(CATALOG.map((p) => [p.id, p.climateGroup]));
const GROUPS = ["Tropical", "Arid", "Temperate", "Continental", "Polar"];

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

async function groupOnScreen(page: Page) {
  const photo = page.getByTestId("climate-photo");
  await expect(photo).toHaveAttribute("data-photo", /.+/);
  const group = GROUP.get((await photo.getAttribute("data-photo"))!);
  expect(GROUPS).toContain(group);
  return group!;
}

const climateButton = (page: Page, group: string) => page.getByTestId(`climate-${group}`);

test("Which climate? plays five photos against Atlas, shows each on the climate band, and keeps the best", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./which-climate");
  await expect(page.getByText("Which climate? Name the Köppen group.")).toBeVisible();
  const { width, height } = page.viewportSize()!;
  // All five climates sit on screen, under a photo big enough to read.
  for (const group of GROUPS) {
    const button = climateButton(page, group);
    await expect(button).toBeEnabled();
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  }
  expect((await page.getByTestId("climate-photo").boundingBox())!.height).toBeGreaterThan(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );

  // Three right calls by tap, then two wrong ones.
  for (let n = 0; n < 5; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 5`, { exact: true })).toBeVisible();
    const truth = await groupOnScreen(page);
    const pick = n < 3 ? truth : truth === "Polar" ? "Arid" : "Polar";
    await climateButton(page, pick).click();
    const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
    await expect(card.getByRole("heading")).toHaveText(n < 3 ? "Correct" : "Wrong");
    const band = card.getByTestId("climate-band");
    await expect(band.locator("[aria-current='location']")).toHaveAttribute("data-group", truth);
    await expect(band.locator(`[data-group='${pick}']`)).toContainText("You");
    await expect(card).toContainText(/Atlas (read it as|said nothing)/);
    // The answer card fits the screen, with its button in reach.
    const box = (await card.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    await card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }).click();
  }

  await expect(page.getByRole("heading", { level: 1, name: "3 of 5" })).toBeVisible();
  await expect(page.getByTestId("climate-row")).toHaveCount(5);
  await expect(page.getByText("That's your new best!")).toBeVisible();

  // The best is kept, and the Games menu shows it beside the game's name.
  await page.reload();
  await expect(page.getByText("Best").locator("xpath=following-sibling::dd")).toHaveText("3");
  await page.getByRole("button", { name: "Games" }).click();
  await expect(page.getByTestId("best-which-climate")).toHaveText("Best: 3 of 5 right");
  expect(errors).toEqual([]);
});
