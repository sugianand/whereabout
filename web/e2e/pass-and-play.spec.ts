import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

/** Takes the device as `name`, drops a pin where the globe is looking and locks it in. */
async function turn(page: Page, name: string) {
  await expect(page.getByRole("heading", { name: `Pass to ${name}` })).toBeVisible();
  await page.getByRole("button", { name: `I'm ${name}, show the photo` }).click();
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  // Nothing of the last player's pin is on the globe.
  await expect(page.locator(".globe-pin")).toHaveCount(0);
  const globe = page.getByRole("application", { name: /Globe/ });
  await globe.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Lock in my pin" }).click();
}

test("pass and play: players take turns behind a pass screen, then one reveal shows every pin and the table", async ({
  page,
}) => {
  // Ten turns and five reveals on a software-rendered globe: longer than one round of the game.
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./pass-and-play");
  await expect(page.getByRole("heading", { name: "Pass and play" })).toBeVisible();
  // A third seat can be added and removed again; this table is two players.
  await page.getByRole("button", { name: "Add a player" }).click();
  await page.getByRole("button", { name: "Remove player 3" }).click();
  await page.getByRole("textbox", { name: "Player 1 name" }).fill("Ana");
  await page.getByRole("textbox", { name: "Player 2 name" }).fill("Bo");
  await page.getByRole("button", { name: "Start the game" }).click();

  const seats = ["Ana", "Bo"];
  for (let round = 0; round < 5; round++) {
    // The first turn moves one seat along each round.
    for (let t = 0; t < 2; t++) await turn(page, seats[(round + t) % 2]);

    const card = page.getByRole("region").filter({ has: page.getByRole("table") });
    await expect(card).toBeVisible();
    // Both players and Atlas in the table, and a numbered pin for each player on the globe.
    await expect(card.getByRole("row")).toHaveCount(4);
    await expect(page.locator(".globe-pin__label")).toHaveText(["1", "2"]);
    await expect(card.getByRole("link", { name: /^Photo: / })).toHaveAttribute(
      "href",
      /^https:\/\/commons\.wikimedia\.org\//,
    );

    // Once it has risen into place, the card sits inside the screen, phone or desktop.
    await card.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const box = (await card.boundingBox())!;
    const { width, height } = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);

    await card
      .getByRole("button", { name: round === 4 ? "See the final table" : "Next photo" })
      .click();
  }

  // The final table names the winner (or the players who tied) and ranks everyone with Atlas.
  await expect(page.getByRole("heading", { name: /^(Ana|Bo)\b.* (wins|tie)!$/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Final table" }).getByRole("listitem")).toHaveCount(
    3,
  );

  // The names come back for the next game, even after a reload.
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Player 2 name" })).toHaveValue("Bo");
  expect(errors).toEqual([]);
});
