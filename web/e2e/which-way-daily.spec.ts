import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

test("today's Which way? deals the day's journey once, resumes after a reload, and shares as counts", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const today = new Date().toISOString().slice(0, 10);
  const north = page.getByRole("button", { name: "Headed north", exact: true });

  // The free runs link to today's run.
  await page.goto("./which-way");
  await page.getByRole("link", { name: "Today's run" }).click();
  await expect(page.getByText(`today's run (${today})`)).toBeVisible();
  const { width, height } = page.viewportSize()!;

  // Everyone on one day sets off the same way: a fresh player (nothing kept) is dealt the same.
  await expect(north).toBeEnabled();
  const first = [
    await page.getByTestId("way-photo-1").getAttribute("data-photo"),
    await page.getByTestId("way-photo-2").getAttribute("data-photo"),
  ];
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(north).toBeEnabled();
  await expect(page.getByTestId("way-photo-1")).toHaveAttribute("data-photo", first[0]!);
  await expect(page.getByTestId("way-photo-2")).toHaveAttribute("data-photo", first[1]!);

  const card = page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) });
  // Always heading north is right now and then: travel on until a miss ends the run.
  let streak = 0;
  for (let i = 0; i < 40; i++) {
    await expect(north).toBeEnabled();
    const headed = await page.getByTestId("way-photo-2").getAttribute("data-photo");
    await north.click();
    await expect(card).toBeVisible();
    if ((await card.getByRole("heading", { level: 2 }).textContent()) === "Wrong") break;
    streak++;
    if (streak === 1) {
      // A reload on the reveal picks up where the right pick took you, with the streak so far.
      await page.reload();
      await expect(north).toBeEnabled();
      await expect(page.getByTestId("way-photo-1")).toHaveAttribute("data-photo", headed!);
      await expect(page.getByText("Streak", { exact: true }).locator("+ dd")).toHaveText("1");
      continue;
    }
    await card.getByRole("button", { name: "Travel on" }).click();
    await expect(page.getByTestId("way-photo-1")).toHaveAttribute("data-photo", headed!);
  }

  const plural = streak === 1 ? "stop" : "stops";
  await expect(card).toContainText(`Today's run is over: ${streak} ${plural} in a row.`);
  const box = (await card.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  await expect(card.getByRole("button", { name: "Start a new run" })).toHaveCount(0);

  // A reload shows the day's result, never the journey again.
  await page.reload();
  await expect(page.getByRole("heading", { name: `${streak} ${plural} in a row` })).toBeVisible();
  await expect(page.getByText(/The next run is dealt in \d+/)).toBeVisible();
  await expect(page.getByTestId("way-compass")).toHaveCount(0);

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
  expect(sent).toContain(`Whereabout · Which way? · ${today}\n🧭 ${streak} ${plural} in a row\n`);
  expect(sent).toContain(`${"🟩".repeat(Math.min(streak, 30))}${streak > 30 ? "…" : ""}🟥`);
  expect(sent).toMatch(/\/whereabout\/which-way\/daily\/?$/);

  // The free runs' best is its own.
  expect(await page.evaluate(() => localStorage.getItem("whereabout:which-way-best"))).toBe(null);
  await page.getByRole("link", { name: "Play a free run" }).click();
  await expect(page.getByText("Which way?: set off from photo 1 toward photo 2")).toBeVisible();
  expect(errors).toEqual([]);
});
