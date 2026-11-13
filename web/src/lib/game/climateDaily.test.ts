import { beforeEach, describe, expect, it } from "vitest";

import { bundledClimateGroups } from "./bundled";
import {
  CLIMATE_DAILY_KEY,
  climateDailyShare,
  climateDaySeed,
  dailyClimateOrder,
  loadClimateDay,
  loadClimateDays,
  parseClimateDay,
  rememberClimateDay,
} from "./climateDaily";
import { hashSeed } from "./daily";
import { BEST_CLIMATE_KEY, dealClimate, type ClimateMap, type ClimateResult } from "./whichClimate";

const GROUPS: ClimateMap = {
  t1: "Tropical",
  t2: "Tropical",
  a1: "Arid",
  a2: "Arid",
  m1: "Temperate",
  m2: "Temperate",
  m3: "Temperate",
  c1: "Continental",
  c2: "Continental",
  p1: "Polar",
};

const call = (
  id: string,
  picked: ClimateResult["picked"],
  truth: ClimateResult["truth"],
  atlas: ClimateResult["atlas"],
): ClimateResult => ({ id, picked, truth, correct: picked === truth, atlas });

beforeEach(() => localStorage.clear());

describe("dailyClimateOrder", () => {
  it("deals the same five photos to everyone on a day, and others the next day", () => {
    const today = dailyClimateOrder(GROUPS, "2026-11-13");
    expect(today).toHaveLength(5);
    expect(dailyClimateOrder({ ...GROUPS }, "2026-11-13")).toEqual(today);
    const week = ["14", "15", "16", "17", "18"].map((d) =>
      dailyClimateOrder(GROUPS, `2026-11-${d}`),
    );
    expect(week.some((order) => order.join() !== today.join())).toBe(true);
  });

  it("is the free games' even deal on the day's own seed", () => {
    expect(dailyClimateOrder(GROUPS, "2026-11-13")).toEqual(
      dealClimate(GROUPS, hashSeed("whereabout:which-climate:2026-11-13")),
    );
    expect(climateDaySeed("2026-11-13")).not.toBe(hashSeed("whereabout:left-right:2026-11-13"));
    expect(climateDaySeed("2026-11-13")).not.toBe(hashSeed("whereabout:2026-11-13"));
  });

  it("deals five different bundled photos with a climate each", () => {
    const order = dailyClimateOrder(bundledClimateGroups, "2026-11-13");
    expect(order).toHaveLength(5);
    expect(new Set(order).size).toBe(5);
    for (const id of order) expect(bundledClimateGroups[id]).toBeDefined();
  });
});

describe("the kept days", () => {
  const two = [call("t1", "Tropical", "Tropical", "Arid"), call("p1", "Arid", "Polar", null)];

  it("keep each day's calls under the game's own key, apart from the free games' best", () => {
    expect(loadClimateDay("2026-11-13")).toBeNull();
    rememberClimateDay("2026-11-13", two);
    expect(loadClimateDay("2026-11-13")).toEqual({ results: two });
    expect(loadClimateDay("2026-11-12")).toBeNull();
    expect(Object.keys(JSON.parse(localStorage.getItem(CLIMATE_DAILY_KEY)!))).toEqual([
      "2026-11-13",
    ]);
    expect(localStorage.getItem(BEST_CLIMATE_KEY)).toBeNull();
  });

  it("work out whether a call was right from the groups, never from what was stored", () => {
    localStorage.setItem(
      CLIMATE_DAILY_KEY,
      JSON.stringify({
        "2026-11-13": {
          results: [{ id: "p1", picked: "Arid", truth: "Polar", correct: true, atlas: null }],
        },
      }),
    );
    expect(loadClimateDay("2026-11-13")!.results[0].correct).toBe(false);
  });

  it("skip a day in any other shape", () => {
    const bad = [
      null,
      { results: "t1" },
      { results: [{ id: "t1", picked: "Hot", truth: "Tropical", atlas: null }] },
      { results: [{ id: "t1", picked: "Tropical", truth: "Tropical" }] },
      { results: [{ id: "", picked: "Tropical", truth: "Tropical", atlas: null }] },
      { results: [two[0], two[0]] },
      { results: Array.from({ length: 6 }, (_, i) => call(`x${i}`, "Arid", "Arid", null)) },
    ];
    for (const value of bad) expect(parseClimateDay(value)).toBeNull();
    localStorage.setItem(
      CLIMATE_DAILY_KEY,
      JSON.stringify({
        "2026-11-13": bad[2],
        "not a day": { results: two },
        "2026-11-12": { results: two },
      }),
    );
    expect(Object.keys(loadClimateDays())).toEqual(["2026-11-12"]);
  });

  it("survive storage that can't be read", () => {
    localStorage.setItem(CLIMATE_DAILY_KEY, "{not json");
    expect(loadClimateDays()).toEqual({});
  });
});

describe("climateDailyShare", () => {
  const href = "https://example.org/whereabout/which-climate/daily?x=1#y";

  it("is the score, a square a photo and Atlas's tally, naming no photo, place or climate", () => {
    const results = [
      call("t1", "Tropical", "Tropical", "Tropical"),
      call("a1", "Arid", "Arid", "Temperate"),
      call("m1", "Continental", "Temperate", "Temperate"),
      call("c1", "Continental", "Continental", "Temperate"),
      call("p1", "Arid", "Polar", "Polar"),
    ];
    const text = climateDailyShare("2026-11-13", results, href);
    expect(text).toBe(
      [
        "Whereabout · Which climate? · 2026-11-13",
        "🌦️ 3 of 5",
        "🟩🟩🟥🟩🟥",
        "Atlas: 3 of 5",
        "https://example.org/whereabout/which-climate/daily",
      ].join("\n"),
    );
    for (const word of ["t1", "Tropical", "Polar", "Temperate"]) expect(text).not.toContain(word);
  });

  it("says how many photos Atlas gave no read on, and leaves Atlas out when it read none", () => {
    const some = [
      call("t1", "Tropical", "Tropical", "Tropical"),
      call("a2", "Arid", "Arid", null),
      call("p1", "Polar", "Polar", null),
    ];
    expect(climateDailyShare("2026-11-13", some, href)).toContain(
      "\nAtlas: 1 of 1 (no read on 2)\n",
    );
    const none = [call("a2", "Arid", "Arid", null)];
    expect(climateDailyShare("2026-11-13", none, href)).not.toContain("Atlas");
  });
});
