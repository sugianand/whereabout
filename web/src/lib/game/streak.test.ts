import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BEST_STREAK_KEY,
  initialStreak,
  loadBestStreak,
  rememberStreak,
  runOver,
  streakReducer,
  type StreakAction,
  type StreakState,
} from "./streak";

const PARIS = { lng: 2.35, lat: 48.86 };
const SEA = { lng: -30, lat: 30 };

function play(actions: StreakAction[], from: StreakState = initialStreak): StreakState {
  return actions.reduce(streakReducer, from);
}

const start: StreakAction = { type: "start", order: ["a", "b", "c"] };
const pickFrance: StreakAction = { type: "picked", pick: { at: PARIS, country: "FR" } };

describe("streakReducer", () => {
  it("starts on the first photo with no streak and no pick", () => {
    expect(play([start])).toEqual({
      phase: "guessing",
      order: ["a", "b", "c"],
      index: 0,
      streak: 0,
      pick: null,
    });
  });

  it("counts a right country and moves on to the next photo", () => {
    const s = play([start, pickFrance, { type: "answered", truth: "FR" }]);
    expect(s).toMatchObject({ phase: "answered", streak: 1, answer: { correct: true } });
    expect(runOver(s)).toBe(false);
    expect(play([{ type: "next" }], s)).toMatchObject({
      phase: "guessing",
      index: 1,
      streak: 1,
      pick: null,
    });
  });

  it("ends the run on the first miss, keeping the streak so far", () => {
    const s = play([
      start,
      pickFrance,
      { type: "answered", truth: "FR" },
      { type: "next" },
      pickFrance,
      { type: "answered", truth: "ES" },
    ]);
    expect(s).toMatchObject({
      phase: "answered",
      index: 1,
      streak: 1,
      answer: { truth: "ES", guess: "FR", correct: false },
    });
    expect(runOver(s)).toBe(true);
    // Nothing plays on after a miss until a new run starts.
    expect(play([{ type: "next" }], s)).toBe(s);
    expect(play([start], s)).toMatchObject({ phase: "guessing", index: 0, streak: 0 });
  });

  it("does not count a tap on the sea as a guess", () => {
    const s = play([start, { type: "picked", pick: { at: SEA, country: null } }]);
    expect(play([{ type: "answered", truth: "FR" }], s)).toBe(s);
    expect(play([{ type: "answered", truth: "FR" }], play([start]))).toMatchObject({
      phase: "guessing",
      pick: null,
    });
  });

  it("lets the player change their pick before answering, but not after", () => {
    const s = play([start, { type: "picked", pick: { at: SEA, country: null } }, pickFrance]);
    expect(s).toMatchObject({ pick: { country: "FR" } });
    const answered = play([{ type: "answered", truth: "FR" }], s);
    expect(play([{ type: "picked", pick: { at: SEA, country: null } }], answered)).toBe(answered);
  });

  it("clears the run after naming every photo", () => {
    let s = play([start]);
    for (let i = 0; i < 3; i++) {
      s = play([pickFrance, { type: "answered", truth: "FR" }, { type: "next" }], s);
    }
    expect(s).toEqual({ phase: "cleared", order: ["a", "b", "c"], streak: 3 });
    expect(runOver(s)).toBe(true);
  });

  it("has nothing to deal from an empty deck", () => {
    expect(play([{ type: "start", order: [] }])).toEqual({ phase: "cleared", order: [], streak: 0 });
  });
});

describe("best streak", () => {
  beforeEach(() => localStorage.clear());

  it("starts at zero and keeps only a better streak", () => {
    expect(loadBestStreak()).toBe(0);
    expect(rememberStreak(3)).toBe(3);
    expect(rememberStreak(2)).toBe(3);
    expect(localStorage.getItem(BEST_STREAK_KEY)).toBe("3");
    expect(rememberStreak(5)).toBe(5);
    expect(loadBestStreak()).toBe(5);
  });

  it("ignores junk in storage", () => {
    localStorage.setItem(BEST_STREAK_KEY, "lots");
    expect(loadBestStreak()).toBe(0);
    localStorage.setItem(BEST_STREAK_KEY, "-4");
    expect(loadBestStreak()).toBe(0);
  });

  it("still counts the streak when storage throws", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadBestStreak()).toBe(0);
    expect(rememberStreak(4)).toBe(4);
    get.mockRestore();
    set.mockRestore();
  });
});
