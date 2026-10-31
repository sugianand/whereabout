import { beforeEach, describe, expect, it } from "vitest";

import { bundledDeck } from "./bundled";
import { hashSeed, seededShuffle } from "./daily";
import { dailyNorthOrder } from "./northDaily";
import { initialWay, unfitPair, wayReducer, type WayState } from "./whichWay";
import {
  WAY_DAILY_KEY,
  dailyWayOrder,
  loadWayDay,
  rememberWayDay,
  resumeWayOrder,
  wayDailyShare,
} from "./wayDaily";

const IDS = Array.from({ length: 40 }, (_, i) => `p${i}`);
const PARIS = { lng: 2.35, lat: 48.86 };
const SUBURB = { lng: 2.45, lat: 48.9 };
const LONDON = { lng: -0.13, lat: 51.51 };
const TOKYO = { lng: 139.69, lat: 35.69 };

beforeEach(() => {
  localStorage.clear();
});

describe("dailyWayOrder", () => {
  it("deals the same journey for everyone on a day, and another the next day", () => {
    const today = dailyWayOrder(IDS, "2026-10-31");
    expect(dailyWayOrder([...IDS], "2026-10-31")).toEqual(today);
    expect(dailyWayOrder(IDS, "2026-11-01")).not.toEqual(today);
    expect([...today].sort()).toEqual([...IDS].sort());
    expect(dailyWayOrder(bundledDeck.ids, "2026-10-31").length).toBe(bundledDeck.ids.length);
  });

  it("is neither the Daily Five's nor today's Further North's order", () => {
    const today = dailyWayOrder(IDS, "2026-10-31");
    expect(today).not.toEqual(seededShuffle(IDS, hashSeed("whereabout:2026-10-31")));
    expect(today).not.toEqual(dailyNorthOrder(IDS, "2026-10-31"));
  });
});

describe("resumeWayOrder", () => {
  const order = ["a", "b", "c", "d", "e"];
  const going = { streak: 2, atlasRight: 1, atlasPlayed: 2, ended: null } as const;

  it("plays on from the photo the run stands at", () => {
    expect(resumeWayOrder(order, { ...going, at: "c" })).toEqual(["c", "d", "e"]);
  });

  it("plays the day from the start when nothing is kept or the photo is gone", () => {
    expect(resumeWayOrder(order, null)).toEqual(order);
    expect(resumeWayOrder(order, { ...going, at: "gone" })).toEqual(order);
    expect(resumeWayOrder(order, going)).toEqual(order);
  });

  it("resumes where the journey stood even after a stop was dealt again", () => {
    // London, then Paris, then a Paris suburb (one city with Paris, so it is dealt again), Tokyo.
    const day = ["london", "paris", "suburb", "tokyo"];
    const at = { london: LONDON, paris: PARIS, suburb: SUBURB, tokyo: TOKYO };
    const pick = (s: WayState, from: keyof typeof at, to: keyof typeof at) =>
      wayReducer(s, {
        type: "picked",
        point: "SE",
        from: at[from],
        to: at[to],
        atlasFrom: null,
        atlasTo: null,
      });

    expect(unfitPair(PARIS, SUBURB)).toBe(true);
    let s = wayReducer(initialWay, { type: "start", order: day });
    s = pick(s, "london", "paris");
    expect(s.phase === "answered" && s.verdict.correct).toBe(true);
    s = wayReducer(s, { type: "next" });
    s = wayReducer(s, { type: "redeal", id: "suburb" });
    expect(s.phase === "picking" && s.order[s.index + 1]).toBe("tokyo");

    // The run is kept standing in Paris; a reload deals from Paris to Tokyo, as the live run does.
    const kept = { streak: 1, atlasRight: 0, atlasPlayed: 0, ended: null, at: "paris" };
    const resumed = wayReducer(initialWay, {
      type: "start",
      order: resumeWayOrder(day, kept),
      from: kept,
    });
    expect(resumed.phase).toBe("picking");
    if (resumed.phase !== "picking") return;
    expect(resumed.order[resumed.index]).toBe("paris");
    expect(resumed.streak).toBe(1);
    // The suburb comes up next once more, and is dealt again by the same rule.
    const again = wayReducer(resumed, { type: "redeal", id: "suburb" });
    expect(again.phase === "picking" && again.order[again.index + 1]).toBe("tokyo");
  });
});

describe("the kept days", () => {
  it("keep where the run stands and read it back", () => {
    const entry = { streak: 3, atlasRight: 2, atlasPlayed: 3, ended: null, at: "p7" };
    rememberWayDay("2026-10-31", entry);
    expect(loadWayDay("2026-10-31")).toEqual(entry);
    expect(loadWayDay("2026-10-30")).toBeNull();
    expect(Object.keys(JSON.parse(localStorage.getItem(WAY_DAILY_KEY)!))).toEqual(["2026-10-31"]);
  });

  it("skip a day whose photo isn't a photo id", () => {
    for (const at of ["", 7, null]) {
      localStorage.setItem(
        WAY_DAILY_KEY,
        JSON.stringify({
          "2026-10-31": { streak: 1, atlasRight: 0, atlasPlayed: 0, ended: null, at },
        }),
      );
      expect(loadWayDay("2026-10-31")).toBeNull();
    }
  });
});

describe("wayDailyShare", () => {
  const href = "https://sugianand.github.io/whereabout/which-way/daily/?x=1#y";

  it("is counts only: the day, a square a stop, the miss and Atlas's tally", () => {
    const line = wayDailyShare(
      "2026-10-31",
      { streak: 3, atlasRight: 2, atlasPlayed: 3, ended: "miss", at: "p7" },
      href,
    );
    expect(line).toBe(
      [
        "Whereabout · Which way? · 2026-10-31",
        "🧭 3 stops in a row",
        "🟩🟩🟩🟥",
        "Atlas: 2 of 3",
        "https://sugianand.github.io/whereabout/which-way/daily/",
      ].join("\n"),
    );
    expect(line).not.toContain("p7");
  });

  it("says one stop, flags a journey through every photo, and leaves Atlas out when it sat out", () => {
    const one = wayDailyShare(
      "2026-10-31",
      { streak: 1, atlasRight: 0, atlasPlayed: 0, ended: "cleared" },
      href,
    );
    expect(one).toContain("🧭 1 stop in a row, every photo\n🟩🏁\n");
    expect(one).not.toContain("Atlas");
  });
});
