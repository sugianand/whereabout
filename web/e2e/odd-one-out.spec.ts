import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { continentOf } from "../src/lib/continents";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG: { id: string; country: string }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const COUNTRY = new Map(CATALOG.map((p) => [p.id, p.country]));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

async function shown(page: Page): Promise<string[]> {
  return Promise.all(
    [1, 2, 3, 4].map(
      async (n) => (await page.getByTestId(`odd-photo-${n}`).getAttribute("data-photo"))!,
    ),
  );
}

test("Odd one out deals four photos until the first wrong tap, and keeps the best", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./odd-one-out");
  await expect(page.getByText(/Odd one out: three photos share a continent/)).toBeVisible();
  const { width, height } = page.viewportSize()!;

  // All four photos and their tap targets fit on screen, in a two-by-two grid.
  for (const n of [1, 2, 3, 4]) {
    await expect(page.getByRole("button", { name: `Photo ${n} is the odd one out` })).toBeEnabled();
    const box = (await page.getByTestId(`odd-photo-${n}`).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    expect(box.height).toBeGreaterThan(100);
  }

  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  // Always tapping photo 1 is right about a quarter of the time: play until a miss.
  let streak = 0;
  for (let i = 0; i < 40; i++) {
    const ids = await shown(page);
    expect(new Set(ids).size).toBe(4);
    // From the catalog, not the page: three photos share a continent, and one doesn't.
    const continents = ids.map((id) => continentOf(COUNTRY.get(id)));
    const odd = continents.findIndex((c) => continents.filter((d) => d === c).length === 1);
    expect(continents.filter((c) => c !== continents[odd])).toHaveLength(3);
    await page.getByRole("button", { name: "Photo 1 is the odd one out" }).click();
    await expect(card).toBeVisible();
    const box = (await card.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    await expect(card).toContainText(
      `Photo ${odd + 1} was taken in ${continents[odd]}; the other three in ${continents[(odd + 1) % 4]}.`,
    );
    await expect(card.getByRole("heading")).toHaveText(odd === 0 ? "Right" : "Wrong");
    // Every photo now names its continent.
    for (const n of [1, 2, 3, 4]) {
      await expect(page.getByTestId(`odd-photo-${n}`)).toContainText(continents[n - 1]!);
    }

    if ((await card.getByRole("heading").textContent()) === "Wrong") break;
    streak++;
    await card.getByRole("button", { name: "Next four" }).click();
    await expect(card).toBeHidden();
    await expect.poll(() => shown(page)).not.toEqual(ids);
  }

  await expect(card).toContainText(`Run over: ${streak} quad`);
  expect(await page.evaluate(() => localStorage.getItem("whereabout:odd-one-out-best"))).toBe(
    streak > 0 ? String(streak) : null,
  );

  // A new run starts at 0, and the best survives a reload.
  await card.getByRole("button", { name: "Start a new run" }).click();
  await expect(page.getByText("Streak", { exact: true }).locator("+ dd")).toHaveText("0");
  await page.reload();
  await expect(page.getByText("Best", { exact: true }).locator("+ dd")).toHaveText(String(streak));
  // Keys 1 to 4 tap a photo.
  await expect(page.getByRole("button", { name: "Photo 4 is the odd one out" })).toBeEnabled();
  await page.keyboard.press("4");
  await expect(card).toBeVisible();
  expect(errors).toEqual([]);
});

/** The slot (0–3) of the photo from the other continent, read from the catalog. */
function oddIndex(ids: string[]): number {
  const continents = ids.map((id) => continentOf(COUNTRY.get(id)));
  return continents.findIndex((c) => continents.filter((d) => d === c).length === 1);
}

test("a challenge link deals a friend the same quads, laid out the same, with the run to beat", async ({
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
  const photo = (n: number) => page.getByRole("button", { name: `Photo ${n} is the odd one out` });

  // The sender spots one, then misses.
  await page.goto("./odd-one-out");
  const dealt: string[][] = [];
  let missPick = 0;
  for (let i = 0; i < 2; i++) {
    await expect(photo(4)).toBeEnabled();
    const ids = await shown(page);
    dealt.push(ids);
    const odd = oddIndex(ids);
    const pick = i === 0 ? odd : (odd + 1) % 4;
    missPick = pick;
    await photo(pick + 1).click();
    if (i === 0) await card.getByRole("button", { name: "Next four" }).click();
  }
  await expect(card).toContainText("Run over: 1 quad in a row.");
  const challengeButton = card.getByRole("button", { name: "Challenge a friend" });
  await expect(challengeButton).toBeInViewport();
  await challengeButton.click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const message = await sent();
  expect(message).toContain("I spotted the odd one in 1 quad in a row.");
  const link = message.split("\n").at(-1)!;
  expect(link).toMatch(
    new RegExp(
      `/whereabout/odd-one-out/?\\?challenge=${dealt.map((q) => q.join("\\.")).join("-")}_1_${missPick + 1}$`,
    ),
  );

  // The friend, with nothing kept, gets the same quads in the same places, and goes further.
  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  await expect(page.getByText("A friend's challenge: 1 quad in a row to beat")).toBeVisible();
  for (let i = 0; i < 2; i++) {
    await expect(photo(4)).toBeEnabled();
    expect(await shown(page)).toEqual(dealt[i]);
    await photo(oddIndex(dealt[i]) + 1).click();
    if (i === 1) {
      await expect(card).toContainText("That beats your friend's 1 in a row!");
      await expect(card).toContainText(
        `Your friend's run ended here: they picked photo ${missPick + 1}.`,
      );
      await expect(page.getByTestId(`odd-photo-${missPick + 1}`)).toContainText("Friend's pick");
    }
    await card.getByRole("button", { name: "Next four" }).click();
  }
  // Past the friend's miss, the run plays on with a fresh quad.
  await expect(photo(4)).toBeEnabled();
  const third = await shown(page);
  expect(third).not.toEqual(dealt[1]);
  await photo(((oddIndex(third) + 1) % 4) + 1).click();
  await expect(card).toContainText(
    "Run over: 2 quads in a row. You beat your friend's 1 in a row by 1.",
  );
  const { width, height } = page.viewportSize()!;
  const box = (await card.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  expect(await page.evaluate(() => localStorage.getItem("whereabout:odd-one-out-best"))).toBe(null);

  const back = card.getByRole("button", { name: "Send yours back" });
  await expect(back).toBeInViewport();
  await back.click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const reply = await sent();
  expect(reply).toContain("That beats your 1. Your turn to go further.");
  expect(reply).toMatch(/_2_[1-4]$/);

  // A fresh run drops the link, so a reload doesn't deal the challenge again.
  await card.getByRole("button", { name: "Play a fresh run" }).click();
  await expect(page.getByText(/^Odd one out: three photos share a continent/)).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(errors).toEqual([]);
});

test("a broken Odd one out challenge says so and deals a fresh run", async ({ page }) => {
  await page.goto("./odd-one-out?challenge=wm001.wm002_3_9");
  await expect(page.getByText(/That challenge link was cut short/)).toBeVisible();
  await expect(page.getByText(/^Odd one out: three photos share a continent/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Photo 4 is the odd one out" })).toBeEnabled();
});

test("the end of a run keeps both its buttons on a 320px phone", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./odd-one-out");
  await expect(page.getByRole("button", { name: "Photo 4 is the odd one out" })).toBeEnabled();
  const ids = await shown(page);
  const wrong = ((oddIndex(ids) + 1) % 4) + 1;
  await page.getByRole("button", { name: `Photo ${wrong} is the odd one out` }).click();
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
