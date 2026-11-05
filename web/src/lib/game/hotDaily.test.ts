import { beforeEach, describe, expect, it } from "vitest";

import { dailyRunUrl } from "./dailyRuns";
import {
  HOT_PHOTOS,
  hotAtlas,
  hotPin,
  hotReducer,
  hotRound,
  initialHot,
  type HotPin,
} from "./hotCold";
import {
  HOT_DAILY_KEY,
  dailyHotOrder,
  hotDailyShare,
  loadHotDay,
  parseHotDay,
  pinSquares,
  rememberHotDay,
} from "./hotDaily";

const IDS = Array.from({ length: 40 }, (_, i) => `p${i}`);
const HREF = "https://example.test/whereabout/hot-cold/daily/?x=1#y";
const TRUTH = { lng: 2.35, lat: 48.86 };
const near = hotPin({ lng: 2.4, lat: 48.9 }, TRUTH, true);
const sea = hotPin({ lng: -150, lat: -5 }, TRUTH, false);
const sea2 = hotPin({ lng: -160, lat: 5 }, TRUTH, false);

beforeEach(() => localStorage.clear());

/** Through JSON, as storage holds it, then back. */
const stored = (day: unknown) => JSON.parse(JSON.stringify(day)) as unknown;

describe("the day's deal", () => {
  it("is five photos, the same for everyone on a day, and changes with the day", () => {
    const day = dailyHotOrder(IDS, "2026-11-05");
    expect(day).toHaveLength(HOT_PHOTOS);
    expect(new Set(day).size).toBe(HOT_PHOTOS);
    expect(dailyHotOrder(IDS, "2026-11-05")).toEqual(day);
    expect(dailyHotOrder(IDS, "2026-11-06")).not.toEqual(day);
  });
});

describe("the day kept", () => {
  const round = hotRound("p1", [sea, near], hotAtlas(120, true));
  const photo = (pins: HotPin[]) => ({ id: "p1", pins, atlas: null });

  it("keeps the photos over and the pins in play, and reads them back the same", () => {
    rememberHotDay("2026-11-05", { results: [round], pins: [sea] });
    expect(loadHotDay("2026-11-05")).toEqual({ results: [round], pins: [sea] });
    expect(loadHotDay("2026-11-06")).toBeNull();
  });

  it("rebuilds a photo's score from its pins, not from what was stored", () => {
    const forged = { results: [{ ...round, score: 999_999, bonus: 999_999 }], pins: [] };
    expect(parseHotDay(stored(forged))?.results[0]!.score).toBe(round.score);
  });

  it.each<[string, unknown]>([
    ["no pins", { results: [photo([])], pins: [] }],
    ["a photo that stopped early", { results: [photo([sea])], pins: [] }],
    ["a pin after the find", { results: [photo([near, sea])], pins: [] }],
    ["four pins", { results: [photo([sea, sea, sea, near])], pins: [] }],
    ["a found pin in play", { results: [], pins: [near] }],
    ["three pins in play", { results: [], pins: [sea, sea2, sea] }],
    ["too many photos", { results: Array(HOT_PHOTOS + 1).fill(round), pins: [] }],
    ["pins after the last photo", { results: Array(HOT_PHOTOS).fill(round), pins: [sea] }],
    ["a broken pin", { results: [], pins: [{ ...sea, km: "far" }] }],
    ["a broken Atlas", { results: [{ ...round, atlas: { km: -1, found: true } }], pins: [] }],
    ["no pins array", { results: [] }],
  ])("skips a day with %s", (_, day) => {
    expect(parseHotDay(stored(day))).toBeNull();
  });

  it("skips what it can't read in storage", () => {
    localStorage.setItem(HOT_DAILY_KEY, JSON.stringify({ "2026-11-05": { results: "no" } }));
    expect(loadHotDay("2026-11-05")).toBeNull();
  });
});

describe("picking a game back up", () => {
  const ORDER = ["a", "b", "c"];
  const over = hotRound("a", [near], null);

  it("starts at the next photo with its pins, ready for the next one", () => {
    const pins: HotPin[] = [sea];
    const state = hotReducer(initialHot, {
      type: "start",
      order: ORDER,
      from: { results: [over], pins },
    });
    expect(state).toMatchObject({ phase: "guessing", index: 1, pins, pin: null, results: [over] });
  });

  it("is finished when every photo is over", () => {
    const results = ORDER.map((id) => hotRound(id, [near], null));
    const state = hotReducer(initialHot, {
      type: "start",
      order: ORDER,
      from: { results, pins: [] },
    });
    expect(state).toEqual({ phase: "finished", order: ORDER, results });
  });
});

describe("the share line", () => {
  const found1 = hotRound("p1", [near], hotAtlas(10, true));
  const found3 = hotRound("p2", [sea, sea2, near], hotAtlas(9000, false));
  const lost = hotRound("p3", [sea, sea2, sea], null);

  it("shows a photo's pins, misses first", () => {
    expect(pinSquares(found1)).toBe("🟩");
    expect(pinSquares(found3)).toBe("🟥🟥🟩");
    expect(pinSquares(lost)).toBe("🟥🟥🟥");
  });

  it("is points and pins only, with the page's clean address", () => {
    const results = [found1, found3];
    const total = found1.score + found3.score;
    const atlas = found1.atlas!.score + found3.atlas!.score;
    const money = new Intl.NumberFormat("en-US");
    expect(hotDailyShare("2026-11-05", results, HREF)).toBe(
      [
        "Whereabout · Hot and cold · 2026-11-05",
        `🔥 ${money.format(total)} of 12,000`,
        "🟩 🟥🟥🟩",
        `Atlas: ${money.format(atlas)}`,
        dailyRunUrl(HREF),
      ].join("\n"),
    );
  });

  it("says when Atlas played only some of the photos, and leaves it out when it played none", () => {
    expect(hotDailyShare("2026-11-05", [found1, lost], HREF)).toContain(" on 1 of the photos\n");
    expect(hotDailyShare("2026-11-05", [lost], HREF)).not.toContain("Atlas");
  });
});
