import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { continentOf } from "../src/lib/continents";

const PHOTO = readFileSync(resolve(process.cwd(), "e2e/fixtures/photo.png"));

test.beforeEach(async ({ page }) => {
  await page.route(/wikimedia\.org/, (route) =>
    route.fulfill({ body: PHOTO, contentType: "image/png" }),
  );
});

test("your map shows the Odd one out run you played against Atlas's picks", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // A fresh browser has no record to show.
  await page.goto("./map/");
  await expect(page.getByText(/Nothing on your map yet/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /You and Atlas/ })).toHaveCount(0);

  // Play one free run of Odd one out to its first miss, always tapping photo 1.
  await page.goto("./odd-one-out");
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  let streak = 0;
  for (let i = 0; i < 40; i++) {
    await page.getByRole("button", { name: "Photo 1 is the odd one out" }).click();
    await expect(card).toBeVisible();
    if ((await card.getByRole("heading").textContent()) === "Wrong") break;
    streak++;
    await card.getByRole("button", { name: "Next four" }).click();
    await expect(card).toBeHidden();
  }
  await expect(card).toContainText(`Run over: ${streak} quad`);
  // The run's own reveal tells Atlas's tally on the same quads.
  const tally = /Atlas this run: (\d+) of (\d+) quad/.exec((await card.textContent())!);
  expect(tally).not.toBeNull();
  const [atlasRight, atlasPlayed] = [Number(tally![1]), Number(tally![2])];

  await page.goto("./map/");
  await expect(
    page.getByRole("heading", { name: "You and Atlas in the quick games" }),
  ).toBeVisible();
  const record = page.getByTestId("record-odd-one-out");
  await expect(record).toContainText("1 run");
  await expect(page.getByTestId("record-further-north")).toHaveCount(0);
  const you = page.getByTestId("record-odd-one-out-you");
  await expect(you).toHaveAttribute("data-right", String(streak));
  await expect(you).toHaveAttribute("data-played", String(streak + 1));
  const atlas = page.getByTestId("record-odd-one-out-atlas");
  await expect(atlas).toHaveAttribute("data-right", String(atlasRight));
  await expect(atlas).toHaveAttribute("data-played", String(atlasPlayed));

  // The verdict comes from those numbers alone.
  const yours = Math.round((streak / (streak + 1)) * 100);
  const atlases = atlasPlayed > 0 ? Math.round((atlasRight / atlasPlayed) * 100) : null;
  const line = page.getByTestId("record-odd-one-out-line");
  if (atlases === null) await expect(line).toHaveText("Atlas hasn't played a round with you yet.");
  else if (yours > atlases)
    await expect(line).toHaveText(new RegExp(`ahead of Atlas by ${yours - atlases} point`));
  else if (yours < atlases)
    await expect(line).toHaveText(new RegExp(`Atlas is ahead of you by ${atlases - yours} point`));
  else await expect(line).toHaveText("You and Atlas are level.");

  // The card fits the screen's width, phone or desktop.
  const { width } = page.viewportSize()!;
  const box = (await record.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);

  // Its link plays another run.
  await record.getByRole("link", { name: "Play Odd one out" }).click();
  await expect(page).toHaveURL(/\/odd-one-out\/?$/);
  expect(errors).toEqual([]);
});

const CATALOG: {
  id: string;
  country: string;
  drivingSide?: string;
  climateGroup?: string;
  landCover?: string;
}[] = JSON.parse(readFileSync(resolve(process.cwd(), "src/data/photos.json"), "utf8"));
const CLIMATE = new Map(CATALOG.map((p) => [p.id, p.climateGroup]));

