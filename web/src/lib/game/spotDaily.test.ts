import { beforeEach, describe, expect, it } from "vitest";

import { dailyBullseyeOrder } from "./bullseyeDaily";
import type { GameRecord } from "./deck";
import { SPOT_PHOTOS, spotResult, type SpotResult } from "./spotClue";
import {
  SPOT_DAILY_KEY,
  dailySpotOrder,
  loadSpotDay,
  parseSpotDay,
  rememberSpotDay,
  settleSpot,
  spotDailyShare,
  spotDayDone,
  spotMark,
} from "./spotDaily";
import type { AtlasLooked } from "./types";

const IDS = Array.from({ length: 40 }, (_, i) => `p${i}`);
const HREF = "https://example.test/whereabout/spot-the-clue/daily/?x=1#y";

/** A 3 × 3 map: the middle square mattered most, the top left a little over half as much. */
const LOOKED: AtlasLooked = {
  grid: 3,
  crop: [0, 0, 1, 1],
  cells: [0.6, 0.1, 0, 0, 1, 0, 0, 0, 0.3],
};

const spotOn: SpotResult = { id: "p1", cell: 4, points: 1000, hottest: true };
const warm: SpotResult = { id: "p2", cell: 0, points: 600, hottest: false };
const cool: SpotResult = { id: "p3", cell: 8, points: 300, hottest: false };
const cold: SpotResult = { id: "p4", cell: 2, points: 0, hottest: false };

beforeEach(() => localStorage.clear());

/** Through JSON, as storage holds it, then back. */
const stored = (day: unknown) => JSON.parse(JSON.stringify(day)) as unknown;

const record = (id: string, looked: AtlasLooked) =>
  ({ photo: { id }, atlas: { looked } }) as unknown as GameRecord;

describe("the day's deal", () => {
  it("is five photos, the same for everyone on a day, and changes with the day", () => {
    const day = dailySpotOrder(IDS, "2026-11-23");
    expect(day).toHaveLength(SPOT_PHOTOS);
    expect(new Set(day).size).toBe(SPOT_PHOTOS);
    expect(dailySpotOrder(IDS, "2026-11-23")).toEqual(day);
    expect(dailySpotOrder(IDS, "2026-11-24")).not.toEqual(day);
  });

  it("is dealt on its own seed, apart from the other daily games' photos that day", () => {
    expect(dailySpotOrder(IDS, "2026-11-23")).not.toEqual(dailyBullseyeOrder(IDS, "2026-11-23"));
  });
});

describe("the day kept", () => {
  it("keeps each square and reads the day back the same", () => {
    rememberSpotDay("2026-11-23", [spotOn, warm]);
    expect(loadSpotDay("2026-11-23")).toEqual({ results: [spotOn, warm] });
    expect(loadSpotDay("2026-11-24")).toBeNull();
    expect(spotDayDone(loadSpotDay("2026-11-23"))).toBe(false);
  });

  it("is done once every photo is answered", () => {
    rememberSpotDay("2026-11-23", [spotOn, warm, cool, cold, { ...cold, id: "p5" }]);
    expect(spotDayDone(loadSpotDay("2026-11-23"))).toBe(true);
    expect(spotDayDone(null)).toBe(false);
  });

  it("keeps only the fields it reads back", () => {
    rememberSpotDay("2026-11-23", [{ ...spotOn, extra: 1 } as SpotResult]);
    const raw = JSON.parse(localStorage.getItem(SPOT_DAILY_KEY)!) as Record<string, unknown>;
    expect(raw["2026-11-23"]).toEqual({ results: [spotOn] });
  });

  it("refuses junk and squares past the game's own bounds", () => {
    expect(parseSpotDay(null)).toBeNull();
    expect(parseSpotDay({ results: "nope" })).toBeNull();
    expect(parseSpotDay(stored({ results: [spotOn, spotOn] }))).toBeNull();
    const six = ["a", "b", "c", "d", "e", "f"].map((id) => ({ ...cold, id }));
    expect(parseSpotDay({ results: six })).toBeNull();
    for (const bad of [
      { ...warm, points: 1001 },
      { ...warm, points: 12.5 },
      { ...warm, points: -1 },
      { ...warm, cell: -1 },
      { ...warm, cell: 1.5 },
      { ...warm, cell: 99_999 },
      { ...warm, hottest: "yes" },
      { ...warm, id: "" },
      // The hottest square is always the full 1,000.
      { ...warm, hottest: true },
    ]) {
      expect(parseSpotDay({ results: [bad] })).toBeNull();
    }
    expect(parseSpotDay(stored({ results: [] }))).toEqual({ results: [] });
  });

  it("skips a malformed day and keeps the rest", () => {
    localStorage.setItem(
      SPOT_DAILY_KEY,
      JSON.stringify({ "2026-11-23": { results: [spotOn] }, "2026-11-24": { results: 3 } }),
    );
    expect(loadSpotDay("2026-11-23")).toEqual({ results: [spotOn] });
    expect(loadSpotDay("2026-11-24")).toBeNull();
  });
});

describe("settling a kept day against the maps", () => {
  it("scores each square again from its photo's map, not from what was stored", () => {
    const forged: SpotResult = { id: "p2", cell: 8, points: 1000, hottest: true };
    const records = new Map([["p2", record("p2", LOOKED)]]);
    const [settled] = settleSpot([forged], records);
    expect(settled).toEqual(spotResult("p2", LOOKED, 8));
    expect(settled).toMatchObject({ points: 300, hottest: false });
  });

  it("keeps what was read back while a photo is still loading", () => {
    expect(settleSpot([warm], new Map())).toEqual([warm]);
  });
});

describe("the share line", () => {
  it("colours each photo by its verdict, warmest green", () => {
    expect([spotOn, warm, cool, cold].map(spotMark)).toEqual(["🟩", "🟨", "🟧", "🟥"]);
  });

  it("says the day, the points, the clues found and a square per photo, and no place", () => {
    const five = [spotOn, warm, cool, cold, { ...spotOn, id: "p5" }];
    const text = spotDailyShare("2026-11-23", five, HREF);
    expect(text).toBe(
      [
        "Whereabout · Spot the clue · 2026-11-23",
        "🔍 2,900 of 5,000 · Atlas's clue found on 2 of 5",
        "🟩🟨🟧🟥🟩",
        "https://example.test/whereabout/spot-the-clue/daily/",
      ].join("\n"),
    );
    // No square's position: the share never says where on the photo the clue was.
    expect(text).not.toMatch(/row|column/i);
  });
});
