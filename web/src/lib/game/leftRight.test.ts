import { afterEach, describe, expect, it } from "vitest";

import { atlasDrivingSide } from "@/lib/trueClues";

import {
  BEST_LEFT_RIGHT_KEY,
  atlasLine,
  initialLeftRight,
  leftRightOrder,
  leftRightOver,
  leftRightReducer,
  loadBestLeftRight,
  rememberLeftRight,
  truthLine,
  type LeftRightState,
  type SideMap,
} from "./leftRight";

function sideMap(left: number, right: number): SideMap {
  const out: Record<string, "left" | "right"> = {};
  for (let i = 0; i < left; i++) out[`l${i}`] = "left";
  for (let i = 0; i < right; i++) out[`r${i}`] = "right";
  return out;
}

describe("leftRightOrder", () => {
  it("deals each photo at most once, and stops when either side runs out", () => {
    const sides = sideMap(5, 40);
    for (const seed of [0, 1, 7, 123456, 2 ** 32 - 1]) {
      const order = leftRightOrder(sides, seed);
      expect(new Set(order).size).toBe(order.length);
      const lefts = order.filter((id) => sides[id] === "left").length;
      const rights = order.length - lefts;
      // The run ends on the draw that empties a pile, so one pile is always used up.
      expect(lefts === 5 || rights === 40).toBe(true);
      expect(lefts).toBeLessThanOrEqual(5);
    }
  });

  it("is pure in the seed, and different seeds deal different runs", () => {
    const sides = sideMap(30, 90);
    expect(leftRightOrder(sides, 42)).toEqual(leftRightOrder(sides, 42));
    expect(leftRightOrder(sides, 42)).not.toEqual(leftRightOrder(sides, 43));
  });

  it("deals the two sides evenly however lopsided the catalog is", () => {
    // Three in four photos are right-hand traffic, as in the catalog.
    const sides = sideMap(100, 300);
    let lefts = 0;
    let dealt = 0;
    for (let seed = 0; seed < 200; seed++) {
      // Only the first 40 calls: past them a long run is rare, and evenness is what matters.
      const head = leftRightOrder(sides, seed).slice(0, 40);
      lefts += head.filter((id) => sides[id] === "left").length;
      dealt += head.length;
    }
    expect(lefts / dealt).toBeGreaterThan(0.47);
    expect(lefts / dealt).toBeLessThan(0.53);
  });

  it("deals nothing when one side has no photos", () => {
    expect(leftRightOrder(sideMap(0, 10), 1)).toEqual([]);
    expect(leftRightOrder({}, 1)).toEqual([]);
  });
});

describe("leftRightReducer", () => {
  const start = (order: string[]) => leftRightReducer(initialLeftRight, { type: "start", order });

  it("counts right calls and plays on, and ends on the first wrong one", () => {
    let s: LeftRightState = start(["a", "b", "c"]);
    expect(s.phase).toBe("picking");
    s = leftRightReducer(s, {
      type: "picked",
      side: "left",
      truth: "left",
      atlas: { side: "right", from: "clue" },
    });
    expect(s.phase).toBe("answered");
    if (s.phase !== "answered") throw new Error("not answered");
    expect(s.verdict).toEqual({ picked: "left", truth: "left", correct: true });
    expect(s.atlas?.correct).toBe(false);
    expect([s.streak, s.atlasRight, s.atlasPlayed]).toEqual([1, 0, 1]);
    expect(leftRightOver(s)).toBe(false);

    s = leftRightReducer(s, { type: "next" });
    expect(s.phase === "picking" && s.index).toBe(1);
    // A pick while answered, or a second pick, changes nothing.
    s = leftRightReducer(s, { type: "picked", side: "left", truth: "right", atlas: null });
    const after = leftRightReducer(s, {
      type: "picked",
      side: "right",
      truth: "right",
      atlas: null,
    });
    expect(after).toBe(s);
    expect(leftRightOver(s)).toBe(true);
    if (s.phase !== "answered") throw new Error("not answered");
    expect([s.streak, s.atlasPlayed]).toEqual([1, 1]);
    // A wrong call never moves on: only a new start does.
    expect(leftRightReducer(s, { type: "next" })).toBe(s);
  });

  it("clears the run after the last photo dealt", () => {
    let s: LeftRightState = start(["a"]);
    s = leftRightReducer(s, { type: "picked", side: "right", truth: "right", atlas: null });
    s = leftRightReducer(s, { type: "next" });
    expect(s.phase).toBe("cleared");
    expect(leftRightOver(s)).toBe(true);
    expect(start([]).phase).toBe("cleared");
  });
});

describe("the words", () => {
  it("names the country mid-sentence with its article", () => {
    expect(truthLine("JP", "left")).toBe("In Japan they drive on the left.");
    expect(truthLine("US", "right")).toBe("In the United States they drive on the right.");
  });

  it("says what Atlas read and where it came from", () => {
    expect(
      atlasLine({
        read: { side: "left", from: "clue" },
        picked: "left",
        truth: "left",
        correct: true,
      }),
    ).toBe("Atlas read the left from the photo, and got it.");
    expect(
      atlasLine({
        read: { side: "right", from: "pick", country: "BR" },
        picked: "right",
        truth: "left",
        correct: false,
      }),
    ).toBe("Atlas picked Brazil, where they drive on the right: wrong.");
  });
});

describe("atlasDrivingSide", () => {
  it("takes the clue head's side first, then its top country's", () => {
    expect(
      atlasDrivingSide({
        clues: [{ label: "Drives on the left", p: 0.8 }],
        topCountries: [{ country: "BR", p: 0.9 }],
      }),
    ).toEqual({ side: "left", from: "clue" });
    expect(
      atlasDrivingSide({
        clues: [{ label: "Tropical climate", p: 0.8 }],
        topCountries: [
          { country: "BR", p: 0.2 },
          { country: "JP", p: 0.6 },
        ],
      }),
    ).toEqual({ side: "left", from: "pick", country: "JP" });
  });

  it("says nothing without a guess or a side to read", () => {
    expect(atlasDrivingSide(null)).toBeNull();
    expect(atlasDrivingSide({ clues: [], topCountries: [] })).toBeNull();
  });
});

describe("the best", () => {
  afterEach(() => localStorage.clear());

  it("keeps the longest run and refuses junk", () => {
    expect(loadBestLeftRight()).toBe(0);
    expect(rememberLeftRight(3)).toBe(3);
    expect(rememberLeftRight(2)).toBe(3);
    expect(loadBestLeftRight()).toBe(3);
    localStorage.setItem(BEST_LEFT_RIGHT_KEY, "-4");
    expect(loadBestLeftRight()).toBe(0);
    localStorage.setItem(BEST_LEFT_RIGHT_KEY, "{");
    expect(loadBestLeftRight()).toBe(0);
  });
});
