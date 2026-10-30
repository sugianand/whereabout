import { beforeEach, describe, expect, it } from "vitest";

import {
  BEST_NORTH_KEY,
  TIE_DEGREES,
  formatLatitude,
  initialNorth,
  judgeNorth,
  loadBestNorth,
  northOver,
  northReducer,
  northSouthKm,
  rememberNorth,
  type NorthAction,
  type NorthState,
} from "./furtherNorth";

const pick = (
  side: "a" | "b",
  latA: number,
  latB: number,
  atlasA: number | null = null,
  atlasB: number | null = null,
): NorthAction => ({ type: "picked", side, latA, latB, atlasA, atlasB });

const run = (state: NorthState, ...actions: NorthAction[]) => actions.reduce(northReducer, state);

describe("judgeNorth", () => {
  it("is right when the picked photo lies further north", () => {
    expect(judgeNorth("a", 59.6, 5.2)).toMatchObject({ north: "a", correct: true, tie: false });
    expect(judgeNorth("b", 59.6, 5.2)).toMatchObject({ north: "a", correct: false, tie: false });
    // South of the Equator, further north means the smaller southern latitude.
    expect(judgeNorth("b", -33.9, -15.8)).toMatchObject({ north: "b", correct: true });
  });

  it("counts either pick as right when the latitudes are under a degree apart", () => {
    const close = judgeNorth("b", 48.9, 48.9 - TIE_DEGREES + 0.01);
    expect(close).toMatchObject({ north: "a", tie: true, correct: true });
    // Exactly a degree apart is far enough to call.
    expect(judgeNorth("b", 49, 48)).toMatchObject({ tie: false, correct: false });
  });

  it("measures how far apart the photos are north to south", () => {
    // One degree of latitude is about 111 km.
    expect(northSouthKm(10, 11)).toBeCloseTo(111.2, 1);
    expect(judgeNorth("a", 45, -45).apartKm).toBeCloseTo(10007.5, 0);
  });
});

describe("formatLatitude", () => {
  it("reads north, south and the Equator", () => {
    expect(formatLatitude(59.62)).toBe("59.6° N");
    expect(formatLatitude(-33.87)).toBe("33.9° S");
    expect(formatLatitude(0.02)).toBe("0.0°");
    expect(formatLatitude(-0.04)).toBe("0.0°");
  });
});

describe("northReducer", () => {
  const order = ["p1", "p2", "p3", "p4"];

  it("starts on the first pair, or is cleared with fewer than two photos", () => {
    expect(run(initialNorth, { type: "start", order })).toMatchObject({
      phase: "picking",
      index: 0,
      streak: 0,
    });
    expect(run(initialNorth, { type: "start", order: ["p1"] }).phase).toBe("cleared");
  });

  it("keeps the second photo and deals the next after a right pick", () => {
    const answered = run(initialNorth, { type: "start", order }, pick("a", 60, 10));
    expect(answered).toMatchObject({ phase: "answered", streak: 1 });
    const next = northReducer(answered, { type: "next" });
    expect(next).toMatchObject({ phase: "picking", index: 1, streak: 1 });
  });

  it("ends the run on a wrong pick, and next does nothing then", () => {
    const wrong = run(initialNorth, { type: "start", order }, pick("b", 60, 10));
    expect(wrong).toMatchObject({ phase: "answered", streak: 0 });
    expect(northOver(wrong)).toBe(true);
    expect(northReducer(wrong, { type: "next" })).toBe(wrong);
  });

  it("is cleared once the last pair is played right", () => {
    const end = run(
      initialNorth,
      { type: "start", order },
      pick("a", 60, 50),
      { type: "next" },
      pick("a", 50, 40),
      { type: "next" },
      pick("a", 40, 30),
      { type: "next" },
    );
    expect(end).toMatchObject({ phase: "cleared", streak: 3 });
    expect(northOver(end)).toBe(true);
  });

  it("ignores a second pick on the same pair", () => {
    const answered = run(initialNorth, { type: "start", order }, pick("a", 60, 10));
    expect(northReducer(answered, pick("b", 60, 10))).toBe(answered);
  });

  it("judges Atlas by its guesses' latitudes against the true ones", () => {
    // Atlas guessed photo b further north, but photo a really is: Atlas would have missed.
    const missed = run(initialNorth, { type: "start", order }, pick("a", 60, 10, 20, 30));
    expect(missed).toMatchObject({ atlasRight: 0, atlasPlayed: 1 });
    if (missed.phase !== "answered") throw new Error("expected a reveal");
    expect(missed.atlas).toMatchObject({ picked: "b", correct: false });

    const got = run(missed, { type: "next" }, pick("a", 10, 5, 12, 3));
    expect(got).toMatchObject({ atlasRight: 1, atlasPlayed: 2 });
  });

  it("leaves Atlas out of a pair it hasn't guessed both photos of", () => {
    const state = run(initialNorth, { type: "start", order }, pick("a", 60, 10, 50, null));
    expect(state).toMatchObject({ atlasRight: 0, atlasPlayed: 0, atlas: null });
  });
});

describe("the best streak", () => {
  beforeEach(() => localStorage.clear());

  it("is kept only when beaten", () => {
    expect(loadBestNorth()).toBe(0);
    expect(rememberNorth(3)).toBe(3);
    expect(rememberNorth(2)).toBe(3);
    expect(loadBestNorth()).toBe(3);
    expect(rememberNorth(5)).toBe(5);
    expect(localStorage.getItem(BEST_NORTH_KEY)).toBe("5");
  });

  it("reads anything else stored as no best", () => {
    for (const bad of ["-2", "1.5", '"7"', "{", "null"]) {
      localStorage.setItem(BEST_NORTH_KEY, bad);
      expect(loadBestNorth()).toBe(0);
    }
  });
});
