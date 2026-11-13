import { beforeEach, describe, expect, it } from "vitest";

import { rememberClimateDay } from "./climateDaily";
import type { DailyRun } from "./dailyRuns";
import { NORTH_DAILY_KEY } from "./northDaily";
import { ODD_DAILY_KEY } from "./oddDaily";
import {
  CLUE_GAMES,
  PICK_GAMES,
  RECORD_GAMES,
  EMPTY_TALLY,
  QUICK_RECORD_KEY,
  addRound,
  dailyTally,
  loadFreeTallies,
  loadQuickRecord,
  parseTally,
  percent,
  recordFreeRound,
  rightOf,
  standing,
  standingLine,
  type Tally,
} from "./quickRecord";
import { SIDE_DAILY_KEY } from "./sideDaily";

const tally = (over: Partial<Tally>): Tally => ({ ...EMPTY_TALLY, ...over });
const day = (over: Partial<DailyRun>): DailyRun => ({
  streak: 0,
  atlasRight: 0,
  atlasPlayed: 0,
  ended: null,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
});

describe("addRound", () => {
  it("counts the round, a new run on the first, and Atlas only when it played", () => {
    let t = addRound(EMPTY_TALLY, { first: true, correct: true, atlas: false });
    t = addRound(t, { first: false, correct: true, atlas: null });
    t = addRound(t, { first: false, correct: false, atlas: true });
    expect(t).toEqual({ runs: 1, rounds: 3, right: 2, atlasPlayed: 2, atlasRight: 1 });
  });
});

describe("recordFreeRound", () => {
  it("keeps each game's tally apart, across reads", () => {
    recordFreeRound("further-north", { first: true, correct: true, atlas: true });
    recordFreeRound("further-north", { first: false, correct: false, atlas: false });
    recordFreeRound("odd-one-out", { first: true, correct: false, atlas: null });
    recordFreeRound("which-climate", { first: true, correct: true, atlas: false });
    expect(loadFreeTallies()).toEqual({
      "further-north": { runs: 1, rounds: 2, right: 1, atlasPlayed: 2, atlasRight: 1 },
      "odd-one-out": { runs: 1, rounds: 1, right: 0, atlasPlayed: 0, atlasRight: 0 },
      "left-right": EMPTY_TALLY,
      "which-climate": { runs: 1, rounds: 1, right: 1, atlasPlayed: 1, atlasRight: 0 },
    });
  });

  it("starts again from nothing over junk storage, and keeps the other game's tally", () => {
    localStorage.setItem(QUICK_RECORD_KEY, "{oops");
    expect(loadFreeTallies()["further-north"]).toEqual(EMPTY_TALLY);
    localStorage.setItem(
      QUICK_RECORD_KEY,
      JSON.stringify({
        "further-north": { runs: 1, rounds: 2, right: 5, atlasPlayed: 0, atlasRight: 0 },
        "odd-one-out": { runs: 1, rounds: 2, right: 1, atlasPlayed: 1, atlasRight: 1 },
      }),
    );
    const t = recordFreeRound("further-north", { first: true, correct: true, atlas: null });
    expect(t).toEqual({ runs: 1, rounds: 1, right: 1, atlasPlayed: 0, atlasRight: 0 });
    expect(loadFreeTallies()["odd-one-out"].rounds).toBe(2);
  });
});

describe("parseTally", () => {
  it("reads back only a consistent tally", () => {
    const ok = { runs: 2, rounds: 5, right: 3, atlasPlayed: 4, atlasRight: 2 };
    expect(parseTally(ok)).toEqual(ok);
    expect(parseTally({ ...ok, right: 6 })).toBeNull();
    expect(parseTally({ ...ok, atlasRight: 5 })).toBeNull();
    expect(parseTally({ ...ok, atlasPlayed: 6, atlasRight: 0 })).toBeNull();
    expect(parseTally({ ...ok, runs: 6 })).toBeNull();
    expect(parseTally({ ...ok, rounds: 5.5 })).toBeNull();
    expect(parseTally({ ...ok, runs: -1 })).toBeNull();
    expect(parseTally("5")).toBeNull();
    expect(parseTally(null)).toBeNull();
  });
});

describe("dailyTally", () => {
  it("counts a miss as one more round answered, and skips days with nothing answered", () => {
    expect(
      dailyTally({
        "2026-10-29": day({ streak: 4, atlasRight: 3, atlasPlayed: 5, ended: "miss" }),
        "2026-10-30": day({ streak: 2, atlasRight: 2, atlasPlayed: 2, ended: "cleared" }),
        "2026-10-31": day({}),
      }),
    ).toEqual({ runs: 2, rounds: 7, right: 6, atlasPlayed: 7, atlasRight: 5 });
  });
});

