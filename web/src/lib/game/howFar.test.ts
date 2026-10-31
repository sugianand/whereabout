import { beforeEach, describe, expect, it } from "vitest";

import { haversineKm, type LngLat } from "@/lib/geo";

import {
  BEST_HOW_FAR_KEY,
  MAX_KM,
  MIN_KM,
  PAIRS,
  PAIR_POINTS,
  SLIDER_STEPS,
  atlasTotal,
  clampKm,
  continentLookup,
  dealPairs,
  describeEstimate,
  howFarReducer,
  initialHowFar,
  judgeEstimate,
  kmToStep,
  loadBestHowFar,
  rememberHowFar,
  scalePosition,
  scoreRatio,
  stepToKm,
  timesOff,
  totalPoints,
  type HowFarAction,
  type HowFarState,
} from "./howFar";

const PARIS: LngLat = { lat: 48.8566, lng: 2.3522 };
const LONDON: LngLat = { lat: 51.5072, lng: -0.1276 };
const TOKYO: LngLat = { lat: 35.6762, lng: 139.6503 };

describe("the log-scale slider", () => {
  it("runs from MIN_KM to MAX_KM", () => {
    expect(stepToKm(0)).toBeCloseTo(MIN_KM, 9);
    expect(stepToKm(SLIDER_STEPS)).toBeCloseTo(MAX_KM, 6);
    // Halfway along is the geometric mean, not the arithmetic one.
    expect(stepToKm(SLIDER_STEPS / 2)).toBeCloseTo(Math.sqrt(MIN_KM * MAX_KM), 6);
  });

  it("clamps steps and distances outside the range", () => {
    expect(stepToKm(-5)).toBeCloseTo(MIN_KM, 9);
    expect(stepToKm(SLIDER_STEPS + 5)).toBeCloseTo(MAX_KM, 6);
    expect(clampKm(0)).toBe(MIN_KM);
    expect(clampKm(20_015)).toBe(MAX_KM);
    expect(clampKm(Number.NaN)).toBe(MAX_KM);
  });

  it("round-trips every step through kilometres", () => {
    for (let step = 0; step <= SLIDER_STEPS; step++) expect(kmToStep(stepToKm(step))).toBe(step);
  });

  it("places distances along the scale", () => {
    expect(scalePosition(MIN_KM)).toBe(0);
    expect(scalePosition(MAX_KM)).toBe(1);
    expect(scalePosition(1)).toBe(0);
    expect(scalePosition(Math.sqrt(MIN_KM * MAX_KM))).toBeCloseTo(0.5, 9);
  });
});

describe("scoring by how many times off", () => {
  it("is symmetric: twice too far is as far off as twice too close", () => {
    expect(timesOff(200, 100)).toBe(2);
    expect(timesOff(50, 100)).toBe(2);
    expect(timesOff(2000, 1000)).toBe(timesOff(200, 100));
  });

  it("measures on clamped distances, so two photos in one town are MIN_KM apart", () => {
    expect(timesOff(MIN_KM, 0.3)).toBe(1);
    expect(timesOff(20, 0.3)).toBe(2);
    expect(timesOff(MAX_KM, 20_010)).toBe(1);
  });

  it("gives every point when exact, two thirds at 2× and none from 10×", () => {
    expect(scoreRatio(1)).toBe(PAIR_POINTS);
    expect(scoreRatio(2)).toBe(699);
    expect(scoreRatio(10)).toBe(0);
    expect(scoreRatio(50)).toBe(0);
    expect(() => scoreRatio(0.5)).toThrow(RangeError);
  });

  it("never scores a worse estimate higher", () => {
    let last = Infinity;
    for (let r = 1; r < 12; r += 0.05) {
      const points = scoreRatio(r);
      expect(points).toBeLessThanOrEqual(last);
      last = points;
    }
  });

  it("says how far off and which way", () => {
    expect(describeEstimate(judgeEstimate(105, 100))).toBe("Spot on");
    expect(describeEstimate(judgeEstimate(95, 100))).toBe("Spot on");
    expect(describeEstimate(judgeEstimate(169, 100))).toBe("1.6× too far");
    expect(describeEstimate(judgeEstimate(50, 100))).toBe("2.0× too close");
    expect(describeEstimate(judgeEstimate(10, 1290))).toBe("129× too close");
  });
});

