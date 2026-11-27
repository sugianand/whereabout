import { beforeEach, describe, expect, it } from "vitest";

import { bundledById, bundledHedgeIds } from "./bundled";
import type { GameRecord } from "./deck";
import {
  HEDGE_PHOTOS,
  hedgeOptions,
  hedgeReducer,
  hedgeResult,
  initialHedge,
  type HedgeResult,
} from "./hedge";
import {
  HEDGE_DAILY_KEY,
  dailyHedgeOrder,
  dailyHedgeSeed,
  hedgeDailyShare,
  hedgeDayDone,
  hedgeMark,
  loadHedgeDay,
  parseHedgeDay,
  rememberHedgeDay,
  settleHedge,
} from "./hedgeDaily";
import { dailyTrustOrder } from "./trustDaily";

const IDS = Array.from({ length: 40 }, (_, i) => `p${i}`);
const DAY = "2026-11-28";
const HREF = "https://example.test/whereabout/hedge/daily/?x=1#y";

/** A photo in `country` that Atlas weighed at `top`, as probabilities. */
function record(id: string, country: string, top: [string, number][]): GameRecord {
  return {
    photo: {
      id,
      imageUrl: `https://upload.wikimedia.org/${id}.jpg`,
      lng: 0,
      lat: 0,
      place: `Somewhere ${id}`,
      country,
      credit: { author: "A", license: "CC BY 4.0", sourceUrl: "https://c" },
    },
    atlas: {
      lng: 0,
      lat: 0,
      confidence: top[0]![1],
      topCountries: top.map(([c, p]) => ({ country: c, p })),
      clues: [],
    },
  };
}

const fr = record("p1", "FR", [
  ["FR", 0.5],
  ["BE", 0.3],
  ["CH", 0.1],
  ["LU", 0.1],
]);
const jp = record("p2", "JP", [
  ["KR", 0.6],
  ["JP", 0.2],
  ["CN", 0.1],
  ["TW", 0.1],
]);
const OPTS = ["FR", "BE", "CH", "LU"];
// All in on France, right: 1,000. An even-ish spread on Japan's four.
const r1 = hedgeResult(fr, OPTS, [10, 0, 0, 0])!;
const r2 = hedgeResult(jp, ["KR", "JP", "CN", "TW"], [3, 3, 2, 2])!;

beforeEach(() => localStorage.clear());

const stored = (day: unknown) => JSON.parse(JSON.stringify(day)) as unknown;

describe("the day's deal", () => {
  it("is five photos, the same for everyone on a day, and changes with the day", () => {
    const day = dailyHedgeOrder(IDS, DAY);
    expect(day).toHaveLength(HEDGE_PHOTOS);
    expect(new Set(day).size).toBe(HEDGE_PHOTOS);
    expect(dailyHedgeOrder(IDS, DAY)).toEqual(day);
    expect(dailyHedgeOrder(IDS, "2026-11-29")).not.toEqual(day);
  });

  it("is dealt on its own seed, apart from the other daily games' photos that day", () => {
    expect(dailyHedgeOrder(IDS, DAY)).not.toEqual(dailyTrustOrder(IDS, DAY).slice(0, 5));
    expect(dailyHedgeSeed(DAY)).not.toBe(dailyHedgeSeed("2026-11-29"));
  });

  it("offers the same four countries in the same order on every bundled photo dealt today", () => {
    const seed = dailyHedgeSeed(DAY);
    const ids = dailyHedgeOrder(bundledHedgeIds, DAY);
    expect(ids).toHaveLength(HEDGE_PHOTOS);
    for (const id of ids) {
      const r = bundledById.get(id)!;
      const options = hedgeOptions(r, seed);
      expect(options).toContain(r.photo.country);
      expect(hedgeOptions(r, dailyHedgeSeed(DAY))).toEqual(options);
    }
  });

  it("deals every photo there is when there are fewer than five", () => {
    expect(dailyHedgeOrder(IDS.slice(0, 3), DAY).sort()).toEqual(IDS.slice(0, 3).sort());
  });
});

