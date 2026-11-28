import { beforeEach, describe, expect, it } from "vitest";

import type { HedgeResult } from "./hedge";
import {
  HEDGE_ODDS_KEY,
  ODDS,
  addHedgeOdds,
  emptyHedgeOdds,
  hedgeOddsLeader,
  hedgeOddsLine,
  hitRate,
  loadHedgeOdds,
  oddsBandOf,
  oddsBandText,
  oddsGap,
  parseHedgeOdds,
  recordHedgeOdds,
  saidRate,
} from "./hedgeOdds";

beforeEach(() => window.localStorage.clear());

/** A bet on four countries, `right` the photo's own; only the chips matter here. */
const bet = (chips: number[], atlasChips: number[], right: number) =>
  ({ id: "x", options: ["A", "B", "C", "D"], chips, atlasChips, right }) as HedgeResult;

describe("oddsBandOf", () => {
  it("bands every chip count from one to ten, and none for no chips", () => {
    expect(Array.from({ length: 11 }, (_, c) => oddsBandOf(c))).toEqual([
      -1, 0, 0, 1, 1, 2, 2, 2, 3, 3, 3,
    ]);
    // The bands cover one to ten with no gap or overlap.
    expect(ODDS[0]!.min).toBe(1);
    ODDS.slice(1).forEach((b, i) => expect(b.min).toBe(ODDS[i]!.max + 1));
    expect(ODDS.at(-1)!.max).toBe(10);
  });
});

describe("addHedgeOdds", () => {
  it("counts each country with chips in its band, yours and Atlas's, and the right one", () => {
    const odds = addHedgeOdds(emptyHedgeOdds(), bet([7, 1, 2, 0], [6, 2, 1, 1], 0));
    expect(odds).toEqual({
      photos: 1,
      you: [
        { bets: 2, chips: 3, right: 0 },
        { bets: 0, chips: 0, right: 0 },
        { bets: 1, chips: 7, right: 1 },
        { bets: 0, chips: 0, right: 0 },
      ],
      atlas: [
        { bets: 3, chips: 4, right: 0 },
        { bets: 0, chips: 0, right: 0 },
        { bets: 1, chips: 6, right: 1 },
        { bets: 0, chips: 0, right: 0 },
      ],
    });
  });

  it("counts nothing right when the photo's country had no chips", () => {
    const odds = addHedgeOdds(emptyHedgeOdds(), bet([0, 10, 0, 0], [3, 3, 2, 2], 2));
    expect(odds.you[3]).toEqual({ bets: 1, chips: 10, right: 0 });
    expect(odds.atlas[0]).toEqual({ bets: 2, chips: 4, right: 1 });
    expect(odds.atlas[1]).toEqual({ bets: 2, chips: 6, right: 0 });
  });
});

describe("rates and the gap", () => {
  it("reads how often a band was right beside what its chips said", () => {
    const b = { bets: 4, chips: 14, right: 1 };
    expect(hitRate(b)).toBe(25);
    expect(saidRate(b)).toBe(35);
    expect(oddsBandText(b)).toBe("Right 1 of 4 · 25%, chips said 35%");
    expect(hitRate({ bets: 0, chips: 0, right: 0 })).toBeNull();
    expect(oddsBandText({ bets: 0, chips: 0, right: 0 })).toBe("None bet yet");
  });

  it("is 0 for odds that came true and grows as they miss", () => {
    // Ten countries at one chip each, one right: 10% said, 10% right.
    expect(oddsGap([{ bets: 10, chips: 10, right: 1 }, ...emptyHedgeOdds().you.slice(1)])).toBe(0);
    // All in twice, right once: said 100%, right 50%, 50 points off.
    const sure = [...emptyHedgeOdds().you.slice(0, 3), { bets: 2, chips: 20, right: 1 }];
    expect(oddsGap(sure)).toBe(50);
    // Weighted by countries: |0 − 0.3| + |1 − 0.7| over two countries.
    expect(oddsGap(addHedgeOdds(emptyHedgeOdds(), bet([7, 3, 0, 0], [], 0)).you)).toBe(30);
    expect(oddsGap(emptyHedgeOdds().you)).toBeNull();
  });
});

