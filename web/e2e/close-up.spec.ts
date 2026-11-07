import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG: { id: string; country: string; place: string }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const BY_ID = new Map(CATALOG.map((p) => [p.id, p]));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({
      body: PHOTO,
      contentType: "image/png",
      headers: { "access-control-allow-origin": "*" },
    }),
  );
});

const option = (page: Page, n: number) => page.getByTestId(`close-option-${n}`);
const photo = (page: Page) => page.getByTestId("close-photo");

/** Which of the four is right, and which wrong, for the photo on screen. */
async function shown(page: Page) {
  await expect(option(page, 4)).toBeVisible();
  const id = (await page.locator("main").getAttribute("data-photo"))!;
  const names = await Promise.all(
    [1, 2, 3, 4].map(async (n) => (await option(page, n).getAttribute("data-country"))!),
  );
  const right = names.indexOf(BY_ID.get(id)!.country) + 1;
  return { right, wrong: [1, 2, 3, 4].filter((n) => n !== right) };
}

async function inView(page: Page, target: ReturnType<Page["getByRole"]>) {
  const { width, height } = page.viewportSize()!;
  const box = (await target.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
}

/** The photo as drawn, once its zoom has settled. */
async function drawnWidth(page: Page) {
  return photo(page).evaluate(async (img) => {
    await Promise.all(img.getAnimations().map((a) => a.finished));
    return img.getBoundingClientRect().width;
  });
}

test("Close-up zooms out with each wrong name, plays five photos against Atlas, and keeps the best", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./close-up");
  await expect(page.getByText("Close-up: which country is this?")).toBeVisible();
  await expect(page.getByText("Photo 1 of 5")).toBeVisible();
  await expect(page.getByText("Worth 3 points")).toBeVisible();

  // The crop fills the frame and a wrong name widens it.
  let { right, wrong } = await shown(page);
  const tight = await drawnWidth(page);
  const frame = (await page.getByTestId("close-frame").boundingBox())!;
  expect(tight).toBeGreaterThan(frame.width * 2);
  await option(page, wrong[0]).click();
  await expect(option(page, wrong[0])).toBeDisabled();
  await expect(page.getByText("Worth 2 points")).toBeVisible();
  expect(await drawnWidth(page)).toBeLessThan(tight);

  // The right name shows the whole photo, inside the frame.
  await option(page, right).click();
  await expect(page.getByRole("heading", { name: /^Right/ })).toBeVisible();
  await expect(page.getByText(/^2 points, after 1 wrong\./)).toBeVisible();
  await expect(photo(page)).toHaveAttribute("data-stage", "whole");
  expect(await drawnWidth(page)).toBeLessThanOrEqual(frame.width + 1);
  const next = page.getByRole("button", { name: "Next photo" });
  await expect(next).toBeFocused();
  await inView(page, next);
  await next.click();

  // Three wrong names end a photo on nothing.
  await expect(page.getByText("Photo 2 of 5")).toBeVisible();
  ({ right, wrong } = await shown(page));
  for (const n of wrong) await option(page, n).click();
  await expect(page.getByRole("heading", { name: /^Out of tries/ })).toBeVisible();
  await next.click();

  // Right first time on the rest, from the keyboard.
  for (const i of [3, 4, 5]) {
    await expect(page.getByText(`Photo ${i} of 5`)).toBeVisible();
    ({ right } = await shown(page));
    await expect(option(page, right)).toBeEnabled();
    await page.keyboard.press(String(right));
    await page.keyboard.press("Enter");
  }

  await expect(page.getByRole("heading", { name: "11 of 15 points" })).toBeVisible();
  await expect(page.getByText("That's your new best!")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(5);
  await page.reload();
  await expect(page.getByText("Photo 1 of 5")).toBeVisible();
  await expect(page.locator("header dl")).toContainText("11");
  expect(errors).toEqual([]);
});

test("Close-up still deals when the photo can't be read for its busiest spot", async ({ page }) => {
  // Without a CORS header the small copy is refused, as it would be for a photo kept offline.
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
  await page.goto("./close-up");
  await expect(option(page, 4)).toBeEnabled();
  await expect(photo(page)).toHaveAttribute("data-stage", "0");
});

test("on a 320px phone the crop, the names and the answer stay on screen", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("./close-up");
  const { right } = await shown(page);
  await expect(option(page, right)).toBeEnabled();
  const frame = (await page.getByTestId("close-frame").boundingBox())!;
  expect(frame.height).toBeGreaterThan(100);
  for (const n of [1, 2, 3, 4]) await inView(page, option(page, n));
  await option(page, right).click();
  const next = page.getByRole("button", { name: "Next photo" });
  await expect(next).toBeVisible();
  await inView(page, next);
  await expect((await page.getByTestId("close-frame").boundingBox())!.height).toBeGreaterThan(40);
});

