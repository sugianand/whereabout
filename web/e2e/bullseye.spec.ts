import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG = new Map(
  (
    JSON.parse(readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8")) as {
      id: string;
      lng: number;
      lat: number;
    }[]
  ).map((p) => [p.id, { lng: p.lng, lat: p.lat }]),
);

// Kilometres: a language region that reads distances in them.
test.use({ locale: "de-DE" });

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

async function expectOnScreen(locator: Locator) {
  const { width, height } = locator.page().viewportSize()!;
  const box = (await locator.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
}

async function photoAt(page: Page) {
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  const id = await page.locator("main[data-photo]").getAttribute("data-photo");
  return CATALOG.get(id!)!;
}

/**
 * Drop the pin with the keyboard and walk it with the arrows to within half a degree of
 * `target`'s latitude and longitude (Shift moves 10°).
 */
async function pinNear(page: Page, target: { lng: number; lat: number }) {
  await page.getByRole("application", { name: /Globe/ }).focus();
  await page.keyboard.press("Enter");
  const status = await page.getByText(/^Your pin: /).innerText();
  const m = status.match(/([\d.]+)° ([NS]), ([\d.]+)° ([EW])/)!;
  const lat = Number(m[1]) * (m[2] === "S" ? -1 : 1);
  const lng = Number(m[3]) * (m[4] === "W" ? -1 : 1);
  let dx = Math.round(target.lng - lng);
  if (dx > 180) dx -= 360;
  if (dx < -180) dx += 360;
  const dy = Math.round(target.lat - lat);
  const steps: [number, string, string][] = [
    [dx, "ArrowRight", "ArrowLeft"],
    [dy, "ArrowUp", "ArrowDown"],
  ];
  for (const [d, plus, minus] of steps) {
    const key = d < 0 ? minus : plus;
    const n = Math.abs(d);
    for (let i = 0; i < Math.floor(n / 10); i++) await page.keyboard.press(`Shift+${key}`);
    for (let i = 0; i < n % 10; i++) await page.keyboard.press(key);
  }
}

test("Bullseye bets a ring around each pin: inside pays the ring, outside nothing, against Atlas's rings", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./");
  await page.getByRole("button", { name: "Games" }).click();
  await page
    .getByRole("dialog", { name: "Ways to play" })
    .getByRole("link", { name: /^Bullseye/ })
    .click();
  await expect(page).toHaveURL(/\/bullseye\/?$/, { timeout: 20_000 });
  await expect(page.getByText("Bullseye: photo 1 of 5")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tap the globe to pin the photo" })).toBeDisabled();
  await expect(page.getByRole("radio", { name: /^750 km/ })).toBeChecked();

  const score = page.getByTestId("bullseye-score");
  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });

  // Photo 1: the pin on the place and the tightest ring, picked with 1, bet with G.
  let truth = await photoAt(page);
  await pinNear(page, truth);
  await page.keyboard.press("1");
  await expect(page.getByRole("radio", { name: /^250 km/ })).toBeChecked();
  const bet = page.getByRole("button", { name: "Bet the 250 km ring for 1,000" });
  await expect(bet).toBeEnabled();
  await expectOnScreen(bet);
  await expectOnScreen(page.getByRole("radio", { name: /^5,000 km/ }));
  await page.keyboard.press("g");
  await expect(card).toContainText("Inside your ring");
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("1,000 points");
  await expect(card.getByTestId("bullseye-you")).toHaveText(
    /^You: Inside the 250 km ring, [\d,]+ km off: 1,000 points\.$/,
  );
  // Atlas bets on every photo it guessed, its ring from its own confidence.
  await expect(card.getByTestId("bullseye-atlas")).toHaveText(
    /^Atlas \(dashed ring\): (Inside|Outside) the [\d,]+ km ring, [\d,.]+ k?m off: ([\d,]+ points|no points)\.$/,
  );
  await expect(score).toHaveText("1,000");
  await expectOnScreen(card.getByRole("button", { name: "Next photo" }));
  await page.keyboard.press("Enter");

  // Photo 2: 40° of latitude off on the 250 km ring, tapped: nothing.
  await expect(page.getByText("Bullseye: photo 2 of 5")).toBeVisible();
  // The ring bet last time is where the next photo starts.
  await expect(page.getByRole("radio", { name: /^250 km/ })).toBeChecked();
  truth = await photoAt(page);
  await pinNear(page, { lng: truth.lng, lat: truth.lat > 0 ? truth.lat - 40 : truth.lat + 40 });
  await page.getByRole("button", { name: "Bet the 250 km ring for 1,000" }).click();
  await expect(card).toContainText("Outside your ring");
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("0 points");
  await expect(score).toHaveText("1,000");
  await page.keyboard.press("Enter");

  // Photos 3 to 5: on the place, the widest ring, picked by tap.
  for (let i = 3; i <= 5; i++) {
    await expect(page.getByText(`Bullseye: photo ${i} of 5`)).toBeVisible();
    truth = await photoAt(page);
    await pinNear(page, truth);
    await page.getByText("5,000 km", { exact: true }).click();
    await page.keyboard.press("g");
    await expect(card.getByRole("heading", { level: 2 })).toHaveText("100 points");
    if (i === 5) await expect(card.getByRole("button", { name: "See your score" })).toBeFocused();
    await page.keyboard.press("Enter");
  }

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("1,300 points");
  await expect(page.getByText(/Your rings held 4 of 5 photos\./)).toContainText(
    "That's your new best!",
  );
  await expect(page.getByTestId("bullseye-atlas-total")).toHaveText(/^Atlas scored [\d,]+/);
  await expect(page.getByRole("list", { name: "Your photos" }).getByRole("listitem")).toHaveCount(
    5,
  );
  expect(await page.evaluate(() => localStorage.getItem("whereabout:bullseye-best"))).toBe("1300");

  // A new game starts at nothing, with the best in the Games menu.
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByText("Bullseye: photo 1 of 5")).toBeVisible();
  await expect(score).toHaveText("0");
  await page.getByRole("button", { name: "Games" }).click();
  await expect(page.getByTestId("best-bullseye")).toHaveText("Best: 1,300 points");
  await expect(page.getByRole("dialog").getByText("Playing now")).toBeVisible();
  expect(errors).toEqual([]);
});

test("the ring buttons and the bet fit a 320px phone", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1000) >= 768, "a phone layout check");
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("./bullseye");
  await photoAt(page);
  for (const name of [/^250 km/, /^750 km/, /^2,000 km/, /^5,000 km/]) {
    await expectOnScreen(page.getByRole("radio", { name }).locator(".."));
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