describe("dealPairs", () => {
  it("deals up to five pairs of different photos, in order", () => {
    const order = Array.from({ length: 13 }, (_, i) => `p${i}`);
    const pairs = dealPairs(order);
    expect(pairs).toHaveLength(PAIRS);
    expect(pairs[0]).toEqual(["p0", "p1"]);
    expect(new Set(pairs.flat()).size).toBe(PAIRS * 2);
  });

  it("deals what a small deck can and never a photo with itself", () => {
    expect(dealPairs(["a", "b", "c"])).toEqual([["a", "b"]]);
    expect(dealPairs(["a"])).toEqual([]);
  });

  it("mixes near and far: same-continent pairs first, third and fifth, mixed ones between", () => {
    const regions = {
      Europe: ["e1", "e2", "e3", "e4", "e5"],
      Asia: ["a1", "a2", "a3", "a4", "a5"],
    };
    const order = ["e1", "a1", "e2", "a2", "e3", "a3", "e4", "a4", "e5", "a5", "x1"];
    const of = continentLookup(regions);
    const pairs = dealPairs(order, of);
    expect(pairs).toEqual([
      ["e1", "e2"],
      ["a1", "e3"],
      ["a2", "a3"],
      ["e4", "a4"],
      ["e5", "a5"],
    ]);
    expect(new Set(pairs.flat()).size).toBe(10);
  });

  it("falls back on the next photo when no photo of the right kind is left", () => {
    const of = continentLookup({ Europe: ["e1", "e2"] });
    expect(dealPairs(["e1", "e2"], of)).toEqual([["e1", "e2"]]);
    expect(dealPairs(["x1", "e1", "x2"], of)).toEqual([["x1", "e1"]]);
  });
});

const estimated = (
  km: number,
  a: LngLat,
  b: LngLat,
  atlasA: LngLat | null = a,
  atlasB: LngLat | null = b,
): HowFarAction => ({ type: "estimated", km, a, b, atlasA, atlasB });

describe("howFarReducer", () => {
  const pairs = dealPairs(["a", "b", "c", "d"]);

  it("plays every pair, then finishes", () => {
    let s: HowFarState = howFarReducer(initialHowFar, { type: "start", pairs });
    expect(s).toMatchObject({ phase: "setting", index: 0 });
    s = howFarReducer(s, estimated(340, PARIS, LONDON));
    expect(s.phase).toBe("answered");
    s = howFarReducer(s, { type: "next" });
    expect(s).toMatchObject({ phase: "setting", index: 1 });
    s = howFarReducer(s, estimated(9000, PARIS, TOKYO));
    s = howFarReducer(s, { type: "next" });
    expect(s.phase).toBe("finished");
    if (s.phase !== "finished") throw new Error();
    expect(s.results).toHaveLength(2);
  });

  it("judges the estimate against the great-circle distance between the photos", () => {
    let s = howFarReducer(initialHowFar, { type: "start", pairs });
    s = howFarReducer(s, estimated(340, PARIS, LONDON, PARIS, TOKYO));
    if (s.phase !== "answered") throw new Error();
    const [r] = s.results;
    expect(r.actualKm).toBeCloseTo(haversineKm(PARIS, LONDON), 9);
    expect(r.you).toEqual(judgeEstimate(340, r.actualKm));
    // Atlas's estimate is the distance between its own two guesses.
    expect(r.atlas!.km).toBeCloseTo(haversineKm(PARIS, TOKYO), 9);
    expect(r.atlas!.tooFar).toBe(true);
  });

  it("leaves Atlas out of a pair it hasn't guessed both photos of", () => {
    let s = howFarReducer(initialHowFar, { type: "start", pairs });
    s = howFarReducer(s, estimated(340, PARIS, LONDON, null, LONDON));
    if (s.phase !== "answered") throw new Error();
    expect(s.results[0].atlas).toBeNull();
    expect(atlasTotal(s.results)).toEqual({ points: 0, played: 0 });
  });

  it("ignores an estimate once answered and a next while setting", () => {
    let s = howFarReducer(initialHowFar, { type: "start", pairs });
    expect(howFarReducer(s, { type: "next" })).toBe(s);
    s = howFarReducer(s, estimated(340, PARIS, LONDON));
    expect(howFarReducer(s, estimated(1, PARIS, LONDON))).toBe(s);
    expect(howFarReducer(initialHowFar, { type: "next" })).toBe(initialHowFar);
  });

  it("finishes at once with no pairs to deal", () => {
    expect(howFarReducer(initialHowFar, { type: "start", pairs: [] }).phase).toBe("finished");
  });

  it("adds up your points and Atlas's", () => {
    let s = howFarReducer(initialHowFar, { type: "start", pairs });
    s = howFarReducer(s, estimated(340, PARIS, LONDON));
    s = howFarReducer(s, { type: "next" });
    s = howFarReducer(s, estimated(100, PARIS, TOKYO, null, null));
    if (s.phase !== "answered") throw new Error();
    expect(totalPoints(s.results)).toBe(s.results[0].you.points + s.results[1].you.points);
    // Atlas guessed both photos exactly in the first pair, so it was spot on there.
    expect(atlasTotal(s.results)).toEqual({ points: PAIR_POINTS, played: 1 });
  });
});

describe("the best game", () => {
  beforeEach(() => localStorage.clear());

  it("keeps a higher total and refuses a lower one", () => {
    expect(loadBestHowFar()).toBe(0);
    expect(rememberHowFar(3120)).toBe(3120);
    expect(localStorage.getItem(BEST_HOW_FAR_KEY)).toBe("3120");
    expect(rememberHowFar(2000)).toBe(3120);
    expect(loadBestHowFar()).toBe(3120);
  });

  it("refuses what no game can score", () => {
    for (const bad of ["-4", "5001", "2.5", '"3000"', "{", "null"]) {
      localStorage.setItem(BEST_HOW_FAR_KEY, bad);
      expect(loadBestHowFar()).toBe(0);
    }
  });
});
