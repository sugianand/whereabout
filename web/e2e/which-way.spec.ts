import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
// The globe's first frame on a software-rendered GL can be slow on a CI runner.
const GLOBE = { timeout: 20_000 };
const CATALOG: { id: string; lng: number; lat: number }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const AT = new Map(CATALOG.map((p) => [p.id, p]));
const NAMES = [
  "north",
  "north-east",
  "east",
  "south-east",
  "south",
  "south-west",
  "west",
  "north-west",
] as const;
const LETTERS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** The compass point (0 is north, clockwise) nearest the great-circle heading from `a` to `b`. */
function pointFrom(a: string, b: string): number {
  const [p, q] = [AT.get(a)!, AT.get(b)!];
  const rad = Math.PI / 180;
  const y = Math.sin((q.lng - p.lng) * rad) * Math.cos(q.lat * rad);
  const x =
    Math.cos(p.lat * rad) * Math.sin(q.lat * rad) -
    Math.sin(p.lat * rad) * Math.cos(q.lat * rad) * Math.cos((q.lng - p.lng) * rad);
  const deg = (((Math.atan2(y, x) / rad) % 360) + 360) % 360;
  return Math.floor((deg + 22.5) / 45) % 8;
}

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

test("Which way? travels from photo to photo until the first wrong compass point, and keeps the best", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./which-way");
  await expect(page.getByText("Which way?: set off from photo 1 toward photo 2")).toBeVisible();
  const { width, height } = page.viewportSize()!;

  // Both photos and all eight compass points fit the screen, with no sideways scroll.
  for (const n of [1, 2]) {
    const box = (await page.getByTestId(`way-photo-${n}`).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.height).toBeGreaterThan(120);
  }
  const compass = page.getByTestId("way-compass");
  await expect(compass.getByRole("button")).toHaveCount(8);
  const rose = (await compass.boundingBox())!;
  expect(rose.y + rose.height).toBeLessThanOrEqual(height + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );

  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  // Always heading north is right now and then: travel on until a miss ends the run.
  let streak = 0;
  for (let i = 0; i < 40; i++) {
    const headed = await page.getByTestId("way-photo-2").getAttribute("data-photo");
    await expect(page.getByRole("button", { name: "N, headed north", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "N, headed north", exact: true }).click();
    await expect(card).toBeVisible();
    // The card names the route and its bearing, and stays inside the screen.
    await expect(card).toContainText(
      / is (north|south|east|west|north-east|north-west|south-east|south-west) of /,
    );
    await expect(card).toContainText(/sets off at \d{1,3}°/);
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    if (width < 768)
      expect(box.height, "the route stays in view above the card").toBeLessThan(height / 2);
    // The route is on the globe: pin 1 where you stood and the gold pin where you were headed.
    await expect(page.locator(".globe-pin--truth")).toBeVisible(GLOBE);
    await expect(page.locator(".globe-pin--labelled")).toHaveText("1");
    // The globe's own coordinate line is for screen readers here: the card already names the place.
    await expect(page.locator("#globe-pin-status")).toHaveText(/^It was here: /);
    expect((await page.locator("#globe-pin-status").boundingBox())!.width).toBeLessThanOrEqual(1);

    const verdict = await card.getByRole("heading", { level: 2 }).textContent();
    if (verdict === "Wrong") break;
    streak++;
    await card.getByRole("button", { name: "Travel on" }).click();
    // Where you were headed is where you stand now.
    await expect(page.getByTestId("way-photo-1")).toHaveAttribute("data-photo", headed!);
  }

  await expect(card).toContainText(`Run over: ${streak} stop`);
  expect(await page.evaluate(() => localStorage.getItem("whereabout:which-way-best"))).toBe(
    streak > 0 ? String(streak) : null,
  );

  // A new run starts at 0, and the best survives a reload and shows in the Games menu.
  await card.getByRole("button", { name: "Start a new run" }).click();
  await expect(page.getByText("Streak", { exact: true }).locator("+ dd")).toHaveText("0");
  await page.reload();
  await expect(page.getByText("Best", { exact: true }).locator("+ dd")).toHaveText(String(streak));
  await page.getByRole("button", { name: "Games" }).click();
  const menu = page.getByRole("dialog", { name: "Ways to play" });
  await expect(menu.getByTestId("best-which-way")).toHaveText(
    streak > 0 ? `Best: ${streak} in a row` : "No best yet",
  );
  await expect(menu.getByText("Playing now")).toBeVisible();
  expect(errors).toEqual([]);
});

const headed = (page: Page, point: number) =>
  page.getByRole("button", { name: `${LETTERS[point]}, headed ${NAMES[point]}`, exact: true });

/** The stop on screen, once the compass is ready: where you stand and where you're headed. */
async function stop(page: Page): Promise<[string, string]> {
  await expect(headed(page, 0)).toBeEnabled();
  const id = async (n: number) =>
    (await page.getByTestId(`way-photo-${n}`).getAttribute("data-photo"))!;
  return [await id(1), await id(2)];
}

