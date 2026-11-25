import { beforeEach, describe, expect, it } from "vitest";

import { bundledFooledIds } from "./bundled";
import { hashSeed, seededShuffle } from "./daily";
import { fooledReducer, initialFooled } from "./fooledAtlas";
import {
  FOOLED_DAILY_KEY,
  FOOLED_DAYS_KEPT,
  dailyFooledOrder,
  fooledDailyShare,
  fooledToday,
  loadFooledDay,
  loadFooledDays,
  rememberFooledDay,
  untilNextFooled,
  type FooledDay,
} from "./fooledDaily";
import { dailyNorthOrder } from "./northDaily";

const IDS = Array.from({ length: 40 }, (_, i) => `p${i}`);

beforeEach(() => {
  localStorage.clear();
});

describe("dailyFooledOrder", () => {
  it("deals the same order for everyone on a day, and another order the next day", () => {
    const today = dailyFooledOrder(IDS, "2026-11-26");
    expect(dailyFooledOrder([...IDS], "2026-11-26")).toEqual(today);
    expect(dailyFooledOrder(IDS, "2026-11-27")).not.toEqual(today);
    expect([...today].sort()).toEqual([...IDS].sort());
  });

  it("is neither the Daily Five's nor Further North's order for the same day", () => {
    const day = "2026-11-26";
    expect(dailyFooledOrder(IDS, day)).not.toEqual(
      seededShuffle(IDS, hashSeed(`whereabout:${day}`)),
    );
    expect(dailyFooledOrder(IDS, day)).not.toEqual(dailyNorthOrder(IDS, day));
  });

  it("deals every photo Atlas pinned in the real catalog", () => {
    const order = dailyFooledOrder(bundledFooledIds, "2026-11-26");
    expect(order.length).toBe(bundledFooledIds.length);
    expect(order.length).toBeGreaterThanOrEqual(2);
  });
});

describe("fooledToday and untilNextFooled", () => {
  it("count the UTC day, whatever the local clock", () => {
    expect(fooledToday(new Date("2026-11-26T23:59:00Z"))).toBe("2026-11-26");
    expect(fooledToday(new Date("2026-11-27T00:00:00Z"))).toBe("2026-11-27");
    expect(untilNextFooled(new Date("2026-11-26T18:48:00Z"))).toBe("5h 12m");
  });
});

describe("the kept days", () => {
  const going: FooledDay = { streak: 3, atlasRight: 2, atlasPlayed: 3, ended: null };

  it("keep a run per day and read it back", () => {
    rememberFooledDay("2026-11-26", going);
    rememberFooledDay("2026-11-25", { ...going, ended: "miss" });
    expect(loadFooledDay("2026-11-26")).toEqual(going);
    expect(loadFooledDay("2026-11-25")?.ended).toBe("miss");
    expect(loadFooledDay("2026-11-24")).toBeNull();
  });

  it(`hold only the latest ${FOOLED_DAYS_KEPT} days`, () => {
    for (let d = 1; d <= FOOLED_DAYS_KEPT + 5; d++) {
      const day = new Date(Date.UTC(2026, 8, d)).toISOString().slice(0, 10);
      rememberFooledDay(day, going);
    }
    const days = Object.keys(loadFooledDays()).sort();
    expect(days).toHaveLength(FOOLED_DAYS_KEPT);
    expect(days[0]).toBe("2026-09-06");
  });

  it("skip anything not in the shape they are written in", () => {
    localStorage.setItem(
      FOOLED_DAILY_KEY,
      JSON.stringify({
        "2026-11-26": going,
        "2026-11-25": { ...going, streak: -1 },
        "2026-11-24": { ...going, atlasRight: 9 },
        "2026-11-23": { ...going, ended: "won" },
        "not-a-day": going,
      }),
    );
    expect(loadFooledDays()).toEqual({ "2026-11-26": going });
    localStorage.setItem(FOOLED_DAILY_KEY, "{not json");
    expect(loadFooledDays()).toEqual({});
  });
});

describe("picking the run back up", () => {
  it("starts at the pair after the streak, with Atlas's tally so far", () => {
    const order = ["a", "b", "c", "d"];
    const from = { streak: 2, atlasRight: 1, atlasPlayed: 2 };
    const state = fooledReducer(initialFooled, { type: "start", order, from });
    expect(state).toMatchObject({ phase: "picking", index: 2, ...from });
  });

  it("is cleared when the kept streak already reaches the last photo", () => {
    const from = { streak: 3, atlasRight: 0, atlasPlayed: 0 };
    const state = fooledReducer(initialFooled, {
      type: "start",
      order: ["a", "b", "c", "d"],
      from,
    });
    expect(state.phase).toBe("cleared");
  });
});

describe("fooledDailyShare", () => {
  const href = "https://sugianand.github.io/whereabout/fooled-atlas/daily/?x=1#top";

  it("is the day, the streak as squares and Atlas's own pick, with the bare link", () => {
    const entry: FooledDay = { streak: 2, atlasRight: 1, atlasPlayed: 3, ended: "miss" };
    expect(fooledDailyShare("2026-11-26", entry, href)).toBe(
      [
        "Whereabout · Which fooled Atlas? · 2026-11-26",
        "🤖 2 pairs in a row",
        "🟩🟩🟥",
        "Atlas's own pick: 1 of 3",
        "https://sugianand.github.io/whereabout/fooled-atlas/daily/",
      ].join("\n"),
    );
  });

  it("flags a cleared day and leaves Atlas out when it sat every pair out", () => {
    const entry: FooledDay = { streak: 1, atlasRight: 0, atlasPlayed: 0, ended: "cleared" };
    const text = fooledDailyShare("2026-11-26", entry, href);
    expect(text).toContain("🤖 1 pair in a row, every photo\n🟩🏁\n");
    expect(text).not.toContain("Atlas's own pick");
  });
});
