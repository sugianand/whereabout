import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG: { id: string; lat: number }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const LAT = new Map(CATALOG.map((p) => [p.id, p.lat]));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

test("Further North deals pairs of photos until the first wrong pick, and keeps the best", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./further-north");
  await expect(page.getByText("Further North: which photo was taken further north?")).toBeVisible();
  const { width, height } = page.viewportSize()!;

  // Both photos and their pick buttons are on screen, side by side or stacked.
  for (const n of [1, 2]) {
    await expect(
      page.getByRole("button", { name: `Photo ${n} is further north` }),
    ).toBeEnabled();
    const box = (await page.getByTestId(`north-photo-${n}`).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    expect(box.height).toBeGreaterThan(120);
  }

  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  // Always picking photo 1 is right about half the time: play until a miss ends the run.
  let streak = 0;
  for (let i = 0; i < 40; i++) {
    const kept = await page.getByTestId("north-photo-2").getAttribute("data-photo");
    await page.getByRole("button", { name: "Photo 1 is further north" }).click();
    await expect(card).toBeVisible();
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    // The places show only now, each with its latitude.
    await expect(page.getByTestId("north-photo-1")).toContainText(/\d+\.\d° [NS]|0\.0°/);

    if ((await card.getByRole("heading").textContent()) === "Wrong") break;
    streak++;
    await card.getByRole("button", { name: "Next pair" }).click();
    // The second photo moves to the first place, beside a new one.
    await expect(page.getByTestId("north-photo-1")).toHaveAttribute("data-photo", kept!);
  }

  await expect(card).toContainText(`Run over: ${streak} pair`);
  expect(await page.evaluate(() => localStorage.getItem("whereabout:further-north-best"))).toBe(
    streak > 0 ? String(streak) : null,
  );

  // A new run starts at 0, and the best survives a reload.
  await card.getByRole("button", { name: "Start a new run" }).click();
  await expect(page.getByText("Streak", { exact: true }).locator("+ dd")).toHaveText("0");
  await page.reload();
  await expect(page.getByText("Best", { exact: true }).locator("+ dd")).toHaveText(String(streak));
  // Key 2 picks the second photo.
  await expect(page.getByRole("button", { name: "Photo 2 is further north" })).toBeEnabled();
  await page.keyboard.press("2");
  await expect(card).toBeVisible();
  expect(errors).toEqual([]);
});

async function pair(page: Page): Promise<[string, string]> {
  const id = async (n: number) =>
    (await page.getByTestId(`north-photo-${n}`).getAttribute("data-photo"))!;
  return [await id(1), await id(2)];
}

/** The photo (1 or 2) taken further north, or null when they are within a degree (a tie). */
function northOf([a, b]: [string, string]): 1 | 2 | null {
  const [la, lb] = [LAT.get(a)!, LAT.get(b)!];
  if (Math.abs(la - lb) < 1) return null;
  return la > lb ? 1 : 2;
}

