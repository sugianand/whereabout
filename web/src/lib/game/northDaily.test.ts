import { beforeEach, describe, expect, it } from "vitest";

import { bundledDeck } from "./bundled";
import { hashSeed, seededShuffle } from "./daily";
import { initialNorth, northReducer } from "./furtherNorth";
import {
  NORTH_DAILY_KEY,
  NORTH_DAYS_KEPT,
  dailyNorthOrder,
  loadNorthDay,
  loadNorthDays,
  northDailyShare,
  northDailyUrl,
  northToday,
  parseNorthDay,
  rememberNorthDay,
  untilNextNorth,
  type NorthDay,
} from "./northDaily";

const IDS = Array.from({ length: 40 }, (_, i) => `p${i}`);

beforeEach(() => {
  localStorage.clear();
});

describe("dailyNorthOrder", () => {
  it("deals the same order for everyone on a day, and another order the next day", () => {
    const today = dailyNorthOrder(IDS, "2026-10-31");
    expect(dailyNorthOrder([...IDS], "2026-10-31")).toEqual(today);
    expect(dailyNorthOrder(IDS, "2026-11-01")).not.toEqual(today);
    expect([...today].sort()).toEqual([...IDS].sort());
  });

  it("is not the Daily Five's order for the same day", () => {
    // The Daily Five's seed is `whereabout:<day>`; this run's own seed keeps the two apart.
    expect(dailyNorthOrder(IDS, "2026-10-31")).not.toEqual(
      seededShuffle(IDS, hashSeed("whereabout:2026-10-31")),
    );
    expect(dailyNorthOrder(bundledDeck.ids, "2026-10-31").length).toBe(bundledDeck.ids.length);
  });
});

describe("northToday and untilNextNorth", () => {
  it("count the UTC day, whatever the local clock", () => {
    expect(northToday(new Date("2026-10-31T23:59:00Z"))).toBe("2026-10-31");
    expect(northToday(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11-01");
    expect(untilNextNorth(new Date("2026-10-31T18:48:00Z"))).toBe("5h 12m");
    expect(untilNextNorth(new Date("2026-10-31T23:59:30Z"))).toBe("1m");
  });
});

describe("the kept days", () => {
  const going: NorthDay = { streak: 3, atlasRight: 2, atlasPlayed: 3, ended: null };

  it("keep a run per day and read it back", () => {
    rememberNorthDay("2026-10-31", going);
    rememberNorthDay("2026-10-30", { ...going, ended: "miss" });
    expect(loadNorthDay("2026-10-31")).toEqual(going);
    expect(loadNorthDay("2026-10-30")?.ended).toBe("miss");
    expect(loadNorthDay("2026-10-29")).toBeNull();
  });

  it(`hold only the latest ${NORTH_DAYS_KEPT} days`, () => {
    for (let d = 1; d <= NORTH_DAYS_KEPT + 5; d++) {
      const day = new Date(Date.UTC(2026, 8, d)).toISOString().slice(0, 10);
      rememberNorthDay(day, going);
    }
    const days = Object.keys(loadNorthDays()).sort();
    expect(days).toHaveLength(NORTH_DAYS_KEPT);
    expect(days[0]).toBe("2026-09-06");
  });

  it("skip anything not in the shape they are written in", () => {
    localStorage.setItem(
      NORTH_DAILY_KEY,
      JSON.stringify({
        "2026-10-31": going,
        "2026-10-30": { ...going, streak: -1 },
        "2026-10-29": { ...going, atlasRight: 9 },
        "2026-10-28": { ...going, ended: "won" },
        "2026-02-30": going,
        "not a day": going,
      }),
    );
    expect(Object.keys(loadNorthDays())).toEqual(["2026-10-31"]);
    localStorage.setItem(NORTH_DAILY_KEY, "[1,2]");
    expect(loadNorthDays()).toEqual({});
    localStorage.setItem(NORTH_DAILY_KEY, "{oops");
    expect(loadNorthDays()).toEqual({});
    expect(parseNorthDay(null)).toBeNull();
    expect(parseNorthDay({ ...going, streak: 1.5 })).toBeNull();
  });
});

describe("northDailyShare", () => {
  const href = "https://sugianand.github.io/whereabout/further-north/daily/?x=1#y";

  it("is the day, a square a pair and Atlas's tally, with the page's bare address", () => {
    expect(
      northDailyShare(
        "2026-10-31",
        { streak: 3, atlasRight: 2, atlasPlayed: 4, ended: "miss" },
        href,
      ),
    ).toBe(
      [
        "Whereabout · Further North · 2026-10-31",
        "⬆️ 3 pairs in a row",
        "🟩🟩🟩🟥",
        "Atlas: 2 of 4",
        "https://sugianand.github.io/whereabout/further-north/daily/",
      ].join("\n"),
    );
  });

  it("marks a cleared run, says 1 pair, leaves Atlas out when it sat out, and caps the squares", () => {
    const cleared = northDailyShare(
      "2026-10-31",
      { streak: 1, atlasRight: 0, atlasPlayed: 0, ended: "cleared" },
      href,
    );
    expect(cleared).toContain("⬆️ 1 pair in a row, every photo\n🟩🏁\n");
    expect(cleared).not.toContain("Atlas");
    const long = northDailyShare(
      "2026-10-31",
      { streak: 45, atlasRight: 0, atlasPlayed: 1, ended: "miss" },
      href,
    );
    expect(long).toContain(`${"🟩".repeat(30)}…🟥`);
  });

  it("never carries a place, a country or a photo id", () => {
    const text = northDailyShare(
      "2026-10-31",
      { streak: 12, atlasRight: 7, atlasPlayed: 11, ended: "miss" },
      href,
    );
    for (const id of bundledDeck.ids) expect(text).not.toContain(id);
    expect(northDailyUrl("https://x.test/a/?daily=1#h")).toBe("https://x.test/a/");
  });
});

describe("picking a run back up", () => {
  it("starts on the pair after the last right pick, with the run's tallies", () => {
    const order = ["a", "b", "c", "d"];
    const state = northReducer(initialNorth, {
      type: "start",
      order,
      from: { streak: 2, atlasRight: 1, atlasPlayed: 2 },
    });
    expect(state).toMatchObject({ phase: "picking", index: 2, streak: 2, atlasRight: 1 });
    const done = northReducer(initialNorth, {
      type: "start",
      order,
      from: { streak: 3, atlasRight: 0, atlasPlayed: 0 },
    });
    expect(done.phase).toBe("cleared");
  });
});