test("today's Close-up deals the day's photos once, keeps a wrong name through a reload, and shares tries", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const today = new Date().toISOString().slice(0, 10);
  const { width, height } = page.viewportSize()!;
  const current = () => page.locator("main").getAttribute("data-photo");

  // The free game links to today's.
  await page.goto("./close-up");
  await page.getByRole("link", { name: "Today's game" }).click();
  await expect(page.getByText(`Today's close-ups (${today})`)).toBeVisible();
  await expect(page.locator("header dl")).not.toContainText("Best");

  // A fresh player (nothing kept) is dealt the same photo and names.
  const dealt = await shown(page);
  let { right } = dealt;
  const { wrong } = dealt;
  const first = await current();
  const firstNames = await page.locator("[data-country]").evaluateAll((els) =>
    els.map((el) => el.getAttribute("data-country")),
  );
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(option(page, 4)).toBeEnabled();
  expect(await current()).toBe(first);
  expect(
    await page.locator("[data-country]").evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-country")),
    ),
  ).toEqual(firstNames);

  // The header's extra link leaves the names and the crop on screen, down to a 320px phone.
  for (const w of [width, 320]) {
    await page.setViewportSize({ width: w, height: Math.min(height, 568) });
    for (const n of [1, 2, 3, 4]) await inView(page, option(page, n));
    expect((await page.getByTestId("close-frame").boundingBox())!.height).toBeGreaterThan(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
  }
  await page.setViewportSize({ width, height });

  // A wrong name can't be taken back by a reload: the crop opens wider, the name ruled out.
  await option(page, wrong[0]).click();
  await expect(page.getByText("Worth 2 points")).toBeVisible();
  await page.reload();
  await expect(option(page, wrong[0])).toBeDisabled();
  await expect(page.getByText("Worth 2 points")).toBeVisible();
  await expect(photo(page)).toHaveAttribute("data-stage", "1");
  expect(await current()).toBe(first);
  await option(page, right).click();
  await expect(page.getByText(/^2 points, after 1 wrong\./)).toBeVisible();

  // A reload on the reveal picks up at the next photo, the score kept.
  await page.reload();
  await expect(page.getByText("Photo 2 of 5")).toBeVisible();
  await expect(page.locator("header dl dd").first()).toHaveText("2");

  for (const i of [2, 3, 4, 5]) {
    await expect(page.getByText(`Photo ${i} of 5`)).toBeVisible();
    ({ right } = await shown(page));
    await expect(option(page, right)).toBeEnabled();
    await option(page, right).click();
    await page.getByRole("button", { name: i === 5 ? "See the score" : "Next photo" }).click();
  }

  const headline = page.getByRole("heading", { level: 1 });
  await expect(headline).toHaveText("14 of 15 points");
  await expect(page.getByRole("list", { name: "Your photos" }).getByRole("listitem")).toHaveCount(5);

  // A reload shows the day's result, never the photos again.
  await page.reload();
  await expect(headline).toHaveText("14 of 15 points");
  await expect(page.getByText(/The next run is dealt in \d+/)).toBeVisible();
  await expect(option(page, 1)).toHaveCount(0);

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
  expect(sent).toContain(
    `Whereabout · Close-up · ${today}\n🔍 14 of 15 points\n🟥🟩 🟩 🟩 🟩 🟩\n`,
  );
  expect(sent).toMatch(/\/whereabout\/close-up\/daily\/?$/);
  for (const p of CATALOG) expect(sent).not.toContain(p.place);

  // Today counts it, and the free games' best is its own.
  expect(await page.evaluate(() => localStorage.getItem("whereabout:close-up-best"))).toBe(null);
  await page.goto("./today");
  await expect(page.getByTestId("today-close-up")).toHaveAttribute("data-status", "done");
  await expect(page.getByTestId("today-close-up")).toContainText("14 of 15 points");
  expect(errors).toEqual([]);
});

