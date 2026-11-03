import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

test("today's How far apart? deals the day's pairs once, resumes after a reload, and shares points", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const today = new Date().toISOString().slice(0, 10);
  const lock = page.getByRole("button", { name: "Lock it in" });
  const label = (n: number) => `How far apart?, today's game (${today}): pair ${n} of 5`;

  // The free game links to today's.
  await page.goto("./how-far");
  await page.getByRole("link", { name: "Today's game" }).click();
  await expect(page.getByText(label(1))).toBeVisible();
  const { width, height } = page.viewportSize()!;

  // Everyone on one day gets the same pair: a fresh player (nothing kept) is dealt it too.
  await expect(lock).toBeEnabled();
  const first = [
    await page.getByTestId("how-far-photo-1").getAttribute("data-photo"),
    await page.getByTestId("how-far-photo-2").getAttribute("data-photo"),
  ];
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(lock).toBeEnabled();
  await expect(page.getByTestId("how-far-photo-1")).toHaveAttribute("data-photo", first[0]!);
  await expect(page.getByTestId("how-far-photo-2")).toHaveAttribute("data-photo", first[1]!);

  // Photos, slider and button all fit the screen with the header's extra link.
  for (const n of [1, 2]) {
    const box = (await page.getByTestId(`how-far-photo-${n}`).boundingBox())!;
    expect(box.height).toBeGreaterThan(120);
  }
  const button = (await lock.boundingBox())!;
  expect(button.y + button.height).toBeLessThanOrEqual(height + 1);

  const score = page.getByText("Score", { exact: true }).locator("+ dd");
  const slider = page.getByRole("slider", { name: "How far apart were these taken?" });
  for (let i = 0; i < 5; i++) {
    await expect(page.getByText(label(i + 1))).toBeVisible();
    await expect(lock).toBeEnabled();
    await slider.fill(String(120 + i * 40));
    await lock.click();
    if (i === 1) {
      // A reload on the reveal picks up at the next pair, the score kept, the pair not dealt again.
      const kept = await score.textContent();
      await page.reload();
      await expect(page.getByText(label(3))).toBeVisible();
      await expect(score).toHaveText(kept!);
      continue;
    }
    await page.getByRole("button", { name: i === 4 ? "See your score" : "Next pair" }).click();
  }

  const headline = page.getByRole("heading", { level: 1 });
  await expect(headline).toHaveText(/^[\d,]+ points$/);
  const total = (await headline.textContent())!.replace(" points", "");
  await expect(page.getByRole("list", { name: "Your pairs" }).getByRole("listitem")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Play again" })).toHaveCount(0);
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scroll).toBeLessThanOrEqual(width);

  // A reload shows the day's result, never the pairs again.
  await page.reload();
  await expect(headline).toHaveText(`${total} points`);
  await expect(page.getByText(/The next run is dealt in \d+/)).toBeVisible();
  await expect(slider).toHaveCount(0);

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
  expect(sent).toContain(`Whereabout · How far apart? · ${today}\n📏 ${total} of 5,000\n`);
  expect(sent).toMatch(/\n[🟩🟨🟥]{5}\n/u);
  expect(sent).toMatch(/\/whereabout\/how-far\/daily\/?$/);

  // The free games' best is its own.
  expect(await page.evaluate(() => localStorage.getItem("whereabout:how-far-best"))).toBe(null);
  await page.getByRole("link", { name: "Play a free run" }).click();
  await expect(page.getByText("How far apart? Pair 1 of 5")).toBeVisible();
  expect(errors).toEqual([]);
});
