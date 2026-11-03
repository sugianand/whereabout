import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

test("Today lists every daily game from the Games menu, follows a real run, and shares the day", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const today = new Date().toISOString().slice(0, 10);

  // In from the Games menu of a round.
  await page.goto("./");
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  await page.getByRole("button", { name: "Games" }).click();
  await page
    .getByRole("dialog", { name: "Ways to play" })
    .getByRole("link", { name: /^Today/ })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(page.getByTestId("today-standing")).toContainText(
    /^0 of 5 played\. The next deal is in \d/,
  );
  const games = page.getByRole("list", { name: "Today's games" }).getByRole("listitem");
  await expect(games).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Share your day" })).toHaveCount(0);

  // Fits a phone, whole.
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scroll).toBeLessThanOrEqual(page.viewportSize()!.width);

  // A real answer in today's Further North shows up when you come back.
  await page.getByTestId("today-further-north").click();
  await page.getByRole("button", { name: "Photo 1 was taken further north" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        (day) =>
          !!(
            JSON.parse(localStorage.getItem("whereabout:further-north-daily") ?? "{}") as Record<
              string,
              unknown
            >
          )[day],
        today,
      ),
    )
    .toBe(true);
  await page.goto("./today");
  await expect(page.getByTestId("today-further-north")).toHaveAttribute(
    "data-status",
    /^(going|done)$/,
  );

  // The other games' days, as each of them keeps them.
  await page.evaluate((day) => {
    localStorage.setItem("whereabout:daily-scores", JSON.stringify({ [day]: 18240 }));
    localStorage.setItem(
      "whereabout:further-north-daily",
      JSON.stringify({ [day]: { streak: 6, atlasRight: 3, atlasPlayed: 5, ended: "miss" } }),
    );
    localStorage.setItem(
      "whereabout:odd-one-out-daily",
      JSON.stringify({ [day]: { streak: 2, atlasRight: 1, atlasPlayed: 2, ended: null } }),
    );
  }, today);
  await page.reload();
  await expect(page.getByTestId("today-standing")).toContainText(/^2 of 5 played/);
  await expect(page.getByTestId("today-daily-five")).toContainText("18,240 of 25,000");
  await expect(page.getByTestId("today-further-north")).toContainText("Atlas: 3 of 5");
  await expect(page.getByTestId("today-odd-one-out")).toHaveAttribute("data-status", "going");
  await expect(page.getByTestId("today-which-way")).toHaveAttribute("data-status", "new");

  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (t: string) => void ((window as unknown as { sent: string }).sent = t),
      },
      configurable: true,
    });
  });
  await page.getByRole("button", { name: "Share your day" }).click();
  await expect(page.getByText("Result copied. Paste it anywhere.")).toBeVisible();
  const sent = await page.evaluate(() => (window as unknown as { sent: string }).sent);
  expect(sent).toContain(`Whereabout · Today · ${today}\n2 of 5 daily games\n`);
  expect(sent).toContain("🌍 Daily Five: 18,240 of 25,000\n");
  expect(sent).toContain("⬆️ Further North: 6 pairs in a row\n");
  expect(sent).not.toContain("Odd one out");
  expect(sent).toMatch(/\/whereabout\/today\/?$/);

  // A card opens that game's day.
  await page.getByTestId("today-how-far").click();
  await expect(page).toHaveURL(/\/how-far\/daily/);
  expect(errors).toEqual([]);
});

test("the results screen leads to Today, already counting the game just finished", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("./?daily");
  for (let round = 1; round <= 5; round++) {
    const globe = page.getByRole("application", { name: /Globe/ });
    await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
    await globe.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Shift+ArrowRight");
    await page.getByRole("button", { name: "Guess here" }).click();
    await page.getByRole("button", { name: round < 5 ? "Next photo" : "See your results" }).click();
  }
  await expect(page.getByText("out of 25,000 points")).toBeVisible();

  const link = page.getByRole("link", { name: /^Today/ });
  await expect(link).toContainText("1 of 5 played");
  await link.click();
  // The summary's globe is still working on a software renderer, so the page can take a while.
  await expect(page.getByTestId("today-daily-five")).toHaveAttribute("data-status", "done", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("today-daily-five")).toContainText(/[\d,]+ of 25,000/);
});