test("a challenge link deals a friend the same crops and names, with the points to beat", async ({
  page,
}) => {
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

  // The sender plays a game: one wrong name on the first photo, then right every time.
  await page.goto("./close-up");
  const dealt: { id: string; names: string[] }[] = [];
  for (let i = 1; i <= 5; i++) {
    await expect(page.getByText(`Photo ${i} of 5`)).toBeVisible();
    const { right, wrong } = await shown(page);
    await expect(option(page, right)).toBeEnabled();
    dealt.push({
      id: (await page.locator("main").getAttribute("data-photo"))!,
      names: await Promise.all(
        [1, 2, 3, 4].map(async (n) => (await option(page, n).getAttribute("data-country"))!),
      ),
    });
    if (i === 1) await option(page, wrong[0]).click();
    await option(page, right).click();
    await page.getByRole("button", { name: i === 5 ? "See the score" : "Next photo" }).click();
  }
  await expect(page.getByRole("heading", { name: "14 of 15 points" })).toBeVisible();
  await page.getByRole("button", { name: "Challenge a friend" }).click();
  await expect(page.getByText(/^Challenge (sent|link copied)/)).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(sent).toContain("I named these five crops for 14 of 15 points.");
  for (const p of CATALOG) expect(sent).not.toContain(p.place);
  const link = sent.split("\n").at(-1)!;
  expect(link).toMatch(/\/whereabout\/close-up\/?\?challenge=[\w.-]+_[0-9a-z]+_2\.3\.3\.3\.3$/);

  // The friend opens it in a browser of their own, with no best and nothing kept.
  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  await expect(page.getByText("A friend's challenge: 14 points to beat")).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await expect(page.getByText(`Photo ${i + 1} of 5`)).toBeVisible();
    const { right, wrong } = await shown(page);
    await expect(page.locator("main")).toHaveAttribute("data-photo", dealt[i].id);
    for (const [n, country] of dealt[i].names.entries()) {
      await expect(option(page, n + 1)).toHaveAttribute("data-country", country);
    }
    // Two wrong names on the last photo: one point there, 13 in all.
    if (i === 4) for (const n of wrong.slice(0, 2)) await option(page, n).click();
    await option(page, right).click();
    await expect(page.getByText(`Your friend: ${i === 0 ? 2 : 3} points.`)).toBeVisible();
    await page.getByRole("button", { name: i === 4 ? "See the score" : "Next photo" }).click();
  }
  await expect(page.getByRole("heading", { name: "13 of 15 points" })).toBeVisible();
  await expect(page.getByText(/^Your friend won by 1 point\. Your friend scored 14\./)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("whereabout:close-up-best"))).toBe(null);

  const back = page.getByRole("button", { name: "Send yours back" });
  await inView(page, back);
  await back.click();
  const reply = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(reply).toContain("Your 14 wins this time. Try them again?");
  expect(reply).toMatch(/_3\.3\.3\.3\.1$/);

  // A fresh game drops the link, so a reload doesn't deal the challenge again.
  await page.getByRole("button", { name: "Play a fresh game" }).click();
  await expect(page.getByText("Close-up: which country is this?")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  expect(errors).toEqual([]);
});

test("a broken challenge link says so and deals a fresh game", async ({ page }) => {
  await page.goto("./close-up?challenge=wm001.wm002_zz_3.3");
  await expect(page.getByText(/That challenge link was cut short/)).toBeVisible();
  await expect(page.getByText("Close-up: which country is this?")).toBeVisible();
  await expect(option(page, 4)).toBeEnabled();
});
