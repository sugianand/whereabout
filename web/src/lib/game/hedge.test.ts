import { afterEach, describe, expect, it } from "vitest";

import { bundledHedgeIds, bundledById } from "./bundled";
import type { GameRecord } from "./deck";
import {
  BEST_HEDGE_KEY,
  CHIPS,
  HEDGE_MAX,
  HEDGE_PHOTOS,
  addChip,
  atlasChips,
  chipWord,
  chipsLeft,
  dealHedge,
  hedgeEndLine,
  hedgeIds,
  hedgeLine,
  hedgeOptions,
  hedgeReducer,
  hedgeResult,
  hedgeScore,
  hedgeTotals,
  initialHedge,
  loadBestHedge,
  rememberHedge,
  takeChip,
  toChips,
  type HedgeResult,
} from "./hedge";

afterEach(() => localStorage.clear());

function record(
  id: string,
  country: string,
  top: [string, number][] | null,
  belief?: Record<string, number>,
): GameRecord {
  return {
    photo: {
      id,
      imageUrl: `https://upload.wikimedia.org/${id}.jpg`,
      lng: 0,
      lat: 0,
      place: id,
      country,
      credit: { author: "A", license: "CC BY 4.0", sourceUrl: "https://c" },
    },
    atlas: top
      ? {
          lng: 0,
          lat: 0,
          confidence: top[0]?.[1] ?? 0,
          topCountries: top.map(([c, p]) => ({ country: c, p })),
          clues: [],
          ...(belief ? { belief } : {}),
        }
      : null,
  };
}

const laos = record("a", "LA", [
  ["LA", 0.6],
  ["VN", 0.2],
  ["TH", 0.1],
  ["KH", 0.05],
  ["MM", 0.05],
]);

describe("hedgeScore: the quadratic rule", () => {
  it("pays 1,000 all in on the right country and 0 all in on a wrong one", () => {
    expect(hedgeScore([10, 0, 0, 0], 0)).toBe(HEDGE_MAX);
    expect(hedgeScore([10, 0, 0, 0], 1)).toBe(0);
  });

  it("pays an even-as-can-be spread close to 625 whichever is right, and 750 for a half on two", () => {
    // 3/3/2/2 is as even as ten whole chips go over four.
    expect(hedgeScore([3, 3, 2, 2], 0)).toBe(670);
    expect(hedgeScore([3, 3, 2, 2], 3)).toBe(570);
    expect(hedgeScore([5, 5, 0, 0], 0)).toBe(750);
    expect(hedgeScore([5, 5, 0, 0], 2)).toBe(250);
  });

  it("is proper: at 60% sure, betting 6 chips beats going all in or hedging flat", () => {
    // Expected points if the first country is right 60% of the time and the second 40%.
    const expected = (chips: number[]) => 0.6 * hedgeScore(chips, 0)! + 0.4 * hedgeScore(chips, 1)!;
    const honest = expected([6, 4, 0, 0]);
    for (const other of [
      [10, 0, 0, 0],
      [8, 2, 0, 0],
      [5, 5, 0, 0],
      [3, 3, 2, 2],
    ]) {
      expect(honest).toBeGreaterThan(expected(other));
    }
  });

  it("refuses a bet with chips unplaced, too many, fractional or negative, or no right option", () => {
    expect(hedgeScore([5, 4, 0, 0], 0)).toBeNull();
    expect(hedgeScore([6, 5, 0, 0], 0)).toBeNull();
    expect(hedgeScore([5.5, 4.5, 0, 0], 0)).toBeNull();
    expect(hedgeScore([11, -1, 0, 0], 0)).toBeNull();
    expect(hedgeScore([10, 0, 0, 0], -1)).toBeNull();
    expect(hedgeScore([10, 0, 0, 0], 4)).toBeNull();
  });
});