test("your clue reading shows a Which climate? game against Atlas's read of the same photos", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("./map/");
  await expect(page.getByRole("heading", { name: "Your clue reading" })).toHaveCount(0);

  // Two right calls, then three wrong ones, by tap.
  await page.goto("./which-climate");
  for (let n = 0; n < 5; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 5`, { exact: true })).toBeVisible();
    const photo = page.getByTestId("climate-photo");
    await expect(photo).toHaveAttribute("data-photo", /.+/);
    const truth = CLIMATE.get((await photo.getAttribute("data-photo"))!)!;
    const pick = n < 2 ? truth : truth === "Polar" ? "Arid" : "Polar";
    await page.getByTestId(`climate-${pick}`).click();
    const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
    await card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }).click();
  }
  // The game's own end tells Atlas's score and how many photos it read.
  const end = (await page.getByText(/Atlas read the climate on/).textContent())!;
  const read = Number(/on (\d) of the 5 photos/.exec(end)![1]);
  const verdict = /You beat Atlas 2 to (\d)|Atlas wins (\d) to 2|You and Atlas tie on (2)/.exec(
    end,
  );
  expect(verdict).not.toBeNull();
  const atlasRight = Number(verdict![1] ?? verdict![2] ?? verdict![3]);

  await page.goto("./map/");
  const section = page.getByTestId("clue-reading");
  await expect(section.getByRole("heading", { name: "Your clue reading" })).toBeVisible();
  // No picking game was played, so the quick games' section stays away.
  await expect(page.getByTestId("quick-record")).toHaveCount(0);
  const record = section.getByTestId("record-climate");
  await expect(record.getByRole("heading", { name: "The climate" })).toBeVisible();
  await expect(record).toContainText("1 Which climate? game");
  const you = record.getByTestId("record-climate-you");
  await expect(you).toHaveAttribute("data-right", "2");
  await expect(you).toHaveAttribute("data-played", "5");
  await expect(you).toContainText("2 of 5 photos right");
  const atlas = record.getByTestId("record-climate-atlas");
  await expect(atlas).toHaveAttribute("data-right", String(atlasRight));
  await expect(atlas).toHaveAttribute("data-played", String(read));
  await expect(section.getByTestId("record-road")).toHaveCount(0);

  // The card fits the screen's width, phone or desktop, and plays another game.
  const { width } = page.viewportSize()!;
  const box = (await record.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  await record.getByRole("link", { name: "Play Which climate?" }).click();
  await expect(page).toHaveURL(/\/which-climate\/?$/);
  expect(errors).toEqual([]);
});

const BY_ID = new Map(CATALOG.map((p) => [p.id, p]));

test("Clue mix's calls count on Your map under each clue, the continent and the ground in cards of their own", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // The road, the climate and the continent right, then the ground missed.
  await page.goto("./clue-mix");
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  const atlas = { road: [0, 0], climate: [0, 0], continent: [0, 0], ground: [0, 0] };
  let before = [0, 0];
  for (const clue of ["road", "climate", "continent", "ground"] as const) {
    const photo = page.getByTestId("clue-photo");
    await expect(photo).toHaveAttribute("data-clue", clue);
    // The photo's id lands once its record has loaded.
    await expect(photo).toHaveAttribute("data-photo", /.+/);
    const p = BY_ID.get((await photo.getAttribute("data-photo"))!)!;
    const truth =
      clue === "road"
        ? p.drivingSide
        : clue === "climate"
          ? p.climateGroup
          : clue === "continent"
            ? continentOf(p.country)
            : p.landCover;
    let pick = truth!;
    if (clue === "ground") {
      const buttons = page.getByRole("group").getByRole("button");
      for (const b of await buttons.all()) {
        const id = (await b.getAttribute("data-testid"))!;
        if (id !== `clue-${truth}`) {
          pick = id.slice("clue-".length);
          break;
        }
      }
    }
    await page.getByTestId(`clue-${pick}`).click();
    await expect(card.getByRole("heading")).toHaveText(clue === "ground" ? "Wrong" : "Correct");
    // Atlas's running tally on the card says how it did on this step.
    const [, right, played] = /Atlas this run: (\d+) of (\d+)\./.exec((await card.textContent())!)!;
    atlas[clue] = [Number(right) - before[0], Number(played) - before[1]];
    before = [Number(right), Number(played)];
    if (clue !== "ground") await card.getByRole("button", { name: "Next photo" }).click();
  }

  await page.goto("./map/");
  const section = page.getByTestId("clue-reading");
  await expect(section.getByRole("heading", { name: "Your clue reading" })).toBeVisible();
  const { width } = page.viewportSize()!;
  for (const [clue, right] of [
    ["road", 1],
    ["climate", 1],
    ["continent", 1],
    ["ground", 0],
  ] as const) {
    const record = section.getByTestId(`record-${clue}`);
    await expect(record).toBeVisible();
    await expect(record.getByTestId(`record-${clue}-clue-mix-${clue}`)).toHaveText(
      "1 Clue mix run",
    );
    const you = record.getByTestId(`record-${clue}-you`);
    await expect(you).toHaveAttribute("data-right", String(right));
    await expect(you).toHaveAttribute("data-played", "1");
    const them = record.getByTestId(`record-${clue}-atlas`);
    await expect(them).toHaveAttribute("data-right", String(atlas[clue][0]));
    await expect(them).toHaveAttribute("data-played", String(atlas[clue][1]));
    const box = (await record.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  }
  await expect(section.getByTestId("record-continent")).toContainText("The continent");
  await expect(section.getByTestId("record-ground")).toContainText("The ground");
  await section
    .getByTestId("record-continent")
    .getByRole("link", { name: "Play Clue mix" })
    .click();
  await expect(page).toHaveURL(/\/clue-mix\/?$/);
  expect(errors).toEqual([]);
});

const GROUND_COVERS = [
  "Built-up",
  "Tree cover",
  "Grassland",
  "Permanent water bodies",
  "Bare / sparse vegetation",
];

test("What's on the ground?'s free games and today's game count on Your map under the ground", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const card = page.getByRole("region").filter({ has: page.getByRole("heading") });
  const photo = page.getByTestId("ground-photo");
  // Calls the photo on screen right or wrong, and returns Atlas's [right, read] on it from the card.
  async function call(right: boolean) {
    await expect(photo).toHaveAttribute("data-photo", /.+/);
    const truth = BY_ID.get((await photo.getAttribute("data-photo"))!)!.landCover!;
    const pick = right ? truth : truth === "Grassland" ? "Built-up" : "Grassland";
    const button = page.getByTestId(`ground-${GROUND_COVERS.indexOf(pick) + 1}`);
    await expect(button).toBeEnabled();
    await button.click();
    await expect(card.getByRole("heading")).toHaveText(right ? "Correct" : "Wrong");
    const text = (await card.textContent())!;
    if (text.includes("Atlas's clues named no ground cover")) return [0, 0] as const;
    expect(text).toMatch(/Atlas read it as /);
    return [text.includes(", and got it.") ? 1 : 0, 1] as const;
  }

  // A free game: two right, then three wrong.
  await page.goto("./on-the-ground");
  const atlas = [0, 0];
  for (let n = 0; n < 5; n++) {
    await expect(page.getByText(`Photo ${n + 1} of 5`, { exact: true })).toBeVisible();
    const [r, p] = await call(n < 2);
    atlas[0] += r;
    atlas[1] += p;
    await card.getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "2 of 5" })).toBeVisible();

  // Today's game: one right call, then away. The day is counted from what it keeps.
  await page.goto("./on-the-ground/daily");
  const today = await call(true);

  await page.goto("./map/");
  const section = page.getByTestId("clue-reading");
  const record = section.getByTestId("record-ground");
  await expect(record.getByRole("heading", { name: "The ground" })).toBeVisible();
  await expect(record.getByTestId("record-ground-on-the-ground")).toHaveText(
    "2 What's on the ground? games, 1 of them today's",
  );
  // Clue mix hasn't been played, so it isn't listed, and no other clue has a card.
  await expect(record.getByTestId("record-ground-clue-mix-ground")).toHaveCount(0);
  await expect(section.getByTestId("record-climate")).toHaveCount(0);
  const you = record.getByTestId("record-ground-you");
  await expect(you).toHaveAttribute("data-right", "3");
  await expect(you).toHaveAttribute("data-played", "6");
  const them = record.getByTestId("record-ground-atlas");
  await expect(them).toHaveAttribute("data-right", String(atlas[0] + today[0]));
  await expect(them).toHaveAttribute("data-played", String(atlas[1] + today[1]));

  // The card fits the screen, and leads to today's game.
  const { width } = page.viewportSize()!;
  const box = (await record.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  await record.getByRole("link", { name: "Today's What's on the ground?" }).click();
  await expect(page).toHaveURL(/\/on-the-ground\/daily\/?$/);
  await expect(page.getByText("Photo 2 of 5", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
