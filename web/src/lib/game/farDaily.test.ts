import { beforeEach, describe, expect, it } from "vitest";

import { bundledDeck } from "./bundled";
import { dailyNorthOrder } from "./northDaily";
import {
  FAR_DAILY_KEY,
  dailyFarPairs,
  farDailyShare,
  loadFarDay,
  parseFarDay,
  rememberFarDay,
} from "./farDaily";
import {
  PAIRS,
  howFarReducer,
  initialHowFar,
  judgeEstimate,
  type PairResult,
} from "./howFar";

const IDS = Array.from({ length: 40 }, (_, i) => `p${i}`);
const REGIONS = { europe: IDS.slice(0, 20), asia: IDS.slice(20) };
const DAY = "2026-11-03";

function result(km: number, actualKm: number, atlasKm: number | null = null): PairResult {
  return {
    actualKm,
    you: judgeEstimate(km, actualKm),
    atlas: atlasKm === null ? null : judgeEstimate(atlasKm, actualKm),
  };
}

beforeEach(() => localStorage.clear());

describe("dailyFarPairs", () => {
  it("deals the same five pairs for everyone on a day, and others the next day", () => {
    const today = dailyFarPairs(IDS, REGIONS, DAY);
    expect(today).toHaveLength(PAIRS);
    expect(dailyFarPairs([...IDS], REGIONS, DAY)).toEqual(today);
    expect(dailyFarPairs(IDS, REGIONS, "2026-11-04")).not.toEqual(today);
    expect(new Set(today.flat()).size).toBe(PAIRS * 2);
    expect(dailyFarPairs(bundledDeck.ids, bundledDeck.regions, DAY)).toHaveLength(PAIRS);
  });

  it("mixes near and far like the free game, in its own order", () => {
    const home = (id: string) => (REGIONS.europe.includes(id) ? "europe" : "asia");
    const today = dailyFarPairs(IDS, REGIONS, DAY);
    today.forEach(([a, b], i) => expect(home(a) === home(b)).toBe(i % 2 === 0));
    expect(today[0][0]).not.toBe(dailyNorthOrder(IDS, DAY)[0]);
  });
});

describe("a kept day", () => {
  it("reads back what it wrote, one day apart from another", () => {
    const results = [result(100, 200, 180), result(5000, 4000)];
    rememberFarDay(DAY, { results });
    expect(loadFarDay(DAY)).toEqual({ results });
    expect(loadFarDay("2026-11-04")).toBeNull();
  });

  it("holds only the latest 30 days", () => {
    for (let d = 1; d <= 31; d++) {
      rememberFarDay(`2026-10-${String(d).padStart(2, "0")}`, { results: [result(10, 10)] });
    }
    expect(loadFarDay("2026-10-01")).toBeNull();
    expect(loadFarDay("2026-10-02")).not.toBeNull();
  });

  it("refuses anything else, without losing the good days", () => {
    const good = result(100, 200);
    expect(parseFarDay({ results: [good] })).toEqual({ results: [good] });
    const bad = [
      null,
      "x",
      {},
      { results: "x" },
      { results: Array.from({ length: PAIRS + 1 }, () => good) },
      { results: [{ ...good, actualKm: "far" }] },
      { results: [{ ...good, you: { ...good.you, points: 1001 } }] },
      { results: [{ ...good, you: { ...good.you, points: 1.5 } }] },
      { results: [{ ...good, you: { ...good.you, ratio: 0.5 } }] },
      { results: [{ ...good, atlas: { km: 1 } }] },
      { results: [{ actualKm: 10, you: good.you }] },
    ];
    for (const value of bad) expect(parseFarDay(value)).toBeNull();

    localStorage.setItem(
      FAR_DAILY_KEY,
      JSON.stringify({ [DAY]: { results: [good] }, "2026-11-02": { results: 1 }, nope: {} }),
    );
    expect(loadFarDay(DAY)).toEqual({ results: [good] });
    expect(loadFarDay("2026-11-02")).toBeNull();
    localStorage.setItem(FAR_DAILY_KEY, "not json");
    expect(loadFarDay(DAY)).toBeNull();
  });

  it("picks the game up at the next pair, or ends it when every pair is in", () => {
    const pairs = dailyFarPairs(IDS, REGIONS, DAY);
    const two = [result(100, 200), result(300, 300)];
    const resumed = howFarReducer(initialHowFar, { type: "start", pairs, results: two });
    expect(resumed).toMatchObject({ phase: "setting", index: 2, results: two });
    const all = Array.from({ length: PAIRS }, () => result(100, 100));
    expect(howFarReducer(initialHowFar, { type: "start", pairs, results: all }).phase).toBe(
      "finished",
    );
  });
});

describe("farDailyShare", () => {
  const href = "https://example.com/whereabout/how-far/daily/?x=1#y";

  it("gives the total, a square a pair and Atlas's total, and no distance", () => {
    const results = [
      result(100, 100, 100), // Exact: every point.
      result(300, 100, 100), // Three times off: some.
      result(2000, 100, 100), // Twenty times off: none.
    ];
    const text = farDailyShare(DAY, results, href);
    expect(text).toBe(
      [
        `Whereabout · How far apart? · ${DAY}`,
        "📏 1,523 of 3,000",
        "🟩🟨🟥",
        "Atlas: 3,000",
        "https://example.com/whereabout/how-far/daily/",
      ].join("\n"),
    );
  });

  it("says how many pairs Atlas played, and leaves it out when it played none", () => {
    const some = farDailyShare(DAY, [result(100, 100, 100), result(100, 100)], href);
    expect(some).toContain("Atlas: 1,000 on 1 of the pairs");
    expect(farDailyShare(DAY, [result(100, 100)], href)).not.toContain("Atlas");
  });
});
