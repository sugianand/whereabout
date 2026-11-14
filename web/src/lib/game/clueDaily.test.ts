import { beforeEach, describe, expect, it } from "vitest";

import { bundledClimateGroups, bundledContinents, bundledDrivingSides } from "./bundled";
import {
  CLUE_DAILY_KEY,
  clueDailyShare,
  clueDaySeed,
  clueEndedOn,
  clueRunLine,
  clueRunWords,
  dailyClueOrder,
  loadClueDay,
  loadClueDays,
  rememberClueDay,
  type ClueDay,
} from "./clueDaily";
import { CLUE_CYCLE, dealClueMix, type ClueMaps } from "./clueMix";
import { hashSeed } from "./daily";

const BUNDLED: ClueMaps = {
  sides: bundledDrivingSides,
  climates: bundledClimateGroups,
  continents: bundledContinents,
};

beforeEach(() => localStorage.clear());

describe("dailyClueOrder", () => {
  it("deals the same steps to everyone on a day, and others the next day", () => {
    const today = dailyClueOrder(BUNDLED, "2026-11-15");
    expect(dailyClueOrder({ ...BUNDLED }, "2026-11-15")).toEqual(today);
    expect(dailyClueOrder(BUNDLED, "2026-11-16")).not.toEqual(today);
  });

  it("is the free runs' even deal on the day's own seed", () => {
    expect(dailyClueOrder(BUNDLED, "2026-11-15")).toEqual(
      dealClueMix(BUNDLED, hashSeed("whereabout:clue-mix:2026-11-15")),
    );
    expect(clueDaySeed("2026-11-15")).not.toBe(hashSeed("whereabout:2026-11-15"));
    expect(clueDaySeed("2026-11-15")).not.toBe(hashSeed("whereabout:left-right:2026-11-15"));
  });

  it("asks the clues in turn of the bundled photos, never repeating one", () => {
    const order = dailyClueOrder(BUNDLED, "2026-11-15");
    expect(order.length).toBeGreaterThan(10);
    expect(new Set(order.map((s) => s.id)).size).toBe(order.length);
    order.forEach((s, i) => expect(s.clue).toBe(CLUE_CYCLE[i % CLUE_CYCLE.length]));
  });
});

describe("the kept days", () => {
  const going: ClueDay = { streak: 3, atlasRight: 2, atlasPlayed: 3, ended: null };

  it("keep a run per day under the game's own key, apart from the free runs' best", () => {
    rememberClueDay("2026-11-15", going);
    rememberClueDay("2026-11-14", { ...going, ended: "miss" });
    expect(loadClueDay("2026-11-15")).toEqual(going);
    expect(loadClueDay("2026-11-14")?.ended).toBe("miss");
    expect(loadClueDay("2026-11-13")).toBeNull();
    expect(Object.keys(JSON.parse(localStorage.getItem(CLUE_DAILY_KEY)!))).toHaveLength(2);
    expect(localStorage.getItem("whereabout:clue-mix-best")).toBeNull();
  });

  it("skip anything not in the shape they are written in", () => {
    localStorage.setItem(
      CLUE_DAILY_KEY,
      JSON.stringify({
        "2026-11-15": going,
        "2026-11-14": { ...going, atlasRight: 4 },
        "2026-11-13": { ...going, ended: "won" },
        today: going,
      }),
    );
    expect(loadClueDays()).toEqual({ "2026-11-15": going });
  });
});

describe("the run in words and squares", () => {
  const run = (streak: number, ended: ClueDay["ended"]): ClueDay => ({
    streak,
    atlasRight: 0,
    atlasPlayed: 0,
    ended,
  });

  it("names the clue a miss came on, from its place in the cycle", () => {
    expect(clueEndedOn(run(0, "miss"))).toBe("road");
    expect(clueEndedOn(run(4, "miss"))).toBe("climate");
    expect(clueEndedOn(run(5, "miss"))).toBe("continent");
    expect(clueEndedOn(run(5, "cleared"))).toBeNull();
    expect(clueRunWords(run(4, "miss"))).toBe("4 clues in a row, out on the climate");
    expect(clueRunWords(run(1, "miss"))).toBe("1 clue in a row, out on the climate");
    expect(clueRunWords(run(9, "cleared"))).toBe("9 clues in a row, every clue");
    expect(clueRunWords(run(2, null))).toBe("2 clues in a row");
  });

  it("puts the calls three to a row, under each clue's mark", () => {
    expect(clueRunLine(run(4, "miss"))).toBe("🛣️🌦️🌍\n🟩🟩🟩\n🟩🟥");
    expect(clueRunLine(run(0, "miss"))).toBe("🛣️🌦️🌍\n🟥");
    expect(clueRunLine(run(3, "cleared"))).toBe("🛣️🌦️🌍\n🟩🟩🟩\n🏁");
  });

  it("caps a long run at 30 squares", () => {
    const line = clueRunLine(run(40, "miss"));
    expect(line.match(/🟩/gu)).toHaveLength(30);
    expect(line).not.toContain("🟥");
    expect(line.endsWith("\n…")).toBe(true);
  });
});

describe("clueDailyShare", () => {
  const href = "https://example.org/whereabout/clue-mix/daily/?x=1#y";

  it("is the day, the run and Atlas's tally in counts, with the page's bare address", () => {
    const text = clueDailyShare(
      "2026-11-15",
      { streak: 2, atlasRight: 1, atlasPlayed: 3, ended: "miss" },
      href,
    );
    expect(text).toBe(
      [
        "Whereabout · Clue mix · 2026-11-15",
        "🔀 2 clues in a row, out on the continent",
        "🛣️🌦️🌍",
        "🟩🟩🟥",
        "Atlas: 1 of 3",
        "https://example.org/whereabout/clue-mix/daily/",
      ].join("\n"),
    );
  });

  it("leaves Atlas out when it called none", () => {
    const text = clueDailyShare(
      "2026-11-15",
      { streak: 1, atlasRight: 0, atlasPlayed: 0, ended: "miss" },
      href,
    );
    expect(text).not.toContain("Atlas");
  });
});
