import { beforeEach, describe, expect, it } from "vitest";

import { bundledDeck } from "./bundled";
import { DAYS_KEPT, loadDailyRuns, rememberDailyRun, type DailyRun } from "./dailyRuns";
import { NORTH_DAILY_KEY, loadNorthDay } from "./northDaily";
import {
  ODD_DAILY_KEY,
  dailyOddDealer,
  loadOddDay,
  oddDailyShare,
  rememberOddDay,
} from "./oddDaily";
import { initialOdd, oddReducer } from "./oddOneOut";

const REGIONS = bundledDeck.regions;

function firstQuads(day: string, n: number) {
  const dealer = dailyOddDealer(REGIONS, day);
  return Array.from({ length: n }, () => dealer.next()!);
}

beforeEach(() => {
  localStorage.clear();
});

describe("dailyOddDealer", () => {
  it("deals the same quads for everyone on a day, and others the next day", () => {
    const today = firstQuads("2026-10-31", 6);
    expect(firstQuads("2026-10-31", 6)).toEqual(today);
    expect(firstQuads("2026-11-01", 6)).not.toEqual(today);
  });

  it("deals real quads: three photos from one continent and one from another", () => {
    for (const quad of firstQuads("2026-10-31", 12)) {
      expect(new Set(quad.ids).size).toBe(4);
      quad.ids.forEach((id, i) => {
        const continent = i === quad.odd ? quad.oddContinent : quad.common;
        expect(REGIONS[continent]).toContain(id);
      });
      expect(quad.oddContinent).not.toBe(quad.common);
    }
  });

  it("skips to the quad a run was on, as the nth draw of the day", () => {
    const quads = firstQuads("2026-10-31", 5);
    const dealer = dailyOddDealer(REGIONS, "2026-10-31");
    dealer.skip(3);
    expect(dealer.next()).toEqual(quads[3]);
    expect(dealer.next()).toEqual(quads[4]);
  });

  it("deals nothing from a deck with one continent", () => {
    expect(dailyOddDealer({ Europe: ["a", "b", "c", "d"] }, "2026-10-31").next()).toBeNull();
  });
});

describe("the kept days", () => {
  const going: DailyRun = { streak: 2, atlasRight: 1, atlasPlayed: 2, ended: null };

  it("keep today's run under its own key, apart from Further North's", () => {
    rememberOddDay("2026-10-31", going);
    expect(loadOddDay("2026-10-31")).toEqual(going);
    expect(loadOddDay("2026-10-30")).toBeNull();
    expect(loadNorthDay("2026-10-31")).toBeNull();
    expect(localStorage.getItem(NORTH_DAILY_KEY)).toBeNull();
    expect(Object.keys(JSON.parse(localStorage.getItem(ODD_DAILY_KEY)!))).toEqual(["2026-10-31"]);
  });

  it(`hold only the latest ${DAYS_KEPT} days and skip malformed ones`, () => {
    for (let d = 1; d <= DAYS_KEPT + 3; d++) {
      rememberDailyRun(
        ODD_DAILY_KEY,
        new Date(Date.UTC(2026, 8, d)).toISOString().slice(0, 10),
        going,
      );
    }
    expect(Object.keys(loadDailyRuns(ODD_DAILY_KEY))).toHaveLength(DAYS_KEPT);
    localStorage.setItem(
      ODD_DAILY_KEY,
      JSON.stringify({ "2026-10-31": going, "2026-10-30": { ...going, atlasRight: 5 } }),
    );
    expect(Object.keys(loadDailyRuns(ODD_DAILY_KEY))).toEqual(["2026-10-31"]);
  });
});

describe("oddDailyShare", () => {
  const href = "https://sugianand.github.io/whereabout/odd-one-out/daily/?a=1#b";

  it("is the day, a square a quad and Atlas's tally, with the page's bare address", () => {
    expect(
      oddDailyShare(
        "2026-10-31",
        { streak: 2, atlasRight: 1, atlasPlayed: 3, ended: "miss" },
        href,
      ),
    ).toBe(
      [
        "Whereabout · Odd one out · 2026-10-31",
        "🧩 2 quads in a row",
        "🟩🟩🟥",
        "Atlas: 1 of 3",
        "https://sugianand.github.io/whereabout/odd-one-out/daily/",
      ].join("\n"),
    );
  });

  it("says 1 quad, leaves Atlas out when it sat out, and names no photo", () => {
    const text = oddDailyShare(
      "2026-10-31",
      { streak: 1, atlasRight: 0, atlasPlayed: 0, ended: "miss" },
      href,
    );
    expect(text).toContain("🧩 1 quad in a row\n🟩🟥\n");
    expect(text).not.toContain("Atlas");
    for (const id of bundledDeck.ids) expect(text).not.toContain(id);
  });
});

describe("picking a run back up", () => {
  it("starts with the run's streak and Atlas's tally", () => {
    const [quad, upcoming] = firstQuads("2026-10-31", 2);
    const state = oddReducer(initialOdd, {
      type: "start",
      quad,
      upcoming,
      from: { streak: 3, atlasRight: 2, atlasPlayed: 3 },
    });
    expect(state).toMatchObject({ phase: "picking", streak: 3, atlasRight: 2, atlasPlayed: 3 });
    expect(oddReducer(initialOdd, { type: "start", quad, upcoming })).toMatchObject({ streak: 0 });
  });
});