describe("toChips", () => {
  it("rounds shares to whole chips by largest remainder, ties to the first", () => {
    expect(toChips([0.6, 0.2, 0.1, 0.1])).toEqual([6, 2, 1, 1]);
    expect(toChips([0.85, 0.12, 0.02, 0.01])).toEqual([9, 1, 0, 0]);
    expect(toChips([1, 1, 1, 1])).toEqual([3, 3, 2, 2]);
    expect(toChips([0.333, 0.333, 0.333, 0])).toEqual([4, 3, 3, 0]);
  });

  it("always places every chip, and splits evenly when the weights are all zero or junk", () => {
    expect(toChips([0, 0, 0, 0])).toEqual([3, 3, 2, 2]);
    expect(toChips([Number.NaN, -1, 0, Infinity])).toEqual([3, 3, 2, 2]);
    for (const w of [
      [0.97, 0.01, 0.01, 0.01],
      [0.26, 0.25, 0.25, 0.24],
      [0.5, 0.5, 0, 0],
    ]) {
      expect(toChips(w).reduce((a, b) => a + b, 0)).toBe(CHIPS);
    }
  });
});

describe("the countries offered", () => {
  it("are the photo's own and Atlas's first three others, the same again from the same seed", () => {
    const options = hedgeOptions(laos, 7);
    expect([...options].sort()).toEqual(["LA", "TH", "VN", "KH"].sort());
    expect(hedgeOptions(laos, 7)).toEqual(options);
  });

  it("include the photo's country when Atlas missed it, beside Atlas's top three", () => {
    const peru = record("p", "PE", [
      ["BO", 0.5],
      ["EC", 0.3],
      ["CL", 0.1],
      ["CO", 0.1],
    ]);
    expect([...hedgeOptions(peru, 1)].sort()).toEqual(["BO", "CL", "EC", "PE"]);
  });

  it("are shuffled, so the right one isn't always in the same place", () => {
    const places = new Set<number>();
    for (let seed = 0; seed < 40; seed++) places.add(hedgeOptions(laos, seed).indexOf("LA"));
    expect(places.size).toBe(4);
  });

  it("deal only photos Atlas weighed another country for", () => {
    const records = [
      laos,
      record("b", "FR", null),
      record("c", "FR", [["FR", 1]]),
      record("d", "FR", [
        ["FR", 0.9],
        ["BE", 0.1],
      ]),
    ];
    expect(hedgeIds(records)).toEqual(["a", "d"]);
    expect(dealHedge(["a", "b", "c", "d", "e", "f", "g"], 3)).toHaveLength(HEDGE_PHOTOS);
    expect(dealHedge(["a", "b"], 3)).toHaveLength(2);
  });

  it("are four for every bundled photo dealt", () => {
    expect(bundledHedgeIds.length).toBeGreaterThan(HEDGE_PHOTOS);
    for (const id of bundledHedgeIds) {
      const r = bundledById.get(id)!;
      const options = hedgeOptions(r, 11);
      expect(options).toHaveLength(4);
      expect(options).toContain(r.photo.country);
      expect(new Set(options).size).toBe(4);
    }
  });
});

describe("atlasChips", () => {
  it("bets Atlas's belief over the four, renormalised", () => {
    expect(atlasChips(laos.atlas, ["LA", "VN", "TH", "KH"])).toEqual([6, 2, 1, 1]);
    // Renormalised: 0.6 / 0.85 of ten is 7.06.
    expect(atlasChips(laos.atlas, ["LA", "VN", "KH", "MM"])).toEqual([7, 2, 1, 0]);
  });

  it("reads the whole belief where there is one, so a country off the shortlist can get chips", () => {
    const r = record(
      "x",
      "PE",
      [
        ["BO", 0.5],
        ["EC", 0.3],
        ["CL", 0.2],
      ],
      {
        BO: 0.4,
        EC: 0.3,
        CL: 0.1,
        PE: 0.2,
      },
    );
    expect(atlasChips(r.atlas, ["BO", "EC", "CL", "PE"])).toEqual([4, 3, 1, 2]);
    expect(atlasChips(null, ["BO", "EC", "CL", "PE"])).toEqual([3, 3, 2, 2]);
  });
});

