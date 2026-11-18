import { beforeEach, describe, expect, it } from "vitest";

import { bundledGroundCovers } from "./bundled";
import { hashSeed } from "./daily";
import {
  GROUND_DAILY_KEY,
  dailyGroundOrder,
  groundDailyShare,
  groundDaySeed,
  loadGroundDay,
  loadGroundDays,
  parseGroundDay,
  rememberGroundDay,
} from "./groundDaily";
import { BEST_GROUND_KEY, dealGround, type GroundMap, type GroundResult } from "./onTheGround";

const COVERS: GroundMap = {
  b1: "Built-up",
  b2: "Built-up",
  b3: "Built-up",
  t1: "Tree cover",
  t2: "Tree cover",
  g1: "Grassland",
  g2: "Grassland",
  w1: "Permanent water bodies",
  s1: "Bare / sparse vegetation",
};

const call = (
  id: string,
  picked: GroundResult["picked"],
  truth: GroundResult["truth"],
  atlas: GroundResult["atlas"],
): GroundResult => ({ id, picked, truth, correct: picked === truth, atlas });

beforeEach(() => localStorage.clear());

describe("dailyGroundOrder", () => {
  it("deals the same five photos to everyone on a day, and others the next day", () => {
    const today = dailyGroundOrder(COVERS, "2026-11-19");
    expect(today).toHaveLength(5);
    expect(dailyGroundOrder({ ...COVERS }, "2026-11-19")).toEqual(today);
    const week = ["20", "21", "22", "23", "24"].map((d) =>
      dailyGroundOrder(COVERS, `2026-11-${d}`),
    );
    expect(week.some((order) => order.join() !== today.join())).toBe(true);
  });

  it("is the free games' even deal on the day's own seed", () => {
    expect(dailyGroundOrder(COVERS, "2026-11-19")).toEqual(
      dealGround(COVERS, hashSeed("whereabout:on-the-ground:2026-11-19")),
    );
    expect(groundDaySeed("2026-11-19")).not.toBe(hashSeed("whereabout:which-climate:2026-11-19"));
    expect(groundDaySeed("2026-11-19")).not.toBe(hashSeed("whereabout:2026-11-19"));
  });

  it("deals five different bundled photos with a land cover each", () => {
    const order = dailyGroundOrder(bundledGroundCovers, "2026-11-19");
    expect(order).toHaveLength(5);
    expect(new Set(order).size).toBe(5);
    for (const id of order) expect(bundledGroundCovers[id]).toBeDefined();
  });
});

describe("the kept days", () => {
  const two = [
    call("b1", "Built-up", "Built-up", "Built-up"),
    call("s1", "Grassland", "Bare / sparse vegetation", null),
  ];

  it("keep each day's calls under the game's own key, apart from the free games' best", () => {
    expect(loadGroundDay("2026-11-19")).toBeNull();
    rememberGroundDay("2026-11-19", two);
    expect(loadGroundDay("2026-11-19")).toEqual({ results: two });
    expect(loadGroundDay("2026-11-18")).toBeNull();
    expect(Object.keys(JSON.parse(localStorage.getItem(GROUND_DAILY_KEY)!))).toEqual([
      "2026-11-19",
    ]);
    expect(localStorage.getItem(BEST_GROUND_KEY)).toBeNull();
  });

  it("work out whether a call was right from the covers, never from what was stored", () => {
    localStorage.setItem(
      GROUND_DAILY_KEY,
      JSON.stringify({
        "2026-11-19": {
          results: [
            { id: "g1", picked: "Built-up", truth: "Grassland", correct: true, atlas: null },
          ],
        },
      }),
    );
    expect(loadGroundDay("2026-11-19")!.results[0].correct).toBe(false);
  });

  it("skip a day in any other shape", () => {
    const bad = [
      null,
      { results: "b1" },
      { results: [{ id: "b1", picked: "Cropland", truth: "Built-up", atlas: null }] },
      { results: [{ id: "b1", picked: "Built-up", truth: "Built-up" }] },
      { results: [{ id: "", picked: "Built-up", truth: "Built-up", atlas: null }] },
      { results: [{ id: "b1", picked: "Built-up", truth: "Built-up", atlas: "Snow and ice" }] },
      { results: [two[0], two[0]] },
      {
        results: Array.from({ length: 6 }, (_, i) => call(`x${i}`, "Grassland", "Grassland", null)),
      },
    ];
    for (const value of bad) expect(parseGroundDay(value)).toBeNull();
    localStorage.setItem(
      GROUND_DAILY_KEY,
      JSON.stringify({
        "2026-11-19": bad[2],
        "not a day": { results: two },
        "2026-11-18": { results: two },
      }),
    );
    expect(Object.keys(loadGroundDays())).toEqual(["2026-11-18"]);
  });

  it("survive storage that can't be read", () => {
    localStorage.setItem(GROUND_DAILY_KEY, "{not json");
    expect(loadGroundDays()).toEqual({});
  });
});

describe("groundDailyShare", () => {
  const href = "https://example.org/whereabout/on-the-ground/daily?x=1#y";

  it("is the score, a square a photo and Atlas's tally, naming no photo, place or cover", () => {
    const results = [
      call("b1", "Built-up", "Built-up", "Built-up"),
      call("t1", "Tree cover", "Tree cover", "Built-up"),
      call("g1", "Tree cover", "Grassland", "Grassland"),
      call("w1", "Permanent water bodies", "Permanent water bodies", "Permanent water bodies"),
      call("s1", "Grassland", "Bare / sparse vegetation", "Built-up"),
    ];
    const text = groundDailyShare("2026-11-19", results, href);
    expect(text).toBe(
      [
        "Whereabout · What's on the ground? · 2026-11-19",
        "🌱 3 of 5",
        "🟩🟩🟥🟩🟥",
        "Atlas: 3 of 5",
        "https://example.org/whereabout/on-the-ground/daily",
      ].join("\n"),
    );
    for (const word of ["b1", "Built-up", "Grassland", "water", "Bare"]) {
      expect(text).not.toContain(word);
    }
  });

  it("says how many photos Atlas gave no read on, and leaves Atlas out when it read none", () => {
    const some = [
      call("b1", "Built-up", "Built-up", "Built-up"),
      call("t1", "Tree cover", "Tree cover", null),
      call("g1", "Grassland", "Grassland", null),
    ];
    expect(groundDailyShare("2026-11-19", some, href)).toContain(
      "\nAtlas: 1 of 1 (no read on 2)\n",
    );
    const none = [call("t1", "Tree cover", "Tree cover", null)];
    expect(groundDailyShare("2026-11-19", none, href)).not.toContain("Atlas");
  });
});
