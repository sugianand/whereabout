import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

test("your map shows the Odd one out run you played against Atlas's picks", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // A fresh browser has no record to show.
  await page.goto("./map/");
  await expect(page.getByText(/Nothing on your map yet/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /You and Atlas/ })).toHaveCount(0);

  // Play one free run of Odd one out to its first miss, always tapping photo 1.
  await page.goto("./odd-one-out");
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  let streak = 0;
  for (let i = 0; i < 40; i++) {
    await page.getByRole("button", { name: "Photo 1 is the odd one out" }).click();
    await expect(card).toBeVisible();
    if ((await card.getByRole("heading").textContent()) === "Wrong") break;
    streak++;
    await card.getByRole("button", { name: "Next four" }).click();
    await expect(card).toBeHidden();
  }
  await expect(card).toContainText(`Run over: ${streak} quad`);
  // The run's own reveal tells Atlas's tally on the same quads.
  const tally = /Atlas this run: (\d+) of (\d+) quad/.exec((await card.textContent())!);
  expect(tally).not.toBeNull();
  const [atlasRight, atlasPlayed] = [Number(tally![1]), Number(tally![2])];

  await page.goto("./map/");
  await expect(
    page.getByRole("heading", { name: "You and Atlas in the quick games" }),
  ).toBeVisible();
  const record = page.getByTestId("record-odd-one-out");
  await expect(record).toContainText("1 run");
  await expect(page.getByTestId("record-further-north")).toHaveCount(0);
  const you = page.getByTestId("record-odd-one-out-you");
  await expect(you).toHaveAttribute("data-right", String(streak));
  await expect(you).toHaveAttribute("data-played", String(streak + 1));
  const atlas = page.getByTestId("record-odd-one-out-atlas");
  await expect(atlas).toHaveAttribute("data-right", String(atlasRight));
  await expect(atlas).toHaveAttribute("data-played", String(atlasPlayed));

  // The verdict comes from those numbers alone.
  const yours = Math.round((streak / (streak + 1)) * 100);
  const atlases = atlasPlayed > 0 ? Math.round((atlasRight / atlasPlayed) * 100) : null;
  const line = page.getByTestId("record-odd-one-out-line");
  if (atlases === null) await expect(line).toHaveText("Atlas hasn't played a round with you yet.");
  else if (yours > atlases)
    await expect(line).toHaveText(new RegExp(`ahead of Atlas by ${yours - atlases} point`));
  else if (yours < atlases)
    await expect(line).toHaveText(new RegExp(`Atlas is ahead of you by ${atlases - yours} point`));
  else await expect(line).toHaveText("You and Atlas are level.");

  // The card fits the screen's width, phone or desktop.
  const { width } = page.viewportSize()!;
  const box = (await record.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);

  // Its link plays another run.
  await record.getByRole("link", { name: "Play Odd one out" }).click();
  await expect(page).toHaveURL(/\/odd-one-out\/?$/);
  expect(errors).toEqual([]);
});
