import { beforeEach, describe, expect, it } from "vitest";

import {
  bundledClimateGroups,
  bundledContinents,
  bundledDrivingSides,
  bundledGroundCovers,
} from "./bundled";
import {
  CLUE_DAILY_KEY,
  addClueRead,
  answeredSteps,
  parseClueDay,
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
import { CLUE_CYCLE, THREE_CLUE_CYCLE, dealClueMix, type ClueMaps } from "./clueMix";
import { hashSeed } from "./daily";

const BUNDLED: ClueMaps = {
  sides: bundledDrivingSides,
  climates: bundledClimateGroups,
  continents: bundledContinents,
  grounds: bundledGroundCovers,
};

beforeEach(() => localStorage.clear());

describe("dailyClueOrder", () => {
  it("deals the same steps to everyone on a day, and others the next day", () => {
    const today = dailyClueOrder(BUNDLED, "2026-11-15");
    expect(dailyClueOrder({ ...BUNDLED }, "2026-11-15")).toEqual(today);
    expect(dailyClueOrder(BUNDLED, "2026-11-16")).not.toEqual(today);
  });

  it("is the free runs' even deal on the day's own seed, over the day's own cycle", () => {
    expect(dailyClueOrder(BUNDLED, "2026-11-18")).toEqual(
      dealClueMix(BUNDLED, hashSeed("whereabout:clue-mix:2026-11-18")),
    );
    // A day before the ground joined is dealt over three clues, as it was played then.
    expect(dailyClueOrder(BUNDLED, "2026-11-15")).toEqual(
      dealClueMix(BUNDLED, hashSeed("whereabout:clue-mix:2026-11-15"), [], THREE_CLUE_CYCLE),
    );
    expect(clueDaySeed("2026-11-15")).not.toBe(hashSeed("whereabout:2026-11-15"));
    expect(clueDaySeed("2026-11-15")).not.toBe(hashSeed("whereabout:left-right:2026-11-15"));
  });

  it("asks the four clues in turn of the bundled photos, never repeating one", () => {
    const order = dailyClueOrder(BUNDLED, "2026-11-18");
    expect(order.length).toBeGreaterThan(10);
    expect(new Set(order.map((s) => s.id)).size).toBe(order.length);
    order.forEach((s, i) => expect(s.clue).toBe(CLUE_CYCLE[i % CLUE_CYCLE.length]));
    expect(order[3].clue).toBe("ground");
  });

  it("never asks the ground on a day before it joined", () => {
    const order = dailyClueOrder(BUNDLED, "2026-11-17");
    order.forEach((s, i) => expect(s.clue).toBe(THREE_CLUE_CYCLE[i % 3]));
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

describe("Atlas's reads on each step", () => {
  const run = (over: Partial<ClueDay>): ClueDay => ({
    streak: 0,
    atlasRight: 0,
    atlasPlayed: 0,
    ended: null,
    ...over,
  });

  it("count the steps answered: the right calls and the miss", () => {
    expect(answeredSteps(run({ streak: 2 }))).toBe(2);
    expect(answeredSteps(run({ streak: 2, ended: "miss" }))).toBe(3);
    expect(answeredSteps(run({ streak: 3, ended: "cleared" }))).toBe(3);
  });

  it("are kept with the day and read back when they add up to Atlas's tally", () => {
    const kept = run({ streak: 2, atlasRight: 1, atlasPlayed: 2, ended: "miss", reads: "r-w" });
    rememberClueDay("2026-11-16", kept);
    // Keeping another day re-reads the first, and its reads survive that.
    rememberClueDay("2026-11-17", run({ streak: 1, atlasRight: 1, atlasPlayed: 1, reads: "r" }));
    expect(loadClueDay("2026-11-16")).toEqual(kept);
    expect(loadClueDays()["2026-11-17"].reads).toBe("r");
  });

  it("are dropped, leaving the run, when they don't fit it", () => {
    const base = { streak: 2, atlasRight: 1, atlasPlayed: 2, ended: "miss" };
    for (const reads of ["r-", "rw-r", "rr-", "r--", "rxw", 3]) {
      expect(parseClueDay({ ...base, reads })).toEqual(base);
    }
    expect(parseClueDay({ ...base, reads: "w-r" })).toEqual({ ...base, reads: "w-r" });
    expect(parseClueDay({ ...base, streak: -1, reads: "w-r" })).toBeNull();
  });

  it("grow by a step, from nothing on a fresh day, and stay away from a day kept without", () => {
    expect(addClueRead(null, true)).toBe("r");
    expect(addClueRead(run({}), null)).toBe("-");
    expect(addClueRead(run({ streak: 1, atlasRight: 1, atlasPlayed: 1, reads: "r" }), false)).toBe(
      "rw",
    );
    expect(addClueRead(run({ streak: 2, atlasRight: 1, atlasPlayed: 1 }), true)).toBeUndefined();
  });
});

describe("the run in words and squares", () => {
  const run = (streak: number, ended: ClueDay["ended"]): ClueDay => ({
    streak,
    atlasRight: 0,
    atlasPlayed: 0,
    ended,
  });

  it("names the clue a miss came on, from its place in the run's cycle", () => {
    expect(clueEndedOn(run(0, "miss"), CLUE_CYCLE)).toBe("road");
    expect(clueEndedOn(run(3, "miss"), CLUE_CYCLE)).toBe("ground");
    expect(clueEndedOn(run(4, "miss"), CLUE_CYCLE)).toBe("road");
    expect(clueEndedOn(run(5, "miss"), CLUE_CYCLE)).toBe("climate");
    expect(clueEndedOn(run(5, "cleared"), CLUE_CYCLE)).toBeNull();
    // Over three clues, as a day before the ground joined was played.
    expect(clueEndedOn(run(4, "miss"), THREE_CLUE_CYCLE)).toBe("climate");
    expect(clueEndedOn(run(5, "miss"), THREE_CLUE_CYCLE)).toBe("continent");
    expect(clueRunWords(run(7, "miss"), CLUE_CYCLE)).toBe("7 clues in a row, out on the ground");
    expect(clueRunWords(run(4, "miss"), THREE_CLUE_CYCLE)).toBe(
      "4 clues in a row, out on the climate",
    );
    expect(clueRunWords(run(1, "miss"), CLUE_CYCLE)).toBe("1 clue in a row, out on the climate");
    expect(clueRunWords(run(9, "cleared"), CLUE_CYCLE)).toBe("9 clues in a row, every clue");
    expect(clueRunWords(run(2, null), CLUE_CYCLE)).toBe("2 clues in a row");
  });

  it("puts the calls a row per turn of the cycle, under each clue's mark", () => {
    expect(clueRunLine(run(4, "miss"), CLUE_CYCLE)).toBe("🛣️🌦️🌍🌱\n🟩🟩🟩🟩\n🟥");
    expect(clueRunLine(run(3, "miss"), CLUE_CYCLE)).toBe("🛣️🌦️🌍🌱\n🟩🟩🟩🟥");
    expect(clueRunLine(run(0, "miss"), CLUE_CYCLE)).toBe("🛣️🌦️🌍🌱\n🟥");
    expect(clueRunLine(run(4, "miss"), THREE_CLUE_CYCLE)).toBe("🛣️🌦️🌍\n🟩🟩🟩\n🟩🟥");
    expect(clueRunLine(run(3, "cleared"), THREE_CLUE_CYCLE)).toBe("🛣️🌦️🌍\n🟩🟩🟩\n🏁");
  });

  it("caps a long run at 30 squares", () => {
    const line = clueRunLine(run(40, "miss"), CLUE_CYCLE);
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

  it("shares a day from the ground's first day four to a row, under its mark", () => {
    const text = clueDailyShare(
      "2026-11-18",
      { streak: 3, atlasRight: 2, atlasPlayed: 4, ended: "miss" },
      href,
    );
    expect(text).toBe(
      [
        "Whereabout · Clue mix · 2026-11-18",
        "🔀 3 clues in a row, out on the ground",
        "🛣️🌦️🌍🌱",
        "🟩🟩🟩🟥",
        "Atlas: 2 of 4",
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