describe("the words", () => {
  it("says how far off each side was and who read the odds closer", () => {
    expect(hedgeOddsLine(emptyHedgeOdds())).toBe("No bets yet.");
    expect(hedgeOddsLeader(emptyHedgeOdds())).toBeNull();
    // You all in and right; Atlas 6/2/1/1, its six right.
    let odds = addHedgeOdds(emptyHedgeOdds(), bet([10, 0, 0, 0], [6, 2, 1, 1], 0));
    expect(hedgeOddsLine(odds)).toBe(
      "Over 1 photo, your chips were 0 points off the real odds; Atlas's, 20.",
    );
    expect(hedgeOddsLeader(odds)).toBe("you");
    // Then all in and wrong: you 50 points off over two countries.
    odds = addHedgeOdds(odds, bet([0, 10, 0, 0], [6, 2, 1, 1], 0));
    expect(oddsGap(odds.you)).toBe(50);
    expect(hedgeOddsLeader(odds)).toBe("atlas");
    expect(hedgeOddsLine(odds)).toMatch(/^Over 2 photos, your chips were 50 points off/);
    const level = addHedgeOdds(emptyHedgeOdds(), bet([5, 5, 0, 0], [5, 5, 0, 0], 0));
    expect(hedgeOddsLeader(level)).toBe("level");
  });
});

describe("parseHedgeOdds", () => {
  const good = addHedgeOdds(emptyHedgeOdds(), bet([7, 1, 2, 0], [6, 2, 1, 1], 0));

  it("takes back what it writes", () => {
    expect(parseHedgeOdds(JSON.parse(JSON.stringify(good)))).toEqual(good);
    expect(parseHedgeOdds(emptyHedgeOdds())).toEqual(emptyHedgeOdds());
  });

  it("drops counts that can't agree with themselves", () => {
    const with_ = (side: "you" | "atlas", band: number, patch: object) => ({
      ...good,
      [side]: good[side].map((b, i) => (i === band ? { ...b, ...patch } : b)),
    });
    for (const junk of [
      null,
      "x",
      [],
      { ...good, photos: -1 },
      { ...good, photos: 1.5 },
      { ...good, you: good.you.slice(1) },
      // More right than bets.
      with_("you", 2, { right: 2 }),
      // Seven chips can't sit in the 1–2 band on one country.
      with_("you", 0, { bets: 1, chips: 7 }),
      // Chips that don't add up to ten a photo.
      with_("atlas", 2, { chips: 5 }),
      // Two right countries on one photo.
      with_("you", 0, { right: 1 }),
      with_("you", 3, { bets: "1" }),
    ]) {
      expect(parseHedgeOdds(junk), JSON.stringify(junk)).toBeNull();
    }
  });
});

describe("keeping", () => {
  it("adds every bet to the browser's read and reads it back", () => {
    expect(loadHedgeOdds()).toEqual(emptyHedgeOdds());
    recordHedgeOdds(bet([10, 0, 0, 0], [6, 2, 1, 1], 0));
    const odds = recordHedgeOdds(bet([4, 3, 3, 0], [6, 2, 1, 1], 1));
    expect(odds.photos).toBe(2);
    expect(loadHedgeOdds()).toEqual(odds);
    expect(odds.you[1]).toEqual({ bets: 3, chips: 10, right: 1 });
  });

  it("starts over from junk in storage", () => {
    window.localStorage.setItem(HEDGE_ODDS_KEY, "{not json");
    expect(loadHedgeOdds()).toEqual(emptyHedgeOdds());
    window.localStorage.setItem(HEDGE_ODDS_KEY, JSON.stringify({ photos: 3 }));
    expect(recordHedgeOdds(bet([10, 0, 0, 0], [10, 0, 0, 0], 0)).photos).toBe(1);
  });
});
