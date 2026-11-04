import { beforeEach, describe, expect, it } from "vitest";

import { dailyRunUrl } from "./dailyRuns";
import {
  NAME_DAILY_KEY,
  dailyNameOrder,
  dailyNameSeed,
  loadNameDay,
  nameDailyShare,
  rememberNameDay,
} from "./nameDaily";

const IDS = Array.from({ length: 40 }, (_, i) => `p${i}`);
const HREF = "https://example.test/whereabout/name-country/daily/?x=1#y";

beforeEach(() => localStorage.clear());

describe("the day's deal", () => {
  it("is the same for everyone on a day, and changes with the day", () => {
    const day = dailyNameOrder(IDS, "2026-11-04");
    expect(dailyNameOrder(IDS, "2026-11-04")).toEqual(day);
    expect(dailyNameOrder(IDS, "2026-11-05")).not.toEqual(day);
    expect([...day].sort()).toEqual([...IDS].sort());
    expect(dailyNameSeed("2026-11-04")).toBe(dailyNameSeed("2026-11-04"));
    expect(dailyNameSeed("2026-11-05")).not.toBe(dailyNameSeed("2026-11-04"));
  });
});

describe("the day kept", () => {
  it("keeps a run per day and skips what it can't read", () => {
    const run = { streak: 2, atlasRight: 1, atlasPlayed: 2, ended: null };
    rememberNameDay("2026-11-04", run);
    expect(loadNameDay("2026-11-04")).toEqual(run);
    expect(loadNameDay("2026-11-05")).toBeNull();
    localStorage.setItem(NAME_DAILY_KEY, JSON.stringify({ "2026-11-04": { streak: "2" } }));
    expect(loadNameDay("2026-11-04")).toBeNull();
  });
});

describe("the share line", () => {
  it("is counts only, with the page's clean address", () => {
    const run = { streak: 2, atlasRight: 1, atlasPlayed: 3, ended: "miss" } as const;
    expect(nameDailyShare("2026-11-04", run, HREF)).toBe(
      [
        "Whereabout · Name the country · 2026-11-04",
        "🗺️ 2 countries in a row",
        "🟩🟩🟥",
        "Atlas: 1 of 3",
        dailyRunUrl(HREF),
      ].join("\n"),
    );
  });

  it("says one country, every photo, and leaves out an Atlas that never played", () => {
    const run = { streak: 1, atlasRight: 0, atlasPlayed: 0, ended: "cleared" } as const;
    const text = nameDailyShare("2026-11-04", run, HREF);
    expect(text).toContain("🗺️ 1 country in a row, every photo\n🟩🏁\n");
    expect(text).not.toContain("Atlas");
  });
});