describe("the day kept", () => {
  it("keeps the bets after every photo and reads them back", () => {
    expect(loadHedgeDay(DAY)).toBeNull();
    rememberHedgeDay(DAY, [r1]);
    expect(loadHedgeDay(DAY)).toEqual({ results: [r1] });
    expect(hedgeDayDone(loadHedgeDay(DAY))).toBe(false);
    rememberHedgeDay(DAY, [r1, r2]);
    expect(loadHedgeDay(DAY)!.results).toEqual([r1, r2]);
    expect(loadHedgeDay("2026-11-29")).toBeNull();
    expect(Object.keys(JSON.parse(localStorage.getItem(HEDGE_DAILY_KEY)!))).toEqual([DAY]);
  });

  it("is done once all five photos are bet on", () => {
    const five = ["a", "b", "c", "d", "e"].map((id) => ({ ...r1, id }));
    rememberHedgeDay(DAY, five);
    expect(hedgeDayDone(loadHedgeDay(DAY))).toBe(true);
    expect(hedgeDayDone(null)).toBe(false);
  });

  it("picks a game back up in the reducer at the first photo not yet bet on", () => {
    const order = ["p1", "p2", "p3"];
    const resumed = hedgeReducer(initialHedge, { type: "start", order, seed: 7, from: [r1] });
    expect(resumed).toMatchObject({ phase: "betting", seed: 7, results: [r1] });
    const done = hedgeReducer(initialHedge, {
      type: "start",
      order: ["p1", "p2"],
      seed: 7,
      from: [r1, r2],
    });
    expect(done.phase).toBe("done");
  });

  it("reads back only bets that agree with themselves", () => {
    expect(parseHedgeDay(stored({ results: [r1, r2] }))).toEqual({ results: [r1, r2] });
    const junk: unknown[] = [
      null,
      "x",
      { results: "x" },
      {
        results: Array(6)
          .fill(r1)
          .map((r, i) => ({ ...r, id: `x${i}` })),
      },
      { results: [r1, r1] },
      { results: [{ ...r1, id: "" }] },
      // Chips that don't add up to ten, or aren't whole.
      { results: [{ ...r1, chips: [9, 0, 0, 0] }] },
      { results: [{ ...r1, chips: [9.5, 0.5, 0, 0] }] },
      { results: [{ ...r1, atlasChips: [1, 1, 1] }] },
      // Points the chips didn't earn.
      { results: [{ ...r1, score: 999 }] },
      { results: [{ ...r1, atlasScore: r1.atlasScore + 1 }] },
      // The right country out of the options, or options repeated.
      { results: [{ ...r1, right: 4, score: null, atlasScore: null }] },
      { results: [{ ...r1, right: -1 }] },
      { results: [{ ...r1, options: ["FR", "FR", "CH", "LU"] }] },
      { results: [{ ...r1, options: ["FR"], chips: [10], atlasChips: [10] }] },
    ];
    for (const j of junk) expect(parseHedgeDay(j), JSON.stringify(j)).toBeNull();
  });

  it("skips a malformed day and keeps the good ones", () => {
    localStorage.setItem(
      HEDGE_DAILY_KEY,
      JSON.stringify({ [DAY]: { results: [r1] }, "2026-11-29": { results: [{ id: 3 }] } }),
    );
    expect(loadHedgeDay(DAY)).toEqual({ results: [r1] });
    expect(loadHedgeDay("2026-11-29")).toBeNull();
  });
});

describe("settling a kept day", () => {
  it("scores each kept bet again against its photo, Atlas's chips from its own answer", () => {
    // A forged day: France claimed as the wrong one, Atlas's chips and both scores made up.
    const forged: HedgeResult = {
      ...r1,
      right: 1,
      atlasChips: [0, 10, 0, 0],
      score: 0,
      atlasScore: 1000,
    };
    const records = new Map([["p1", fr]]);
    expect(settleHedge([forged], records)).toEqual([r1]);
  });

  it("keeps a bet as read while its photo is still loading", () => {
    expect(settleHedge([r1, r2], new Map([["p1", fr]]))).toEqual([r1, r2]);
  });

  it("scores nothing for a bet whose countries don't hold the photo's own", () => {
    const elsewhere = record("p1", "DE", [["FR", 0.9]]);
    const [settled] = settleHedge([r1], new Map([["p1", elsewhere]]));
    expect(settled).toMatchObject({ score: 0, atlasScore: 0 });
  });
});

describe("the share", () => {
  it("marks each photo by the chips on the right country", () => {
    const on = (n: number): HedgeResult => ({
      ...r1,
      chips: [n, 10 - n, 0, 0],
    });
    expect([10, 7, 6, 4, 3, 1, 0].map((n) => hedgeMark(on(n))).join("")).toBe("🟩🟩🟨🟨🟧🟧🟥");
  });

  it("gives the points beside Atlas's and a square per photo, naming no place or country", () => {
    const text = hedgeDailyShare(DAY, [r1, r2], HREF);
    const lines = text.split("\n");
    expect(lines[0]).toBe(`Whereabout · Hedge your bets · ${DAY}`);
    expect(lines[1]).toBe(
      `🎲 ${(r1.score + r2.score).toLocaleString("en-US")} of 2,000 · Atlas's probabilities ${(
        r1.atlasScore + r2.atlasScore
      ).toLocaleString("en-US")}`,
    );
    expect(lines[2]).toBe("🟩🟧");
    expect(lines[3]).toBe("https://example.test/whereabout/hedge/daily/");
    for (const word of ["FR", "JP", "France", "Japan", "Somewhere"]) {
      expect(text).not.toContain(word);
    }
  });
});