describe("loadQuickRecord", () => {
  it("adds today's runs kept per day to the free runs, per game", () => {
    recordFreeRound("further-north", { first: true, correct: false, atlas: true });
    localStorage.setItem(
      NORTH_DAILY_KEY,
      JSON.stringify({ "2026-10-31": day({ streak: 3, atlasRight: 1, atlasPlayed: 3 }) }),
    );
    localStorage.setItem(
      ODD_DAILY_KEY,
      JSON.stringify({ "2026-10-30": day({ streak: 0, ended: "miss", atlasPlayed: 1 }) }),
    );
    const record = loadQuickRecord();
    expect(record["further-north"].free.rounds).toBe(1);
    expect(record["further-north"].daily).toEqual({
      runs: 1,
      rounds: 3,
      right: 3,
      atlasPlayed: 3,
      atlasRight: 1,
    });
    expect(record["further-north"].total).toEqual({
      runs: 2,
      rounds: 4,
      right: 3,
      atlasPlayed: 4,
      atlasRight: 2,
    });
    expect(record["odd-one-out"].total).toEqual({
      runs: 1,
      rounds: 1,
      right: 0,
      atlasPlayed: 1,
      atlasRight: 0,
    });
  });

  it("counts today's Left or right? runs in the road's record", () => {
    recordFreeRound("left-right", { first: true, correct: false, atlas: null });
    localStorage.setItem(
      SIDE_DAILY_KEY,
      JSON.stringify({
        "2026-11-12": day({ streak: 3, atlasRight: 2, atlasPlayed: 3, ended: "miss" }),
        "2026-11-13": day({ streak: 2, atlasRight: 1, atlasPlayed: 1 }),
      }),
    );
    const record = loadQuickRecord();
    expect(record["left-right"].daily).toEqual({
      runs: 2,
      rounds: 6,
      right: 5,
      atlasPlayed: 4,
      atlasRight: 3,
    });
    expect(record["left-right"].total).toEqual({
      runs: 3,
      rounds: 7,
      right: 5,
      atlasPlayed: 4,
      atlasRight: 3,
    });
  });

  it("counts today's Which climate? games call by call in the climate's record", () => {
    recordFreeRound("which-climate", { first: true, correct: true, atlas: true });
    rememberClimateDay("2026-11-13", [
      { id: "a", picked: "Arid", truth: "Arid", correct: true, atlas: "Arid" },
      { id: "b", picked: "Polar", truth: "Continental", correct: false, atlas: null },
      { id: "c", picked: "Tropical", truth: "Tropical", correct: true, atlas: "Temperate" },
    ]);
    rememberClimateDay("2026-11-14", []);
    const record = loadQuickRecord();
    expect(record["which-climate"].daily).toEqual({
      runs: 1,
      rounds: 3,
      right: 2,
      atlasPlayed: 2,
      atlasRight: 1,
    });
    expect(record["which-climate"].total).toMatchObject({ runs: 2, rounds: 4, right: 3 });
  });

  it("is empty in a fresh browser", () => {
    const record = loadQuickRecord();
    for (const game of RECORD_GAMES) expect(record[game].total).toEqual(EMPTY_TALLY);
  });

  it("splits the games into the clue games and the picking games, each listed once", () => {
    expect([...PICK_GAMES, ...CLUE_GAMES].sort()).toEqual([...RECORD_GAMES].sort());
    expect(CLUE_GAMES).toEqual(["left-right", "which-climate"]);
  });
});

describe("standing", () => {
  it("compares each side's rate over its own rounds", () => {
    expect(percent(2, 3)).toBe(67);
    expect(percent(0, 0)).toBeNull();
    const t = tally({ rounds: 10, right: 8, atlasPlayed: 8, atlasRight: 5 });
    expect(standing(t)).toEqual({ you: 80, atlas: 63, lead: "you", gap: 17 });
    expect(standingLine(t)).toBe("You're ahead of Atlas by 17 points.");
  });

  it("says when Atlas leads, when it's level and when Atlas hasn't played", () => {
    expect(standingLine(tally({ rounds: 4, right: 1, atlasPlayed: 4, atlasRight: 2 }))).toBe(
      "Atlas is ahead of you by 25 points.",
    );
    expect(standingLine(tally({ rounds: 4, right: 2, atlasPlayed: 2, atlasRight: 1 }))).toBe(
      "You and Atlas are level.",
    );
    expect(standingLine(tally({ rounds: 100, right: 51, atlasPlayed: 100, atlasRight: 50 }))).toBe(
      "You're ahead of Atlas by 1 point.",
    );
    expect(standingLine(tally({ rounds: 2, right: 1 }))).toBe(
      "Atlas hasn't played a round with you yet.",
    );
    expect(standingLine(EMPTY_TALLY)).toBe("No rounds played yet.");
    expect(standing(tally({ rounds: 2, right: 1 })).lead).toBeNull();
  });

  it("reads counts in words", () => {
    expect(rightOf(1, 1)).toBe("1 of 1 round right");
    expect(rightOf(1200, 1500)).toBe("1,200 of 1,500 rounds right");
    expect(rightOf(3, 1, "photo")).toBe("3 of 1 photo right");
    expect(rightOf(4, 5, "photo")).toBe("4 of 5 photos right");
    expect(standingLine(EMPTY_TALLY, "photo")).toBe("No photos played yet.");
    expect(standingLine(tally({ rounds: 2, right: 1 }), "photo")).toBe(
      "Atlas hasn't played a photo with you yet.",
    );
  });
});
