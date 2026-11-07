import { beforeEach, describe, expect, it } from "vitest";

import {
  CLOSE_DAILY_KEY,
  closeDailyShare,
  dailyCloseSeed,
  loadCloseDay,
  parseCloseDay,
  rememberCloseDay,
  trySquares,
} from "./closeDaily";
import { dealClose, type CloseResult } from "./closeUp";

const DAY = "2026-11-07";
const HREF = "https://example.test/whereabout/close-up/daily/?x=1#y";
const IDS = Array.from({ length: 40 }, (_, i) => `p${i}`);

const result = (id: string, wrong: string[], atlasRank: number | null = 0): CloseResult => ({
  id,
  wrong,
  points: [3, 2, 1][wrong.length] ?? 0,
  atlas:
    atlasRank === null
      ? null
      : { order: ["DE", "FR", "IT"], rank: atlasRank, points: [3, 2, 1][atlasRank] },
});

beforeEach(() => localStorage.clear());

describe("today's deal", () => {
  it("is the same all day, different the next, and apart from the other dailies", () => {
    const hand = dealClose(IDS, dailyCloseSeed(DAY));
    expect(hand).toHaveLength(5);
    expect(dealClose(IDS, dailyCloseSeed(DAY))).toEqual(hand);
    expect(dealClose(IDS, dailyCloseSeed("2026-11-08"))).not.toEqual(hand);
    expect(dailyCloseSeed(DAY)).not.toBe(dailyCloseSeed("2026-11-06"));
  });
});

describe("the kept day", () => {
  it("keeps the photos over and the wrong names on the one in play", () => {
    const day = { results: [result("a", []), result("b", ["DE", "IT"], 1)], wrong: ["ES"] };
    rememberCloseDay(DAY, day);
    expect(loadCloseDay(DAY)).toEqual(day);
    expect(loadCloseDay("2026-11-06")).toBeNull();
  });

  it("rebuilds points from the wrong names and Atlas's place, never trusting stored ones", () => {
    const parsed = parseCloseDay({
      results: [
        { id: "a", wrong: ["DE"], points: 3, atlas: { order: ["FR", "DE"], rank: 1, points: 3 } },
        { id: "b", wrong: ["DE", "IT", "ES"], points: 3, atlas: { order: ["DE"], rank: null } },
      ],
      wrong: [],
    });
    expect(parsed?.results.map((r) => r.points)).toEqual([2, 0]);
    expect(parsed?.results.map((r) => r.atlas?.points)).toEqual([2, 0]);
  });

  it.each([
    ["not an object", 5],
    ["no wrong list", { results: [] }],
    ["too many photos", { results: "abcdef".split("").map((id) => result(id, [])), wrong: [] }],
    ["a photo twice", { results: [result("a", []), result("a", [])], wrong: [] }],
    ["four wrong names", { results: [result("a", ["A", "B", "C", "D"])], wrong: [] }],
    ["a name twice", { results: [result("a", ["DE", "DE"])], wrong: [] }],
    ["no try left in play", { results: [], wrong: ["DE", "IT", "ES"] }],
    ["wrong names after the last photo", { results: "abcde".split("").map((id) => result(id, [])), wrong: ["DE"] }],
    ["Atlas's place off its order", { results: [{ id: "a", wrong: [], atlas: { order: ["FR"], rank: 1 } }], wrong: [] }],
    ["Atlas with no order", { results: [{ id: "a", wrong: [], atlas: { order: [], rank: null } }], wrong: [] }],
    ["no id", { results: [{ id: "", wrong: [], atlas: null }], wrong: [] }],
  ])("refuses %s", (_, value) => {
    expect(parseCloseDay(value)).toBeNull();
  });

  it("skips junk in storage", () => {
    localStorage.setItem(CLOSE_DAILY_KEY, JSON.stringify({ [DAY]: { results: 1 }, nope: {} }));
    expect(loadCloseDay(DAY)).toBeNull();
    localStorage.setItem(CLOSE_DAILY_KEY, "{");
    expect(loadCloseDay(DAY)).toBeNull();
  });
});

describe("the share", () => {
  it("gives a red square a wrong name and a green one for the find", () => {
    expect(trySquares(result("a", []))).toBe("🟩");
    expect(trySquares(result("a", ["DE", "IT"]))).toBe("🟥🟥🟩");
    expect(trySquares(result("a", ["DE", "IT", "ES"]))).toBe("🟥🟥🟥");
  });

  it("is points and squares only, with Atlas's points and the clean address", () => {
    const results = [
      result("a", []),
      result("b", ["DE"], 2),
      result("c", ["DE", "IT", "ES"], null),
      result("d", ["DE", "IT"], 1),
      result("e", [], 0),
    ];
    expect(closeDailyShare(DAY, results, HREF)).toBe(
      [
        "Whereabout · Close-up · 2026-11-07",
        "🔍 9 of 15 points",
        "🟩 🟥🟩 🟥🟥🟥 🟥🟥🟩 🟩",
        "Atlas: 9 of 12 on 4 of the photos",
        "https://example.test/whereabout/close-up/daily/",
      ].join("\n"),
    );
  });

  it("leaves Atlas out when it played none of the photos", () => {
    const share = closeDailyShare(DAY, [result("a", [], null)], HREF);
    expect(share).not.toContain("Atlas");
  });
});
