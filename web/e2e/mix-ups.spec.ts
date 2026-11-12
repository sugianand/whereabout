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

test("Practise your mix-ups deals only those countries, each with the one it was taken for, and keeps its own best", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./map/");
  await page.evaluate(() =>
    localStorage.setItem(
      "whereabout:mix-ups",
      JSON.stringify([
        { truth: "JP", picked: "KR" },
        { truth: "KR", picked: "JP" },
      ]),
    ),
  );
  await page.reload();
  const section = page.getByRole("region", { name: "Countries you mix up" });
  await expect(section.getByTestId("mix-ups-practice-note")).toContainText(
    /^Name the country with \d+ photos from these countries/,
  );
  await section.getByRole("link", { name: "Practise your mix-ups" }).click();
  await expect(page).toHaveURL(/\/name-country\/mix-ups\/?$/);
  await expect(page.getByText("Your mix-ups: which of these four?")).toBeVisible();

  const names = async () =>
    Promise.all(
      [1, 2, 3, 4].map((n) => page.getByTestId(`name-option-${n}`).getAttribute("data-country")),
    );

  // Name two photos right: each is Japan or South Korea, with the other among its names.
  for (let i = 0; i < 2; i++) {
    await expect(page.getByTestId("name-option-4")).toBeEnabled();
    const truth = BY_ID.get((await page.locator("main").getAttribute("data-photo"))!)!.country;
    expect(["JP", "KR"]).toContain(truth);
    const offered = await names();
    expect(offered).toContain(truth === "JP" ? "KR" : "JP");
    await page.getByTestId(`name-option-${offered.indexOf(truth) + 1}`).click();
    await expect(page.getByRole("heading", { name: /^Right: / })).toBeVisible();
    await page.getByRole("button", { name: "Next photo" }).click();
  }

  // Then take the photo for its partner: the run ends, with no challenge to send.
  await expect(page.getByTestId("name-option-4")).toBeEnabled();
  const truth = BY_ID.get((await page.locator("main").getAttribute("data-photo"))!)!.country;
  const partner = truth === "JP" ? "KR" : "JP";
  await page.getByTestId(`name-option-${(await names()).indexOf(partner) + 1}`).click();
  await expect(page.getByRole("heading", { name: /^Wrong: / })).toBeVisible();
  await expect(page.getByText("Run over: 2 countries in a row.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Challenge a friend" })).toHaveCount(0);

  // Your map counts the miss, and shows practice's own best.
  await page.goto("./map/");
  await expect(section.getByTestId("mix-up").first()).toContainText("3 times");
  await expect(section.getByTestId("mix-ups-practice-note")).toContainText(
    "Your best: 2 in a row.",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("whereabout:name-country-best")),
  ).toBeNull();
  expect(errors).toEqual([]);
});
