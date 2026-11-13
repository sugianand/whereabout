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

const callButton = (page: Page, side: "left" | "right") =>
  page.getByRole("button", {
    name: `${side === "left" ? "Left" : "Right"}: they drive on the ${side}`,
  });
const otherSide = (side: "left" | "right") => (side === "left" ? "right" : "left");

test("a challenge link deals a friend the same photos, with the run to beat and the call that ended it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (t: string) => void ((window as unknown as { sent: string }).sent = t),
      },
      configurable: true,
    });
  });
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  const sent = () => page.evaluate(() => (window as unknown as { sent: string }).sent);

  // The sender calls two photos right, then misses the third.
  await page.goto("./left-right");
  const run: string[] = [];
  for (let i = 0; i < 3; i++) {
    const side = await sideOnScreen(page);
    run.push((await page.getByTestId("side-photo").getAttribute("data-photo"))!);
    await expect(callButton(page, side)).toBeEnabled();
    await callButton(page, i < 2 ? side : otherSide(side)).click();
    if (i < 2) await card.getByRole("button", { name: "Next photo" }).click();
  }
  const missed = SIDE.get(run[2])!;
  await expect(card).toContainText("Run over: 2 photos in a row.");
  const challengeButton = card.getByRole("button", { name: "Challenge a friend" });
  await expect(challengeButton).toBeInViewport();
  await challengeButton.click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const message = await sent();
  expect(message).toContain("I called 2 photos in a row.");
  const link = message.split("\n").at(-1)!;
  expect(link).toMatch(
    new RegExp(`/whereabout/left-right/?\\?challenge=${run.join("\\.")}_[0-9a-z]+_2$`),
  );

  // The friend, with nothing kept, gets the same photos and calls them all right.
  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  await expect(page.getByText("A friend's challenge: 2 photos in a row to beat")).toBeVisible();
  for (let i = 0; i < run.length; i++) {
    await expect(page.getByTestId("side-photo")).toHaveAttribute("data-photo", run[i]);
    const side = await sideOnScreen(page);
    await expect(callButton(page, side)).toBeEnabled();
    await callButton(page, side).click();
    if (i === 2) {
      await expect(card).toContainText("That beats your friend's 2 in a row!");
      await expect(card).toContainText(
        `Your friend's run ended here: they called ${otherSide(missed)}.`,
      );
    } else {
      await expect(card).not.toContainText("Your friend's run ended here");
    }
    await card.getByRole("button", { name: "Next photo" }).click();
  }

  // Past the friend's photos, the run plays on with a new photo; miss it.
  const side = await sideOnScreen(page);
  expect(run).not.toContain(await page.getByTestId("side-photo").getAttribute("data-photo"));
  await expect(callButton(page, side)).toBeEnabled();
  await callButton(page, otherSide(side)).click();
  await expect(card).toContainText(
    "Run over: 3 photos in a row. You beat your friend's 2 in a row by 1.",
  );
  const { width, height } = page.viewportSize()!;
  const box = (await card.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  expect(await page.evaluate(() => localStorage.getItem("whereabout:left-right-best"))).toBe(null);

  const back = card.getByRole("button", { name: "Send yours back" });
  await expect(back).toBeInViewport();
  await back.click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const reply = await sent();
  expect(reply).toContain("That beats your 2. Your turn to read the road.");
  expect(reply).toMatch(/_3$/);

  // Head to head: both runs drawn as a 1080px picture, saved, with the reply link copied.
  await page.evaluate(() => ((window as unknown as { sent: string }).sent = ""));
  const picture = card.getByRole("button", { name: "Share head to head" });
  await expect(picture).toBeInViewport({ ratio: 1 });
  const [download] = await Promise.all([page.waitForEvent("download"), picture.click()]);
  expect(download.suggestedFilename()).toBe("whereabout-left-or-right-head-to-head.png");
  const png = readFileSync((await download.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1080]);
  await expect(page.getByText("Head to head saved.", { exact: false })).toBeVisible();
  expect(await sent()).toBe(reply);

  // Your map keeps the answered challenge in its head to head.
  const kept = await page.evaluate(() => localStorage.getItem("whereabout:head-to-head"));
  expect(JSON.parse(kept!)).toEqual([
    expect.objectContaining({ game: "Left or right?", outcome: "won", you: "3 in a row" }),
  ]);

  // A fresh run drops the link, so a reload doesn't deal the challenge again.
  await card.getByRole("button", { name: "Play a fresh run" }).click();
  await expect(
    page.getByText("Left or right? Which side of the road do they drive on here?"),
  ).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(errors).toEqual([]);
});

test("a broken Left or right? challenge says so and deals a fresh run", async ({ page }) => {
  await page.goto("./left-right?challenge=wm001_3_9");
  await expect(page.getByText(/That challenge link was cut short/)).toBeVisible();
  await expect(
    page.getByText("Left or right? Which side of the road do they drive on here?"),
  ).toBeVisible();
  await expect(callButton(page, "left")).toBeEnabled();
});

test("the end of a run keeps both its buttons on a 320px phone", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./left-right");
  const side = await sideOnScreen(page);
  await expect(callButton(page, side)).toBeEnabled();
  await callButton(page, otherSide(side)).click();
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  for (const name of ["Start a new run", "Challenge a friend"]) {
    await expect(card.getByRole("button", { name })).toBeInViewport();
  }
  const scroll = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll[0]).toBeLessThanOrEqual(scroll[1]);
});
