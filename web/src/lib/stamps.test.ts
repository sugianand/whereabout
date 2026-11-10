import { describe, expect, it } from "vitest";

import { archiveDays } from "@/lib/game/dailyArchive";
import type { DayTally } from "@/lib/game/today";

import { BADGE_IDS } from "./badges";
import { EMPTY_RECORD, type PlayerRecord } from "./playerRecord";
import type { PlayedPhoto } from "./playedMap";
import {
  FULL_WEEK,
  STAMPS_KEY,
  STAMP_IDS,
  collectStamps,
  countriesByContinent,
  keepStamps,
  loadKeptStamps,
  longestFullRun,
  nextStamp,
  parseKeptStamps,
  readStamps,
  toGo,
  type Stamp,
  type StampSources,
  type StampStore,
} from "./stamps";

const TODAY = "2026-11-10";
const NOW = new Date(`${TODAY}T15:00:00Z`);

const COUNTRIES = {
  Oceania: ["AU", "NZ", "PF"],
  Europe: ["DE", "FR", "GB", "IT", "PT"],
  Africa: ["MA"],
};

function played(country: string | null, km: number | null = 500, id = `p-${country}`): PlayedPhoto {
  return { id, lng: 0, lat: 0, place: "Somewhere", country, km, score: 1000, day: TODAY };
}

/** The days kept, newest first (i = 0 is today), with every game finished where `full(i)`. */
function tallies(full: (i: number) => boolean, of = 9): DayTally[] {
  return archiveDays(TODAY).map((day, i) => ({ day, done: full(i) ? of : 2, of }));
}

function sources(over: Partial<StampSources> = {}): StampSources {
  return {
    record: EMPTY_RECORD,
    played: [],
    tallies: tallies(() => false),
    countries: COUNTRIES,
    now: NOW,
    ...over,
  };
}

const byId = (stamps: Stamp[], id: string) => {
  const s = stamps.find((x) => x.id === id);
  if (!s) throw new Error(`no stamp ${id}`);
  return s;
};

describe("readStamps", () => {
  it("lists every badge, a stamp per continent the game deals, and the full days", () => {
    const stamps = readStamps(sources());
    expect(stamps.map((s) => s.id)).toEqual([
      ...BADGE_IDS,
      "cleared-africa",
      "cleared-europe",
      "cleared-oceania",
      "full-day",
      "full-week",
    ]);
    expect(stamps.every((s) => !s.earned)).toBe(true);
    // Every id read is one the store accepts.
    for (const s of stamps) expect(STAMP_IDS).toContain(s.id);
  });

  it("shows the badges the record holds, with progress toward the rest", () => {
    const record: PlayerRecord = {
      ...EMPTY_RECORD,
      games: 4,
      roundsVsAtlas: 10,
      roundsWon: 3,
      lastDaily: "2026-11-09",
      streak: 2,
      bestStreak: 4,
      continents: {
        Europe: { rounds: 4, vsAtlas: 4, won: 2 },
        Asia: { rounds: 2, vsAtlas: 2, won: 1 },
      },
      badges: ["first-win"],
    };
    const stamps = readStamps(sources({ record, played: [played("FR", 812.4), played("DE", 96)] }));
    expect(byId(stamps, "first-win").earned).toBe(true);
    const five = byId(stamps, "daily-five");
    expect(five.progress).toMatchObject({ have: 2, need: 5 });
    expect(five.note).toBe("Best run so far: 4 days");
    expect(byId(stamps, "globetrotter").progress).toMatchObject({ have: 2, need: 6 });
    expect(byId(stamps, "bullseye").note).toBe("Closest pin so far: 96 km");
    expect(byId(stamps, "hard-won").progress).toBeNull();
  });

  it("counts a broken Daily Five run as none, and gives the closest pin in the player's units", () => {
    const record = { ...EMPTY_RECORD, lastDaily: "2026-11-01", streak: 3, bestStreak: 3 };
    const stamps = readStamps(sources({ record, played: [played("FR", 160.9344)], units: "mi" }));
    expect(byId(stamps, "daily-five").progress).toMatchObject({ have: 0 });
    expect(byId(stamps, "bullseye").note).toBe("Closest pin so far: 100 mi");
  });

  it("clears a continent once a photo from each of its countries is pinned", () => {
    const stamps = readStamps(
      sources({
        played: [
          played("AU"),
          played("NZ"),
          played("PF"),
          played("FR"),
          played(null),
          played("US"),
        ],
      }),
    );
    const oceania = byId(stamps, "cleared-oceania");
    expect(oceania.earned).toBe(true);
    expect(oceania.name).toBe("Oceania cleared");
    expect(oceania.how).toBe("Pin a photo from each of the 3 countries the game has in Oceania");
    const europe = byId(stamps, "cleared-europe");
    expect(europe.earned).toBe(false);
    expect(europe.progress).toMatchObject({ have: 1, need: 5 });
    // Four left is too many to name.
    expect(europe.note).toBeNull();
  });

  it("names the last few countries left, in alphabetical order", () => {
    const stamps = readStamps(sources({ played: [played("DE"), played("PT")] }));
    expect(byId(stamps, "cleared-europe").note).toBe(
      "Still to play: France, Italy, United Kingdom",
    );
  });

  it("skips a continent the game deals no photo from", () => {
    const ids = readStamps(sources({ countries: { Europe: ["FR"] } })).map((s) => s.id);
    expect(ids).toContain("cleared-europe");
    expect(ids).not.toContain("cleared-asia");
  });

  it("earns a full day on any day kept, and a full week on seven in a row", () => {
    const one = readStamps(sources({ tallies: tallies((i) => i === 12) }));
    expect(byId(one, "full-day").earned).toBe(true);
    expect(byId(one, "full-week").earned).toBe(false);

    const week = readStamps(sources({ tallies: tallies((i) => i >= 3 && i < 3 + FULL_WEEK) }));
    expect(byId(week, "full-week").earned).toBe(true);
    const six = readStamps(sources({ tallies: tallies((i) => i >= 3 && i < 2 + FULL_WEEK) }));
    expect(byId(six, "full-week").earned).toBe(false);
  });

  it("counts today's games and the run of full days toward the next", () => {
    // Today not finished yet: the run up to yesterday still counts.
    const stamps = readStamps(sources({ tallies: tallies((i) => i >= 1 && i <= 3) }));
    expect(byId(stamps, "full-day").progress).toMatchObject({ have: 2, need: 9 });
    expect(byId(stamps, "full-week").progress).toMatchObject({ have: 3, need: FULL_WEEK });
    const withToday = readStamps(sources({ tallies: tallies((i) => i <= 3) }));
    expect(byId(withToday, "full-week").progress).toMatchObject({ have: 4 });
  });
});

