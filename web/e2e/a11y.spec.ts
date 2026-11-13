import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Every screen a player reaches, checked by axe-core against WCAG 2.2 A and AA and axe's best
// practices, on the desktop and the phone projects, in the dark and the light theme (the device's
// setting, which the site follows until the player picks one). A failure lists each problem with the rule,
// what it asks for and the element, so it reads without opening the trace.

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

// Fades and count-ups settle at once, so axe reads the colours a player reads, not a frame of a
// transition.
test.use({ contextOptions: { reducedMotion: "reduce" } });

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

/** What axe finds wrong on the page as it stands, one readable line per element. */
async function problems(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id} (${v.impact}): ${v.help} — ${n.target.join(" ")}`),
  );
}

async function expectAccessible(page: Page, scene: string) {
  expect(await problems(page), scene).toEqual([]);
}

/** The globe's keyboard pin where it is looking, then the guess, as a round or Survival takes it. */
async function guessWithKeyboard(page: Page) {
  await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
  await page.getByRole("application", { name: /Globe/ }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Guess here" }).click();
}

const FIRST_SCREENS = [
  "./",
  "./?daily",
  "./?blitz",
  "./streak",
  "./survival",
  "./further-north",
  "./further-north/daily",
  "./odd-one-out",
  "./how-far",
  "./which-way",
  "./hot-cold",
  "./name-country",
  "./line-up",
  "./close-up",
  "./left-right",
  "./left-right/daily",
  "./which-climate",
  "./which-climate/daily",
  "./pass-and-play",
  "./today",
  "./map",
  "./stamps",
  "./atlas",
  "./you",
];

for (const colorScheme of ["dark", "light"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const path of FIRST_SCREENS) {
      test(`the first screen of ${path} passes axe`, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await expectAccessible(page, path);
      });
    }

    test("a whole game passes axe: the round, its help, the Games menu, a reveal, the results, then Your map, Today and Stamps", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.goto("./");
      await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
      await expectAccessible(page, "a round");

      await page.getByRole("button", { name: /^Hint −/ }).click();
      await expect(page.getByRole("list", { name: "Hints" })).toBeVisible();
      await expectAccessible(page, "a round with a hint");

      await page.getByRole("application", { name: /Globe/ }).focus();
      await page.keyboard.press("?");
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectAccessible(page, "the help sheet");
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Games" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectAccessible(page, "the Games menu");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();

      for (let round = 1; round <= 5; round++) {
        await guessWithKeyboard(page);
        const card = page.getByRole("region").filter({ hasText: "It was taken in" });
        await expect(card).toBeVisible();
        if (round === 1) await expectAccessible(page, "a reveal");
        await card
          .getByRole("button", { name: round < 5 ? "Next photo" : "See your results" })
          .click();
      }
      await expect(page.getByText("out of 25,000 points")).toBeVisible();
      await expectAccessible(page, "the results");

      // The pages that read what the browser kept, now with a game in them.
      for (const path of ["./map", "./today", "./stamps"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await expectAccessible(page, `${path} after a game`);
      }
    });

    // The quick games picked with their keys: the reveal after the first pick.
    const KEYED = [
      ["further-north", "1"],
      ["odd-one-out", "1"],
      ["which-way", "8"],
      ["name-country", "1"],
      ["close-up", "1"],
      ["left-right", "ArrowLeft"],
      ["which-climate", "1"],
    ] as const;

    for (const [path, key] of KEYED) {
      test(`${path} passes axe at its first reveal`, async ({ page }) => {
        await page.goto(`./${path}`);
        await expect(page.locator(`[aria-keyshortcuts="${key}"]`).first()).toBeEnabled();
        await page.keyboard.press(key);
        // Picked: the key's button is gone or spent, whether the pick revealed or (Close-up) zoomed out.
        await expect(page.locator(`[aria-keyshortcuts="${key}"]:enabled`)).toHaveCount(0);
        await expectAccessible(page, `${path} reveal`);
      });
    }

    for (const path of ["line-up", "how-far"]) {
      test(`${path} passes axe at its first reveal`, async ({ page }) => {
        await page.goto(`./${path}`);
        const lock = page.getByRole("button", { name: "Lock it in" });
        await expect(lock).toBeEnabled();
        await lock.click();
        await expect(lock).toBeHidden();
        await expectAccessible(page, `${path} reveal`);
      });
    }

    test("survival passes axe at its first reveal", async ({ page }) => {
      await page.goto("./survival");
      await guessWithKeyboard(page);
      await expect(
        page.getByRole("region").filter({ has: page.getByRole("heading", { name: / away$/ }) }),
      ).toBeVisible();
      await expectAccessible(page, "survival reveal");
    });

    // Hot and cold's clue line and arrow sit over the photo and the globe's panel.
    test("hot-cold passes axe after its first pin", async ({ page }) => {
      await page.goto("./hot-cold");
      await expect(page.getByRole("button", { name: "Zoom in on the photo" })).toBeVisible();
      await page.getByRole("application", { name: /Globe/ }).focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("g");
      // A miss gives a heading to follow; a first-pin hit goes straight to the card.
      await expect(
        page
          .getByTestId("hot-cold-clue")
          .or(page.getByRole("region").filter({ has: page.getByRole("heading", { level: 2 }) }))
          .first(),
      ).toBeVisible();
      await expectAccessible(page, "hot-cold after a pin");
    });
  });
}