test("a challenge link deals a friend the same journey, with the run to beat and the way it ended", async ({
  page,
}) => {
  test.setTimeout(150_000);
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
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  const sent = () => page.evaluate(() => (window as unknown as { sent: string }).sent);

  // The sender travels two stops right, then sets off the opposite way on the third.
  await page.goto("./which-way");
  const chain: string[] = [];
  for (let i = 0; i < 3; i++) {
    const [a, b] = await stop(page);
    if (i === 0) chain.push(a);
    chain.push(b);
    const truth = pointFrom(a, b);
    await headed(page, i < 2 ? truth : (truth + 4) % 8).click();
    if (i < 2) await card.getByRole("button", { name: "Travel on" }).click();
  }
  const miss = (pointFrom(chain[2], chain[3]) + 4) % 8;
  await expect(card).toContainText("Run over: 2 stops in a row.");
  const challengeButton = card.getByRole("button", { name: "Challenge a friend" });
  await expect(challengeButton).toBeInViewport();
  await challengeButton.click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const message = await sent();
  expect(message).toContain("I travelled 2 stops in a row.");
  const link = message.split("\n").at(-1)!;
  expect(link).toMatch(
    new RegExp(
      `/whereabout/which-way/?\\?challenge=${chain.join("\\.")}_[0-9a-z]+_2_${LETTERS[miss]}$`,
    ),
  );

  // The friend, with nothing kept, travels the same journey and gets every stop of it right.
  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  await expect(page.getByText("A friend's challenge: 2 stops in a row to beat")).toBeVisible();
  for (let i = 0; i < 3; i++) {
    expect(await stop(page)).toEqual([chain[i], chain[i + 1]]);
    await headed(page, pointFrom(chain[i], chain[i + 1])).click();
    if (i === 2) {
      await expect(card).toContainText("That beats your friend's 2 in a row!");
      await expect(card).toContainText(
        `Your friend's run ended here: they set off ${NAMES[miss]}.`,
      );
      await expect(page.getByTestId("way-dial-friend")).toBeAttached();
    } else {
      await expect(card).not.toContainText("Your friend's run ended here");
    }
    await card.getByRole("button", { name: "Travel on" }).click();
  }

  // Past the friend's photos the journey goes on to a new photo: set off the wrong way.
  const [a, b] = await stop(page);
  expect(a).toBe(chain[3]);
  expect(chain).not.toContain(b);
  await headed(page, (pointFrom(a, b) + 4) % 8).click();
  await expect(card).toContainText(
    "Run over: 3 stops in a row. You beat your friend's 2 in a row by 1.",
  );
  const { width, height } = page.viewportSize()!;
  const box = (await card.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  expect(await page.evaluate(() => localStorage.getItem("whereabout:which-way-best"))).toBe(null);

  const back = card.getByRole("button", { name: "Send yours back" });
  await expect(back).toBeInViewport();
  await back.click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const reply = await sent();
  expect(reply).toContain("That beats your 2. Your turn to travel further.");
  expect(reply).toMatch(new RegExp(`${chain.join("\\.")}\\.${b}_[0-9a-z]+_3_[A-Z]{1,2}$`));

  // Head to head: both runs drawn as a 1080px picture, saved, with the reply link copied.
  await page.evaluate(() => ((window as unknown as { sent: string }).sent = ""));
  const picture = card.getByRole("button", { name: "Share head to head" });
  await expect(picture).toBeInViewport({ ratio: 1 });
  const [download] = await Promise.all([page.waitForEvent("download"), picture.click()]);
  expect(download.suggestedFilename()).toBe("whereabout-which-way-head-to-head.png");
  const png = readFileSync((await download.path())!);
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1080]);
  await expect(page.getByText("Head to head saved.", { exact: false })).toBeVisible();
  expect(await sent()).toBe(reply);

  // A fresh run drops the link, so a reload doesn't deal the challenge again.
  await card.getByRole("button", { name: "Play a fresh run" }).click();
  await expect(page.getByText("Which way?: set off from photo 1 toward photo 2")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(errors).toEqual([]);
});

test("a broken Which way? challenge says so and deals a fresh run", async ({ page }) => {
  await page.goto("./which-way?challenge=wm001_3_9");
  await expect(page.getByText(/That challenge link was cut short/)).toBeVisible();
  await expect(page.getByText("Which way?: set off from photo 1 toward photo 2")).toBeVisible();
  await expect(headed(page, 0)).toBeEnabled();
});

test("the end of a Which way? run keeps both its buttons on a 320px phone", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./which-way");
  const [a, b] = await stop(page);
  await headed(page, (pointFrom(a, b) + 4) % 8).click();
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  for (const name of ["Start a new run", "Challenge a friend"]) {
    await expect(card.getByRole("button", { name })).toBeInViewport();
  }
  const scroll = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scroll[0]).toBeLessThanOrEqual(scroll[1]);
});
