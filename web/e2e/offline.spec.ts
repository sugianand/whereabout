import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// The one spec with the service worker on (playwright.config.ts blocks it elsewhere). Routes and
// offline go on the context, not the page, so they also cover the worker's own requests
// (playwright.config.ts turns on Playwright's service-worker networking for that).
test.use({ serviceWorkers: "allow" });

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

test.beforeEach(async ({ context }) => {
  await context.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

/** Cuts every connection, the page's and the service worker's alike. */
async function goOffline(context: BrowserContext) {
  await context.unrouteAll({ behavior: "ignoreErrors" });
  await context.route("**/*", (route) => route.abort("internetdisconnected"));
  await context.setOffline(true);
}

async function cachedCounts(page: Page) {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const count = async (prefix: string) => {
      const name = names.find((n) => n.startsWith(prefix));
      return name ? (await (await caches.open(name)).keys()).length : 0;
    };
    return { records: await count("whereabout-records-"), photos: await count("whereabout-photos") };
  });
}

async function playRound(page: Page, round: number) {
  await expect(page.getByText(`Round ${round} of 5`, { exact: true })).toBeVisible();
  // The photo itself is on screen, not the "didn't load" message.
  await expect(page.locator('.wb-photo [data-photo-placeholder="covered"]')).toHaveCount(1);
  await expect(page.getByText(/This photo didn.t load/)).toHaveCount(0);
  const globe = page.getByRole("application", { name: /Globe/ });
  await globe.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/^Your pin: /)).toBeVisible();
  await page.getByRole("button", { name: "Guess here" }).click();
  const card = page.getByRole("region").filter({ hasText: "It was taken in" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: round < 5 ? "Next photo" : "See your results" }).click();
}

test("the game installs: a manifest with its icons, and the app's own icon", async ({ page }) => {
  await page.goto("./");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBe("/whereabout/manifest.webmanifest");
  const res = await page.request.get(href!);
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ short_name: "Whereabout", display: "standalone", start_url: "./" });
  for (const icon of manifest.icons as { src: string; type: string }[]) {
    const file = await page.request.get(new URL(icon.src, res.url()).href);
    expect(file.ok(), icon.src).toBe(true);
    expect(file.headers()["content-type"]).toBe(icon.type);
  }
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  // The worker takes charge of the page on the first visit.
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 })
    .toBe(true);
});

test("a started game keeps going without a connection, even through a reload", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./?daily");
  await expect(page.getByText("Round 1 of 5", { exact: true })).toBeVisible();
  // As soon as the five photos are dealt, the worker keeps their records and photos.
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 })
    .toBe(true);
  await expect
    .poll(async () => {
      const { records, photos } = await cachedCounts(page);
      return records === 5 && photos >= 10;
    }, { timeout: 30_000 })
    .toBe(true);

  await playRound(page, 1);

  // The connection drops; the player reloads. The page, the globe and the rest of the five
  // photos all come from the device, and the game picks up on round 2 where it was left.
  await goOffline(context);
  await page.reload();
  await expect(page.getByText(/^Daily Five, /)).toBeVisible();
  await expect(page.getByText("Picked up where you left off")).toBeVisible();
  for (let round = 2; round <= 5; round++) await playRound(page, round);
  await expect(page.getByText("out of 25,000 points")).toBeVisible();

  // Really offline: anything the worker has not kept fails.
  const fetched = await page.evaluate(() =>
    fetch("/whereabout/game-data/not-kept/none.json").then(
      () => "loaded",
      () => "failed",
    ),
  );
  expect(fetched).toBe("failed");
  expect(errors).toEqual([]);
});