test("a challenge link deals a friend the same pairs, with the run to beat and where it ended", async ({
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
  const pick = (n: number) =>
    page.getByRole("button", { name: `Photo ${n} is further north` });

  // The sender calls one pair right, then misses the first pair that isn't a tie.
  await page.goto("./further-north");
  const chain: string[] = [];
  let streak = 0;
  let missPick = 0;
  for (let i = 0; i < 40; i++) {
    await expect(pick(2)).toBeEnabled();
    const ids = await pair(page);
    if (chain.length === 0) chain.push(ids[0]);
    chain.push(ids[1]);
    const north = northOf(ids);
    if (streak >= 1 && north !== null) {
      missPick = north === 1 ? 2 : 1;
      await pick(missPick).click();
      break;
    }
    await pick(north ?? 1).click();
    streak++;
    await card.getByRole("button", { name: "Next pair" }).click();
  }
  await expect(card).toContainText(`Run over: ${streak} pair`);
  const challengeButton = card.getByRole("button", { name: "Challenge a friend" });
  await expect(challengeButton).toBeInViewport();
  await challengeButton.click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const message = await sent();
  expect(message).toContain(`I called ${streak} pair`);
  const link = message.split("\n").at(-1)!;
  expect(link).toMatch(
    new RegExp(`/whereabout/further-north/?\\?challenge=${chain.join("\\.")}_[0-9a-z]+_${streak}$`),
  );

  // The friend, with nothing kept, gets the same chain and calls every pair of it right.
  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  await expect(page.getByText(`A friend's challenge: ${streak} pair`)).toBeVisible();
  for (let i = 0; i + 1 < chain.length; i++) {
    await expect(pick(2)).toBeEnabled();
    expect(await pair(page)).toEqual([chain[i], chain[i + 1]]);
    await pick(northOf([chain[i], chain[i + 1]]) ?? 1).click();
    if (i === chain.length - 2) {
      await expect(card).toContainText(`That beats your friend's ${streak} in a row!`);
      await expect(card).toContainText(
        `Your friend's run ended here: they picked photo ${missPick}.`,
      );
      await expect(page.getByTestId(`north-photo-${missPick}`)).toContainText("Friend's pick");
    } else {
      await expect(card).not.toContainText("Your friend's run ended here");
    }
    await card.getByRole("button", { name: "Next pair" }).click();
  }

  // Past the friend's photos, the run plays on with a new photo; miss the first pair we can.
  let mine = chain.length - 1;
  for (let i = 0; i < 40; i++) {
    await expect(pick(2)).toBeEnabled();
    const ids = await pair(page);
    expect(chain).not.toContain(ids[1]);
    const north = northOf(ids);
    if (north !== null) {
      await pick(north === 1 ? 2 : 1).click();
      break;
    }
    await pick(1).click();
    mine++;
    await card.getByRole("button", { name: "Next pair" }).click();
  }
  await expect(card).toContainText(
    `Run over: ${mine} pairs in a row. You beat your friend's ${streak} in a row by ${mine - streak}.`,
  );
  const { width, height } = page.viewportSize()!;
  const box = (await card.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  expect(await page.evaluate(() => localStorage.getItem("whereabout:further-north-best"))).toBe(
    null,
  );

  const back = card.getByRole("button", { name: "Send yours back" });
  await expect(back).toBeInViewport();
  await back.click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const reply = await sent();
  expect(reply).toContain(`That beats your ${streak}. Your turn to go further.`);
  expect(reply).toMatch(new RegExp(`_${mine}$`));

  // Head to head: both runs drawn as a 1080px picture, saved, with the reply link copied.
  await page.evaluate(() => ((window as unknown as { sent: string }).sent = ""));
  const picture = card.getByRole("button", { name: "Share head to head" });
  await expect(picture).toBeInViewport({ ratio: 1 });
  const [download] = await Promise.all([page.waitForEvent("download"), picture.click()]);
  expect(download.suggestedFilename()).toBe("whereabout-further-north-head-to-head.png");
  const png = readFileSync((await download.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1080]);
  await expect(page.getByText("Head to head saved.", { exact: false })).toBeVisible();
  expect(await sent()).toBe(reply);

  // A fresh run drops the link, so a reload doesn't deal the challenge again.
  await card.getByRole("button", { name: "Play a fresh run" }).click();
  await expect(page.getByText("Further North: which photo was taken further north?")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(errors).toEqual([]);
});

test("a broken Further North challenge says so and deals a fresh run", async ({ page }) => {
  await page.goto("./further-north?challenge=wm001_3_9");
  await expect(page.getByText(/That challenge link was cut short/)).toBeVisible();
  await expect(page.getByText("Further North: which photo was taken further north?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Photo 2 is further north" })).toBeEnabled();
});

test("the end of a run keeps both its buttons on a 320px phone", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./further-north");
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  for (let i = 0; i < 40; i++) {
    await expect(page.getByRole("button", { name: "Photo 2 is further north" })).toBeEnabled();
    const north = northOf(await pair(page));
    await page
      .getByRole("button", { name: `Photo ${north === 1 ? 2 : 1} is further north` })
      .click();
    if (north !== null) break;
    await card.getByRole("button", { name: "Next pair" }).click();
  }
  for (const name of ["Start a new run", "Challenge a friend"]) {
    await expect(card.getByRole("button", { name })).toBeInViewport();
  }
  const scroll = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll[0]).toBeLessThanOrEqual(scroll[1]);
});
