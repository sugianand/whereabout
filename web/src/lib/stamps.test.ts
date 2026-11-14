import { beforeEach, describe, expect, it } from "vitest";

import { rememberClimateDay } from "@/lib/game/climateDaily";
import { archiveDays } from "@/lib/game/dailyArchive";
import { rememberLeftRight } from "@/lib/game/leftRight";
import { EMPTY_TALLY, recordFreeRound, type Tally } from "@/lib/game/quickRecord";
import { rememberSideDay } from "@/lib/game/sideDaily";
import { rememberClimate, type ClimateResult } from "@/lib/game/whichClimate";
import { VERSUS_GAMES, type DayTally, type Versus } from "@/lib/game/today";

import { BADGE_IDS } from "./badges";
import { EMPTY_RECORD, type PlayerRecord } from "./playerRecord";
import type { PlayedPhoto } from "./playedMap";
import {
  CLUE_PHOTOS,
  FULL_WEEK,
  ROAD_READER_RUN,
  STAMPS_KEY,
  STAMP_IDS,
  atlasStampId,
  closestWords,
  collectStamps,
  countriesByContinent,
  keepStamps,
  loadClueSources,
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
      "beat-atlas-further-north",
      "beat-atlas-odd-one-out",
      "beat-atlas-which-way",
      "beat-atlas-how-far",
      "beat-atlas-name-country",
      "beat-atlas-hot-cold",
      "beat-atlas-line-up",
      "beat-atlas-close-up",
      "beat-atlas-left-right",
      "beat-atlas-which-climate",
      "beat-atlas-clue-mix",
      "road-reader",
      "climate-reader",
      "road-ahead",
      "climate-ahead",
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

const vs = (you: number, atlas: number, unit = "right"): Versus => ({
  you,
  atlas,
  unit,
  call: you > atlas ? "you" : you < atlas ? "atlas" : "level",
});

/** The days kept with these calls against Atlas, by days ago. */
function withCalls(calls: Record<number, DayTally["versus"]>): DayTally[] {
  return tallies(() => false).map((t, i) => ({ ...t, versus: calls[i] }));
}

describe("beat Atlas stamps", () => {
  it("has one per daily game Atlas can be called on, the Daily Five left out", () => {
    const stamps = readStamps(sources()).filter((s) => s.group === "atlas");
    expect(stamps.map((s) => s.id)).toEqual(VERSUS_GAMES.map((g) => atlasStampId(g.id)));
    expect(stamps.map((s) => s.id)).not.toContain("beat-atlas-daily-five");
    const close = byId(stamps, "beat-atlas-close-up");
    expect(close).toMatchObject({ name: "Beat Atlas: Close-up", icon: "🔍", progress: null });
    expect(close.note).toBeNull();
  });

  it("is earned on any day kept where you outscored Atlas at that game", () => {
    const stamps = readStamps(
      sources({
        tallies: withCalls({
          0: { "line-up": vs(14, 16, "in place") },
          // Weeks ago, but still kept.
          20: { "name-country": vs(4, 3), "line-up": vs(12, 12, "in place") },
        }),
      }),
    );
    expect(byId(stamps, "beat-atlas-name-country").earned).toBe(true);
    expect(byId(stamps, "beat-atlas-name-country").note).toBeNull();
    expect(byId(stamps, "beat-atlas-line-up").earned).toBe(false);
    expect(byId(stamps, "beat-atlas-further-north").earned).toBe(false);
  });

  it("says how close you came: the smallest gap, a level day above any loss", () => {
    const loss = readStamps(
      sources({
        tallies: withCalls({
          1: { "how-far": vs(3100, 4200, "points") },
          4: { "how-far": vs(3900, 4150, "points") },
          6: { "how-far": vs(1000, 4800, "points") },
        }),
      }),
    );
    expect(byId(loss, "beat-atlas-how-far").note).toBe(
      "Closest so far: 3,900 points to Atlas's 4,150",
    );
    const level = readStamps(
      sources({
        tallies: withCalls({ 0: { "which-way": vs(2, 3) }, 3: { "which-way": vs(4, 4) } }),
      }),
    );
    expect(byId(level, "beat-atlas-which-way").note).toBe("Level with Atlas so far: 4 right each");
  });

  it("words each unit", () => {
    expect(closestWords(vs(1, 2))).toBe("Closest so far: 1 right to Atlas's 2");
    expect(closestWords(vs(14, 17, "in place"))).toBe("Closest so far: 14 in place to Atlas's 17");
    expect(closestWords(vs(12, 12, "points"))).toBe("Level with Atlas so far: 12 points each");
  });

  it("stays once kept, after the day that earned it has aged out", () => {
    const won = readStamps(sources({ tallies: withCalls({ 29: { "hot-cold": vs(9, 8) } }) }));
    const first = collectStamps(won, {}, TODAY);
    expect(first.fresh).toEqual(["beat-atlas-hot-cold"]);
    const later = collectStamps(readStamps(sources()), first.kept, "2026-11-11");
    expect(byId(later.stamps, "beat-atlas-hot-cold").earned).toBe(true);
    expect(parseKeptStamps(JSON.stringify(first.kept))).toEqual(first.kept);
  });
});

const tally = (rounds: number, right: number, atlasPlayed: number, atlasRight: number): Tally => ({
  runs: 1,
  rounds,
  right,
  atlasPlayed,
  atlasRight,
});

const clues = (over: Partial<NonNullable<StampSources["clues"]>> = {}) =>
  sources({
    clues: { bestRun: 0, bestClimate: 0, road: EMPTY_TALLY, climate: EMPTY_TALLY, ...over },
  });

describe("clue stamps", () => {
  it("are all unearned with nothing played, counting toward a run and a whole game", () => {
    const stamps = readStamps(sources()).filter((s) => s.group === "clues");
    expect(stamps.map((s) => s.earned)).toEqual([false, false, false, false]);
    expect(byId(stamps, "road-reader").progress).toEqual({
      have: 0,
      need: ROAD_READER_RUN,
      unit: ["call in a row", "calls in a row"],
    });
    expect(byId(stamps, "climate-reader").progress?.need).toBe(5);
    expect(byId(stamps, "road-ahead").progress?.need).toBe(CLUE_PHOTOS);
    expect(stamps.every((s) => s.note === null)).toBe(true);
  });

  it("earns the road reader at a run of ten, not nine", () => {
    const nine = byId(readStamps(clues({ bestRun: 9 })), "road-reader");
    expect(nine.earned).toBe(false);
    expect(toGo(nine.progress!)).toBe("1 call in a row to go");
    expect(byId(readStamps(clues({ bestRun: 10 })), "road-reader").earned).toBe(true);
  });

  it("earns the climate reader for five of five, with the rate named until then", () => {
    const four = byId(
      readStamps(clues({ bestClimate: 4, climate: tally(20, 13, 18, 9) })),
      "climate-reader",
    );
    expect(four.earned).toBe(false);
    expect(four.progress?.have).toBe(4);
    expect(four.note).toBe("Right on 65% of the climates you've named");
    expect(byId(readStamps(clues({ bestClimate: 5 })), "climate-reader").earned).toBe(true);
  });

  it("earns a lead over Atlas only over thirty photos you both read", () => {
    // Ahead, but Atlas has read only 29 of your 40: not yet.
    const short = byId(readStamps(clues({ road: tally(40, 36, 29, 20) })), "road-ahead");
    expect(short.earned).toBe(false);
    expect(short.progress).toMatchObject({ have: 29, need: CLUE_PHOTOS });
    expect(short.note).toBe("So far: you 90%, Atlas 69%");
    expect(toGo(short.progress!)).toBe("1 photo read with Atlas to go");

    const ahead = byId(readStamps(clues({ road: tally(30, 25, 30, 22) })), "road-ahead");
    expect(ahead.earned).toBe(true);
    expect(ahead.progress).toBeNull();
  });

  it("has no progress left past thirty photos, only the gap to close, level or behind", () => {
    const behind = byId(readStamps(clues({ climate: tally(32, 20, 30, 24) })), "climate-ahead");
    expect(behind.earned).toBe(false);
    expect(behind.progress).toBeNull();
    expect(behind.note).toBe("Atlas is ahead of you by 17 points. Read on to pull ahead.");
    const level = byId(readStamps(clues({ climate: tally(30, 24, 30, 24) })), "climate-ahead");
    expect(level.earned).toBe(false);
    expect(level.note).toBe("You and Atlas are level. Read on to pull ahead.");
    // With no progress, it is never the stamp named next.
    expect(nextStamp([behind])).toBeNull();
  });

  it("are known ids that the store keeps", () => {
    const kept = collectStamps(readStamps(clues({ bestRun: 12 })), {}, TODAY).kept;
    expect(parseKeptStamps(JSON.stringify(kept))).toEqual({ "road-reader": TODAY });
  });
});

describe("loadClueSources", () => {
  beforeEach(() => localStorage.clear());

  const call = (id: string, picked: ClimateResult["picked"], truth: ClimateResult["truth"]) => ({
    id,
    picked,
    truth,
    correct: picked === truth,
    atlas: null,
  });

  it("is empty in a fresh browser", () => {
    const c = loadClueSources();
    expect(c).toEqual({ bestRun: 0, bestClimate: 0, road: EMPTY_TALLY, climate: EMPTY_TALLY });
  });

  it("takes the longer of the free best and a day's run, and only whole climate days", () => {
    rememberLeftRight(4);
    rememberSideDay("2026-11-09", { streak: 11, atlasRight: 8, atlasPlayed: 12, ended: "miss" });
    rememberClimate(3);
    // Today's game is four calls in, all right: not a whole game yet.
    rememberClimateDay(
      TODAY,
      ["a", "b", "c", "d"].map((id) => call(id, "Arid", "Arid")),
    );
    rememberClimateDay("2026-11-09", [
      call("a", "Arid", "Arid"),
      call("b", "Polar", "Polar"),
      call("c", "Tropical", "Tropical"),
      call("d", "Temperate", "Continental"),
      call("e", "Arid", "Arid"),
    ]);
    const c = loadClueSources();
    expect(c.bestRun).toBe(11);
    expect(c.bestClimate).toBe(4);
    // The day's run is in the road's record too: 11 right and the miss, Atlas on 12.
    expect(c.road).toMatchObject({ rounds: 12, right: 11, atlasPlayed: 12, atlasRight: 8 });
    expect(c.climate).toMatchObject({ rounds: 9, right: 8 });
  });

  it("counts free calls in the record", () => {
    recordFreeRound("left-right", { first: true, correct: true, atlas: false });
    recordFreeRound("left-right", { first: false, correct: false, atlas: true });
    expect(loadClueSources().road).toEqual(tally(2, 1, 2, 1));
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