describe("longestFullRun", () => {
  it("finds the longest run of finished days anywhere in the window", () => {
    const t = tallies((i) => [1, 2, 5, 6, 7, 8].includes(i));
    expect(longestFullRun(t)).toBe(4);
    expect(longestFullRun([])).toBe(0);
    // A day with no games dealt is never full.
    expect(longestFullRun([{ day: TODAY, done: 0, of: 0 }])).toBe(0);
  });
});

describe("kept stamps", () => {
  it("keeps a stamp from the day it is first earned, and marks it new only then", () => {
    const stamps = readStamps(sources({ played: [played("MA")] }));
    const first = collectStamps(stamps, {}, TODAY);
    expect(first.fresh).toEqual(["cleared-africa"]);
    expect(first.kept).toEqual({ "cleared-africa": TODAY });
    const again = collectStamps(stamps, first.kept, "2026-11-11");
    expect(again.fresh).toEqual([]);
    expect(again.kept).toEqual({ "cleared-africa": TODAY });
  });

  it("keeps a stamp earned once even after its proof has aged out", () => {
    const stamps = readStamps(sources());
    const { stamps: out, fresh } = collectStamps(stamps, { "full-week": "2026-10-01" }, TODAY);
    expect(byId(out, "full-week").earned).toBe(true);
    expect(fresh).toEqual([]);
  });

  it("reads back only known stamps with real days", () => {
    expect(parseKeptStamps(null)).toEqual({});
    expect(parseKeptStamps("not json")).toEqual({});
    expect(parseKeptStamps("[1,2]")).toEqual({});
    expect(
      parseKeptStamps(
        JSON.stringify({
          "full-day": "2026-11-02",
          "cleared-atlantis": "2026-11-02",
          bullseye: "yesterday",
          "first-win": 3,
        }),
      ),
    ).toEqual({ "full-day": "2026-11-02" });
  });

  it("writes new stamps, and plays on when storage throws", () => {
    const data = new Map<string, string>();
    const store: StampStore = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
    };
    const stamps = readStamps(sources({ played: [played("MA")] }));
    expect(keepStamps(stamps, TODAY, store).fresh).toEqual(["cleared-africa"]);
    expect(JSON.parse(data.get(STAMPS_KEY)!)).toEqual({ "cleared-africa": TODAY });
    expect(loadKeptStamps(store)).toEqual({ "cleared-africa": TODAY });

    const broken: StampStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const out = keepStamps(stamps, TODAY, broken);
    expect(byId(out.stamps, "cleared-africa").earned).toBe(true);
    expect(loadKeptStamps(null)).toEqual({});
  });
});

describe("nextStamp", () => {
  it("picks the unearned stamp closest to done, skipping all-or-nothing stamps", () => {
    const stamps = readStamps(sources({ played: [played("AU"), played("NZ"), played("DE")] }));
    const next = nextStamp(stamps);
    expect(next?.id).toBe("cleared-oceania");
    expect(toGo(next!.progress!)).toBe("1 country to go");
  });

  it("is null once every stamp with progress is earned", () => {
    const stamps = readStamps(sources()).map((s) => ({ ...s, earned: true }));
    expect(nextStamp(stamps)).toBeNull();
  });
});

describe("countriesByContinent", () => {
  it("groups each country once under its continent, sorted, ignoring unknowns", () => {
    expect(countriesByContinent(["NZ", "AU", "NZ", null, undefined, "ZZ", "FR"])).toEqual({
      Oceania: ["AU", "NZ"],
      Europe: ["FR"],
    });
  });
});