describe("a bet", () => {
  it("adds chips up to ten and takes them back off", () => {
    let chips = [0, 0, 0, 0];
    for (let i = 0; i < 12; i++) chips = addChip(chips, 2);
    expect(chips).toEqual([0, 0, 10, 0]);
    expect(chipsLeft(chips)).toBe(0);
    expect(addChip(chips, 0)).toEqual(chips);
    chips = takeChip(chips, 2);
    expect(chips).toEqual([0, 0, 9, 0]);
    expect(takeChip(chips, 0)).toEqual(chips);
    expect(addChip(chips, 9)).toEqual(chips);
    expect(chipsLeft(chips)).toBe(1);
  });

  it("scores both sides on the photo's real country", () => {
    const result = hedgeResult(laos, ["VN", "LA", "TH", "KH"], [2, 8, 0, 0])!;
    expect(result.right).toBe(1);
    expect(result.atlasChips).toEqual([2, 6, 1, 1]);
    expect(result.score).toBe(hedgeScore([2, 8, 0, 0], 1));
    expect(result.atlasScore).toBe(hedgeScore([2, 6, 1, 1], 1));
    expect(hedgeLine(result, (c) => c)).toBe("You had 8 chips on LA, Atlas 6 chips.");
    expect(hedgeResult(laos, ["VN", "LA", "TH", "KH"], [2, 7, 0, 0])).toBeNull();
    expect(hedgeResult(laos, ["VN", "MM", "TH", "KH"], [10, 0, 0, 0])).toBeNull();
    expect(hedgeResult(laos, ["VN", "LA", "TH"], [10, 0, 0, 0])).toBeNull();
    expect(chipWord(1)).toBe("1 chip");
  });
});

function result(id: string, score: number, atlasScore: number): HedgeResult {
  return {
    id,
    options: ["LA", "VN", "TH", "KH"],
    chips: [10, 0, 0, 0],
    atlasChips: [6, 2, 1, 1],
    right: 0,
    score,
    atlasScore,
  };
}

describe("hedgeReducer", () => {
  it("bets each photo in order, answers, and ends after the last", () => {
    let s = hedgeReducer(initialHedge, { type: "start", order: ["a", "b"], seed: 5 });
    expect(s).toMatchObject({ phase: "betting", seed: 5 });
    // Out of order or while answered: ignored.
    expect(hedgeReducer(s, { type: "bet", result: result("b", 1, 1) })).toBe(s);
    s = hedgeReducer(s, { type: "bet", result: result("a", 900, 700) });
    expect(s.phase).toBe("answered");
    expect(hedgeReducer(s, { type: "bet", result: result("b", 1, 1) })).toBe(s);
    s = hedgeReducer(s, { type: "next" });
    expect(s.phase).toBe("betting");
    expect(hedgeReducer(s, { type: "next" })).toBe(s);
    s = hedgeReducer(s, { type: "bet", result: result("b", 0, 600) });
    s = hedgeReducer(s, { type: "next" });
    expect(s.phase).toBe("done");
    if (s.phase !== "done") throw new Error("not done");
    expect(hedgeTotals(s.results)).toEqual({ total: 900, atlas: 1300 });
    expect(hedgeEndLine(s.results)).toBe("Atlas's probabilities read the odds better this time.");
  });

  it("ends at once with nothing to deal", () => {
    expect(hedgeReducer(initialHedge, { type: "start", order: [], seed: 0 })).toMatchObject({
      phase: "done",
      results: [],
    });
  });

  it("words a win and a tie", () => {
    expect(hedgeEndLine([result("a", 800, 700)])).toMatch(/^You read the odds better/);
    expect(hedgeEndLine([result("a", 700, 700)])).toMatch(/level\.$/);
  });
});

describe("the best", () => {
  it("keeps the most points and refuses junk", () => {
    expect(loadBestHedge()).toBe(0);
    expect(rememberHedge(3100)).toBe(3100);
    expect(rememberHedge(2000)).toBe(3100);
    expect(rememberHedge(HEDGE_PHOTOS * HEDGE_MAX + 1)).toBe(3100);
    expect(loadBestHedge()).toBe(3100);
    localStorage.setItem(BEST_HEDGE_KEY, "{not json");
    expect(loadBestHedge()).toBe(0);
    localStorage.setItem(BEST_HEDGE_KEY, "12.5");
    expect(loadBestHedge()).toBe(0);
  });
});
