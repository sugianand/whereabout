import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { CONTROLS, type HelpScreen } from "../src/lib/controls";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
// The globe's zoom lands on moveend, after the animation's last frame: slow on a CI runner.
const CAMERA_SETTLES = { timeout: 20_000 };

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

const controlsOf = (screen: HelpScreen) => CONTROLS[screen].flatMap((g) => g.controls);
const keyed = (screen: HelpScreen) =>
  controlsOf(screen)
    .filter((c) => c.keys.length > 0)
    .map((c) => c.id)
    .sort();
const keysOf = (screen: HelpScreen, id: string) =>
  controlsOf(screen)
    .find((c) => c.id === id)!
    .keys.map((k) => k.press);

/** The sheet lists every control of the screen, each with the keys or the gesture it says. */
async function expectSheetLists(sheet: Locator, screen: HelpScreen, touch: boolean) {
  const viewport = sheet.page().viewportSize()!;
  const box = (await sheet.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  for (const control of controlsOf(screen)) {
    const row = sheet.locator(`li[data-control="${control.id}"]`);
    await expect(row).toContainText(control.does);
    if (touch) {
      await expect(row.locator(".wb-help-touch")).toHaveText(control.touch);
      await expect(row.locator(".wb-help-mouse")).toBeHidden();
      await expect(row.locator("kbd").first()).toBeHidden();
    } else {
      await expect(row.locator(".wb-help-mouse")).toHaveText(control.mouse);
      await expect(row.locator(".wb-help-touch")).toBeHidden();
      await expect(row.locator("kbd")).toHaveText(control.keys.map((k) => k.label));
    }
  }
}

async function openWithKey(page: Page, title: string) {
  await page.keyboard.press("?");
  const sheet = page.getByRole("dialog", { name: title });
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe("on a keyboard", () => {
  test.skip(({ isMobile }) => isMobile, "the keys are checked on the desktop project");

  test("? lists a round's controls, and every key it lists works", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const checked = new Set<string>();

    await page.goto("./?daily");
    const photoIn = page.getByRole("button", { name: "Zoom in on the photo" });
    const photoOut = page.getByRole("button", { name: "Zoom out of the photo" });
    await expect(photoIn).toBeVisible();

    const sheet = await openWithKey(page, "Controls for a round");
    await expectSheetLists(sheet, "round", false);
    // Keys pressed in the sheet stay in it: H takes no hint behind it.
    await page.keyboard.press(keysOf("round", "round-hint")[0]);
    await expect(page.getByRole("list", { name: "Hints" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    checked.add("help");

    // The photo: + and − zoom, arrows look around, 0 and Esc go back to the whole photo.
    const [zoomIn, zoomOut] = keysOf("round", "photo-zoom");
    await photoIn.focus();
    await page.keyboard.press(zoomIn);
    await expect(photoOut).toBeFocused();
    await page.keyboard.press(zoomOut);
    await expect(photoIn).toBeFocused();
    checked.add("photo-zoom");

    await page.keyboard.press(zoomIn);
    const img = photoOut.locator("img");
    for (const arrow of keysOf("round", "photo-pan")) {
      const before = await img.evaluate((el) => el.style.transform);
      await page.keyboard.press(arrow);
      await expect.poll(() => img.evaluate((el) => el.style.transform)).not.toBe(before);
    }
    checked.add("photo-pan");

    for (const reset of keysOf("round", "photo-reset")) {
      await expect(photoOut).toBeFocused();
      await page.keyboard.press(reset);
      await expect(photoIn).toBeFocused();
      await page.keyboard.press(zoomIn);
    }
    await page.keyboard.press("0");
    checked.add("photo-reset");

    // The globe: Enter drops the pin, arrows move it, + and − zoom.
    const globe = page.getByRole("application", { name: /Globe/ });
    const status = page.locator("#globe-pin-status");
    await globe.focus();
    await page.keyboard.press(keysOf("round", "globe-pin")[0]);
    await expect(status).toHaveText(/^Your pin: /);
    checked.add("globe-pin");

    for (const arrow of keysOf("round", "globe-move")) {
      for (const press of [arrow, `Shift+${arrow}`]) {
        const before = await status.textContent();
        await page.keyboard.press(press);
        await expect(status).not.toHaveText(before!);
      }
    }
    checked.add("globe-move");

    const frame = page.locator(".globe[data-ready]");
    await expect(frame).toBeVisible({ timeout: 20_000 });
    for (const zoom of keysOf("round", "globe-zoom")) {
      const before = await frame.getAttribute("data-zoom");
      await page.keyboard.press(zoom);
      await expect(frame).not.toHaveAttribute("data-zoom", before!, CAMERA_SETTLES);
    }
    checked.add("globe-zoom");

    // The round: H takes a hint, G guesses, Enter goes on from the answer.
    await page.keyboard.press(keysOf("round", "round-hint")[0]);
    await expect(page.getByRole("list", { name: "Hints" }).getByRole("listitem")).toHaveCount(1);
    checked.add("round-hint");

    await page.keyboard.press(keysOf("round", "round-guess")[0]);
    const card = page.getByRole("region").filter({ hasText: "It was taken in" });
    await expect(card).toBeVisible();
    checked.add("round-guess");

    await expect(card.getByRole("button", { name: "Next photo" })).toBeFocused();
    await page.keyboard.press(keysOf("round", "round-next")[0]);
    await expect(page.getByText("Round 2 of 5", { exact: true })).toBeVisible();
    checked.add("round-next");

    // G with no pin yet guesses nothing.
    await page.keyboard.press(keysOf("round", "round-guess")[0]);
    await expect(page.getByText("Place your pin", { exact: true })).toBeVisible();
    await expect(card).toBeHidden();

    expect([...checked].sort()).toEqual(keyed("round"));
    expect(errors).toEqual([]);
  });

  for (const [screen, path, title, next] of [
    [
      "further-north",
      "./further-north",
      "Controls for Further North",
      /^(Next pair|Start a new run)$/,
    ],
    ["odd-one-out", "./odd-one-out", "Controls for Odd one out", /^(Next four|Start a new run)$/],
  ] as const) {
    test(`? lists ${screen}'s controls, and every pick key works`, async ({ page }) => {
      await page.goto(path);
      const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
      const picks = keysOf(screen, "pick");
      await expect(page.locator("[data-photo]")).toHaveCount(picks.length);

      await expect(page.getByRole("button", { name: /^Photo 1 / })).toBeEnabled();
      const sheet = await openWithKey(page, title);
      await expectSheetLists(sheet, screen, false);
      // A pick key pressed in the sheet doesn't pick behind it.
      await page.keyboard.press(picks[0]);
      await expect(card).toBeHidden();
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();

      for (const pick of picks) {
        // A key only picks once the photos on screen have loaded their records.
        await expect(
          page.getByRole("button", { name: new RegExp(`^Photo ${pick} `) }),
        ).toBeEnabled();
        await page.keyboard.press(pick);
        await expect(card).toBeVisible();
        await expect(card.getByRole("button", { name: next })).toBeFocused();
        await page.keyboard.press(keysOf(screen, "next")[0]);
        await expect(card).toBeHidden();
      }
    });
  }
  test("? lists Which way?'s controls, and every compass key works", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("./which-way");
    const checked = new Set<string>();
    const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
    const picks = keysOf("which-way", "pick");
    expect(picks).toHaveLength(8);

    await expect(page.getByRole("button", { name: "Headed north", exact: true })).toBeEnabled();
    const sheet = await openWithKey(page, "Controls for Which way?");
    await expectSheetLists(sheet, "which-way", false);
    checked.add("help");
    // A compass key pressed in the sheet doesn't pick behind it.
    await page.keyboard.press(picks[0]);
    await expect(card).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    for (const pick of picks) {
      const name = await page.locator(`[aria-keyshortcuts="${pick}"]`).getAttribute("aria-label");
      // A key only picks once both photos' records are in.
      await expect(page.getByRole("button", { name: name!, exact: true })).toBeEnabled();
      await page.keyboard.press(pick);
      await expect(card).toBeVisible();
      // The card says which point was picked, unless the pick was right on.
      const said = (await card.textContent())!;
      const point = name!.replace("Headed ", "");
      const verdict = await card.getByRole("heading", { level: 2 }).textContent();
      if (verdict === "Wrong") expect(said).toContain(`You picked ${point}.`);
      await expect(
        card.getByRole("button", { name: /^(Travel on|Start a new run)$/ }),
      ).toBeFocused();
      await page.keyboard.press(keysOf("which-way", "next")[0]);
      await expect(card).toBeHidden();
    }
    checked.add("pick");
    checked.add("next");
    expect([...checked].sort()).toEqual(keyed("which-way"));
  });

  test("? lists How far apart?'s controls, and every key it lists works", async ({ page }) => {
    await page.goto("./how-far");
    const checked = new Set<string>();
    const slider = page.getByRole("slider", { name: "How far apart were these taken?" });
    const estimate = page.getByTestId("how-far-estimate");
    const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
    await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();

    // ? opens the sheet even with the slider focused.
    await slider.focus();
    const sheet = await openWithKey(page, "Controls for How far apart?");
    await expectSheetLists(sheet, "how-far", false);
    checked.add("help");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(card).toBeHidden();

    // The arrows move the slider one step either way.
    await slider.focus();
    for (const key of keysOf("how-far", "distance")) {
      const before = await estimate.textContent();
      await page.keyboard.press(key);
      await expect(estimate).not.toHaveText(before!);
    }
    checked.add("distance");

    await page.keyboard.press(keysOf("how-far", "lock")[0]);
    await expect(card).toBeVisible();
    checked.add("lock");

    await expect(card.getByRole("button", { name: "Next pair" })).toBeFocused();
    await page.keyboard.press(keysOf("how-far", "next")[0]);
    await expect(card).toBeHidden();
    await expect(page.getByText("How far apart? Pair 2 of 5")).toBeVisible();
    // The next pair hands focus back to the slider, so the arrows work straight away.
    await expect(slider).toBeFocused();
    checked.add("next");

    expect([...checked].sort()).toEqual(keyed("how-far"));
  });
});

test.describe("on a touch screen", () => {
  test.skip(({ isMobile }) => !isMobile, "the gestures are checked on the phone project");

  for (const [screen, path, title] of [
    ["round", "./?daily", "Controls for a round"],
    ["further-north", "./further-north", "Controls for Further North"],
    ["odd-one-out", "./odd-one-out", "Controls for Odd one out"],
    ["how-far", "./how-far", "Controls for How far apart?"],
    ["which-way", "./which-way", "Controls for Which way?"],
  ] as const) {
    test(`the help button lists ${screen}'s gestures on screen`, async ({ page }) => {
      await page.goto(path);
      const button = page.getByRole("button", { name: "Controls" });
      await expect(button).toBeVisible();
      const box = (await button.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);

      await button.tap();
      const sheet = page.getByRole("dialog", { name: title });
      await expect(sheet).toBeVisible();
      await expectSheetLists(sheet, screen, true);
      await sheet.getByRole("button", { name: "Close" }).tap();
      await expect(sheet).toBeHidden();
    });
  }
});
