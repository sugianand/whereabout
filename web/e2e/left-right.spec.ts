import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG: { id: string; drivingSide?: "left" | "right" }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const SIDE = new Map(CATALOG.map((p) => [p.id, p.drivingSide]));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

async function sideOnScreen(page: Page) {
  const photo = page.getByTestId("side-photo");
  await expect(photo).toHaveAttribute("data-photo", /.+/);
  const side = SIDE.get((await photo.getAttribute("data-photo"))!);
  expect(side === "left" || side === "right").toBe(true);
  return side!;
}

/** Drags the photo a third of its width toward `side`, the way a thumb swipes it. */
async function swipe(page: Page, side: "left" | "right") {
  const box = (await page.getByTestId("side-photo").boundingBox())!;
  const y = box.y + box.height / 2;
  const from = box.x + box.width / 2;
  const to = from + (side === "left" ? -1 : 1) * Math.max(150, box.width / 3);
  await page.mouse.move(from, y);
  await page.mouse.down();
  await page.mouse.move((from + to) / 2, y, { steps: 4 });
  await page.mouse.move(to, y, { steps: 4 });
  await page.mouse.up();
}

test("Left or right? takes calls by tap and swipe until the first miss, and keeps the best", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./left-right");
  await expect(
    page.getByText("Left or right? Which side of the road do they drive on here?"),
  ).toBeVisible();
  const { width, height } = page.viewportSize()!;
  for (const side of ["left", "right"] as const) {
    const button = page.getByRole("button", {
      name: `${side === "left" ? "Left" : "Right"}: they drive on the ${side}`,
    });
    await expect(button).toBeEnabled();
    const box = (await button.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  }
  const photoBox = (await page.getByTestId("side-photo").boundingBox())!;
  expect(photoBox.height).toBeGreaterThan(200);

  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });

  // A right call by tapping the side.
  let side = await sideOnScreen(page);
  await page
    .getByRole("button", {
      name: `${side === "left" ? "Left" : "Right"}: they drive on the ${side}`,
    })
    .click();
  await expect(card.getByRole("heading")).toHaveText("Correct");
  await expect(card).toContainText(`they drive on the ${side}.`);
  await expect(page.getByTestId("side-photo")).toContainText(`Drives on the ${side}`);
  const box = (await card.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  await card.getByRole("button", { name: "Next photo" }).click();
  await expect(card).toBeHidden();

  // A right call by swiping the photo.
  side = await sideOnScreen(page);
  await swipe(page, side);
  await expect(card.getByRole("heading")).toHaveText("Correct");
  await expect(page.getByText("Streak").locator("xpath=following-sibling::dd[1]")).toHaveText("2");
  await card.getByRole("button", { name: "Next photo" }).click();

  // A wrong call ends the run, and the best is kept for the next visit.
  side = await sideOnScreen(page);
  await page
    .getByRole("button", {
      name: side === "left" ? "Right: they drive on the right" : "Left: they drive on the left",
    })
    .click();
  await expect(card.getByRole("heading")).toHaveText("Wrong");
  await expect(card).toContainText("Run over: 2 photos in a row. That's your new best!");
  await card.getByRole("button", { name: "Start a new run" }).click();
  await expect(card).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("whereabout:left-right-best"))).toBe("2");

  // The Games menu lists it with that best, as the one being played.
  await page.getByRole("button", { name: "Games" }).click();
  await expect(page.getByTestId("best-left-right")).toHaveText("Best: 2 in a row");
  expect(errors).toEqual([]);
});

test("a 320px phone fits the photo, both sides and the answer without scrolling sideways", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("./left-right");
  const side = await sideOnScreen(page);
  const games = page.getByRole("button", { name: "Games" });
  expect(
    ((await games.boundingBox())!.x ?? 0) + (await games.boundingBox())!.width,
  ).toBeLessThanOrEqual(320);
  await page
    .getByRole("button", {
      name: `${side === "left" ? "Left" : "Right"}: they drive on the ${side}`,
    })
    .click();
  const next = page.getByRole("button", { name: "Next photo" });
  await expect(next).toBeVisible();
  expect((await next.boundingBox())!.y).toBeLessThanOrEqual(640);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("today's Left or right? deals the day's photos once, resumes after a reload, and shares as counts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const today = new Date().toISOString().slice(0, 10);

  // The free runs link to today's run, and Today lists it.
  await page.goto("./left-right");
  await page.getByRole("link", { name: "Today's run" }).click();
  await expect(page.getByText(`today's run (${today})`)).toBeVisible();
  await expect(page.getByText("Best", { exact: true })).toHaveCount(0);
  const { width, height } = page.viewportSize()!;

  // Everyone on one day gets the same photos: a fresh player (nothing kept) is dealt the same.
  const first = await sideOnScreen(page).then(() =>
    page.getByTestId("side-photo").getAttribute("data-photo"),
  );
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("side-photo")).toHaveAttribute("data-photo", first!);

  // Right on the first photo, a reload picks up at the next one with the streak so far.
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  const right = page.getByRole("button", { name: "Right: they drive on the right" });
  const left = page.getByRole("button", { name: "Left: they drive on the left" });
  await expect(right).toBeEnabled();
  await ((await sideOnScreen(page)) === "left" ? left : right).click();
  await expect(card.getByRole("heading")).toHaveText("Correct");
  await page.reload();
  await expect(page.getByTestId("side-photo")).not.toHaveAttribute("data-photo", first!);
  await expect(page.getByText("Streak", { exact: true }).locator("+ dd")).toHaveText("1");

  // Then a wrong call ends the day.
  await expect(right).toBeEnabled();
  await ((await sideOnScreen(page)) === "left" ? right : left).click();
  await expect(card.getByRole("heading")).toHaveText("Wrong");
  await expect(card).toContainText("Today's run is over: 1 photo in a row.");
  await expect(card.getByRole("button", { name: "Start a new run" })).toHaveCount(0);
  const box = (await card.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);

  // A reload shows the day's result, never the photos again.
  await page.reload();
  await expect(page.getByRole("heading", { name: "1 photo in a row" })).toBeVisible();
  await expect(page.getByText(/The next run is dealt in \d+/)).toBeVisible();
  await expect(page.getByTestId("side-left")).toHaveCount(0);

  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (t: string) => void ((window as unknown as { sent: string }).sent = t),
      },
      configurable: true,
    });
  });
  await page.getByRole("button", { name: "Share today's run" }).click();
  await expect(page.getByText("Result copied. Paste it anywhere.")).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(sent).toContain(`Whereabout · Left or right? · ${today}\n🛣️ 1 photo in a row\n🟩🟥\n`);
  expect(sent).toMatch(/\/whereabout\/left-right\/daily\/?$/);

  // The free runs' best is its own, and Today counts the day as finished.
  expect(await page.evaluate(() => localStorage.getItem("whereabout:left-right-best"))).toBe(null);
  await page.goto("./today");
  await expect(page.getByTestId("today-left-right")).toHaveAttribute("data-status", "done");
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scroll).toBeLessThanOrEqual(width);
  expect(errors).toEqual([]);
});
