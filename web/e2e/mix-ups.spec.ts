import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { countryName } from "../src/lib/countries";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));
const CATALOG: { id: string; country: string }[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"),
);
const BY_ID = new Map(CATALOG.map((p) => [p.id, p]));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

test("a wrong name lands in Countries you mix up on Your map, with a streak to practise, on a 320px phone", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 320, height: 700 });

  await page.goto("./name-country");
  // Two earlier mix-ups of the same pair, kept as the games keep them, so it leads the list.
  await page.evaluate(() =>
    localStorage.setItem(
      "whereabout:mix-ups",
      JSON.stringify([
        { truth: "JP", picked: "KR" },
        { truth: "KR", picked: "JP" },
      ]),
    ),
  );

  // Miss the first photo on purpose, and note what was tapped for what.
  await expect(page.getByTestId("name-option-4")).toBeEnabled();
  const id = (await page.locator("main").getAttribute("data-photo"))!;
  const truth = BY_ID.get(id)!.country;
  let wrong = "";
  for (const n of [1, 2, 3, 4]) {
    const code = (await page.getByTestId(`name-option-${n}`).getAttribute("data-country"))!;
    if (code !== truth) {
      wrong = code;
      await page.getByTestId(`name-option-${n}`).click();
      break;
    }
  }
  await expect(page.getByRole("heading", { name: /^Wrong: / })).toBeVisible();

  await page.goto("./map/");
  const section = page.getByRole("region", { name: "Countries you mix up" });
  await expect(section).toBeVisible();
  await expect(section).toContainText("from your last 3 wrong answers");
  const rows = section.getByTestId("mix-up");

  // The pair just missed is listed with which way round it went (unless it is the seeded pair).
  const played = [truth, wrong].sort().join() === "JP,KR";
  await expect(rows).toHaveCount(played ? 1 : 2);
  if (!played) {
    await expect(rows.nth(1)).toContainText(`${countryName(truth)} and ${countryName(wrong)}`);
    await expect(rows.nth(1)).toContainText(/\bonce\b/);
    await expect(rows.nth(1).getByText(/^You said /)).toContainText(`${countryName(wrong)} for `);
  }

  const first = rows.first();
  await expect(first).toContainText(/Japan and South Korea|South Korea and Japan/);
  await expect(first).toContainText(
    played ? "3 times" : "You said South Korea for Japan once, and Japan for South Korea once.",
  );

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await first.getByRole("link", { name: "Country Streak in Asia" }).click();
  await expect(page).toHaveURL(/\/streak\/?\?region=asia$/, { timeout: 20_000 });
  await expect(page.getByRole("application", { name: /Globe/ })).toBeVisible();
  expect(errors).toEqual([]);
});
