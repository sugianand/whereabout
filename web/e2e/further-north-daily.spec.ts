import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

test("today's Further North deals the day's pairs once, resumes after a reload, and shares as counts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const today = new Date().toISOString().slice(0, 10);

  // The free runs link to today's run.
  await page.goto("./further-north");
  await page.getByRole("link", { name: "Today's run" }).click();
  await expect(page.getByText(`today's run (${today})`)).toBeVisible();
  const { width, height } = page.viewportSize()!;

  // Everyone on one day gets the same pairs: a fresh player (nothing kept) is dealt the same.
  await expect(page.getByRole("button", { name: "Photo 1 was taken further north" })).toBeEnabled();
  const first = [
    await page.getByTestId("north-photo-1").getAttribute("data-photo"),
    await page.getByTestId("north-photo-2").getAttribute("data-photo"),
  ];
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("north-photo-1")).toHaveAttribute("data-photo", first[0]!);
  await expect(page.getByTestId("north-photo-2")).toHaveAttribute("data-photo", first[1]!);

  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  let streak = 0;
  for (let i = 0; i < 40; i++) {
    await expect(
      page.getByRole("button", { name: "Photo 1 was taken further north" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Photo 1 was taken further north" }).click();
    await expect(card).toBeVisible();
    if ((await card.getByRole("heading").textContent()) === "Wrong") break;
    streak++;
    if (streak === 1) {
      // A reload mid-run picks up at the next pair with the streak so far.
      const kept = await page.getByTestId("north-photo-2").getAttribute("data-photo");
      await page.reload();
      await expect(page.getByTestId("north-photo-1")).toHaveAttribute("data-photo", kept!);
      await expect(page.getByText("Streak", { exact: true }).locator("+ dd")).toHaveText("1");
      continue;
    }
    await card.getByRole("button", { name: "Next pair" }).click();
  }

  const plural = streak === 1 ? "pair" : "pairs";
  await expect(card).toContainText(`Today's run is over: ${streak} ${plural} in a row.`);
  const box = (await card.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  await expect(card.getByRole("button", { name: "Start a new run" })).toHaveCount(0);

  // A reload shows the day's result, never the pairs again.
  await page.reload();
  await expect(page.getByRole("heading", { name: `${streak} ${plural} in a row` })).toBeVisible();
  await expect(page.getByText(/The next run is dealt in \d+/)).toBeVisible();
  await expect(page.getByRole("button", { name: /was taken further north/ })).toHaveCount(0);

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
    `Whereabout · Further North · ${today}\n⬆️ ${streak} ${plural} in a row\n`,
  );
  expect(sent).toContain(`${"🟩".repeat(Math.min(streak, 30))}${streak > 30 ? "…" : ""}🟥`);
  expect(sent).toMatch(/\/whereabout\/further-north\/daily\/?$/);

  // The free runs' best is its own.
  expect(await page.evaluate(() => localStorage.getItem("whereabout:further-north-best"))).toBe(
    null,
  );
  await page.getByRole("link", { name: "Play a free run" }).click();
  await expect(page.getByText("Further North: which photo was taken further north?")).toBeVisible();
  expect(errors).toEqual([]);
});
