import { beforeEach, describe, expect, it } from "vitest";

import {
  BEST_BULLSEYE_KEY,
  BEST_TIGHT_KEY,
  settleBet,
  type BullseyeRound,
} from "@/lib/game/bullseye";
import {
  addRound,
  emptyCalibration,
  recordBullseyeRound,
  type Calibration,
} from "@/lib/game/bullseyeCalibration";
import { rememberBullseyeDay } from "@/lib/game/bullseyeDaily";
import { rememberClimateDay } from "@/lib/game/climateDaily";
import { archiveDays } from "@/lib/game/dailyArchive";
import { rememberGroundDay } from "@/lib/game/groundDaily";
import { rememberLeftRight } from "@/lib/game/leftRight";
import { rememberGround, type GroundResult } from "@/lib/game/onTheGround";
import { EMPTY_TALLY, recordFreeRound, type Tally } from "@/lib/game/quickRecord";
import { rememberSideDay } from "@/lib/game/sideDaily";
import { BEST_HOTTEST_KEY, type SpotResult } from "@/lib/game/spotClue";
import { rememberSpotDay } from "@/lib/game/spotDaily";
import { recordSpotRead } from "@/lib/game/spotRead";
import type { AtlasLooked } from "@/lib/game/types";
import { rememberClimate, type ClimateResult } from "@/lib/game/whichClimate";
import { VERSUS_GAMES, type DayTally, type Versus } from "@/lib/game/today";

import { BADGE_IDS } from "./badges";
import { EMPTY_RECORD, type PlayerRecord } from "./playerRecord";
import type { PlayedPhoto } from "./playedMap";
import { addLeg, type TourRecord } from "./tour";
import {
  BULLSEYE_CALIBRATION_PHOTOS,
  CLUE_PHOTOS,
  FULL_WEEK,
  ROAD_READER_RUN,
  STAMPS_KEY,
  SPOT_FOUND_STAMP,
  STAMP_IDS,
  albumPageStampId,
  albumShareNeed,
  atlasStampId,
  closestWords,
  tourLegStampId,
  collectStamps,
  countriesByContinent,
  keepStamps,
  loadBullseyeSources,
  loadClueSources,
  loadSpotSources,
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
      "beat-atlas-on-the-ground",
      "beat-atlas-bullseye",
      "beat-atlas-trust-atlas",
      "road-reader",
      "climate-reader",
      "ground-reader",
      "road-ahead",
      "climate-ahead",
      "ground-ahead",
      "bullseye-five-tight",
      "bullseye-calibrated",
      "spot-mind-reader",
      "spot-found",
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
    clues: {
      bestRun: 0,
      bestClimate: 0,
      bestGround: 0,
      road: EMPTY_TALLY,
      climate: EMPTY_TALLY,
      ground: EMPTY_TALLY,
      ...over,
    },
  });

describe("clue stamps", () => {
  it("are all unearned with nothing played, counting toward a run and a whole game", () => {
    const stamps = readStamps(sources()).filter((s) => s.group === "clues");
    expect(stamps.map((s) => s.earned)).toEqual([false, false, false, false, false, false]);
    expect(byId(stamps, "road-reader").progress).toEqual({
      have: 0,
      need: ROAD_READER_RUN,
      unit: ["call in a row", "calls in a row"],
    });
    expect(byId(stamps, "climate-reader").progress?.need).toBe(5);
    expect(byId(stamps, "ground-reader").progress).toEqual({
      have: 0,
      need: 5,
      unit: ["photo right", "photos right"],
    });
    expect(byId(stamps, "ground-ahead").progress?.need).toBe(CLUE_PHOTOS);
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

  it("earns the ground reader for five of five, with the rate named until then", () => {
    const four = byId(
      readStamps(clues({ bestGround: 4, ground: tally(16, 12, 6, 3) })),
      "ground-reader",
    );
    expect(four.earned).toBe(false);
    expect(four.progress?.have).toBe(4);
    expect(toGo(four.progress!)).toBe("1 photo right to go");
    expect(four.note).toBe("Right on 75% of the covers you've named");
    // The climate's five of five earns nothing here, nor the ground's the climate reader.
    const climate = readStamps(clues({ bestClimate: 5 }));
    expect(byId(climate, "ground-reader").earned).toBe(false);
    const ground = readStamps(clues({ bestGround: 5, ground: tally(5, 5, 2, 1) }));
    expect(byId(ground, "ground-reader").earned).toBe(true);
    expect(byId(ground, "ground-reader").note).toBeNull();
    expect(byId(ground, "climate-reader").earned).toBe(false);
  });

  it("earns the ground ahead of Atlas by the same rule as the other clues", () => {
    // Atlas reads only some covers: ahead over 40 photos, but it has read only 29 of them.
    const short = byId(readStamps(clues({ ground: tally(40, 30, 29, 15) })), "ground-ahead");
    expect(short.earned).toBe(false);
    expect(short.progress).toMatchObject({ have: 29, need: CLUE_PHOTOS });
    expect(short.note).toBe("So far: you 75%, Atlas 52%");
    const ahead = byId(readStamps(clues({ ground: tally(45, 33, 30, 18) })), "ground-ahead");
    expect(ahead.earned).toBe(true);
    expect(ahead.progress).toBeNull();
    const behind = byId(readStamps(clues({ ground: tally(30, 15, 30, 21) })), "ground-ahead");
    expect(behind.earned).toBe(false);
    expect(behind.note).toBe("Atlas is ahead of you by 20 points. Read on to pull ahead.");
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

describe("album stamps", () => {
  // Nine photos: four in Europe, three in Asia, two in Oceania.
  const ALBUM = {
    e1: "Europe",
    e2: "Europe",
    e3: "Europe",
    e4: "Europe",
    a1: "Asia",
    a2: "Asia",
    a3: "Asia",
    o1: "Oceania",
    o2: "Oceania",
  } as const;
  const found = (...ids: string[]) => ids.map((id) => played("FR", 500, id));
  const albumOf = (stamps: Stamp[]) => stamps.filter((s) => s.group === "album");

  it("needs at least one photo for every share, rounding a share up", () => {
    expect(albumShareNeed(9, 1 / 4)).toBe(3);
    expect(albumShareNeed(9, 1 / 2)).toBe(5);
    expect(albumShareNeed(9, 1)).toBe(9);
    expect(albumShareNeed(8, 1 / 4)).toBe(2);
    expect(albumShareNeed(1, 1 / 4)).toBe(1);
  });

  it("lists the shares, then a page per continent the album has, none earned at first", () => {
    const stamps = albumOf(readStamps(sources({ album: ALBUM })));
    expect(stamps.map((s) => s.id)).toEqual([
      "album-quarter",
      "album-half",
      "album-whole",
      "album-asia-page",
      "album-europe-page",
      "album-oceania-page",
    ]);
    expect(stamps.every((s) => !s.earned)).toBe(true);
    expect(byId(stamps, "album-quarter").how).toBe("Find 3 of the 9 photos the game deals");
    expect(byId(stamps, "album-whole").how).toBe(
      "Find all 9 photos the game deals, on every continent",
    );
    expect(byId(stamps, "album-europe-page").how).toBe(
      "Find all 4 photos the game deals in Europe",
    );
    expect(byId(stamps, "album-europe-page").progress).toEqual({
      have: 0,
      need: 4,
      unit: ["photo found", "photos found"],
    });
    for (const s of stamps) expect(STAMP_IDS).toContain(s.id);
  });

  it("counts finds as the album does: once per photo, and only photos it still deals", () => {
    // o1 twice, a photo the album no longer holds and a pin with no id in the album.
    const stamps = albumOf(
      readStamps(sources({ album: ALBUM, played: found("o1", "o1", "gone", "e1", "o2") })),
    );
    expect(byId(stamps, "album-quarter").earned).toBe(true);
    expect(byId(stamps, "album-half").progress).toMatchObject({ have: 3, need: 5 });
    expect(byId(stamps, "album-whole").progress).toMatchObject({ have: 3, need: 9 });
    expect(byId(stamps, "album-oceania-page").earned).toBe(true);
    expect(byId(stamps, "album-europe-page").progress).toMatchObject({ have: 1, need: 4 });
    expect(byId(stamps, "album-asia-page").earned).toBe(false);
  });

  it("earns every album stamp once every photo is found", () => {
    const stamps = albumOf(
      readStamps(sources({ album: ALBUM, played: found(...Object.keys(ALBUM)) })),
    );
    expect(stamps).toHaveLength(6);
    expect(stamps.every((s) => s.earned)).toBe(true);
    // The quarter's progress never runs past what it asks.
    expect(byId(stamps, "album-quarter").progress).toMatchObject({ have: 3, need: 3 });
  });

  it("has no album stamps without an album, and a page id for every continent", () => {
    expect(albumOf(readStamps(sources()))).toEqual([]);
    expect(albumOf(readStamps(sources({ album: {} })))).toEqual([]);
    expect(albumPageStampId("North America")).toBe("album-north-america-page");
    expect(STAMP_IDS).toContain("album-antarctica-page");
  });

  it("keeps an album stamp once earned, after its photos leave the history", () => {
    const earned = readStamps(sources({ album: ALBUM, played: found("o1", "o2") }));
    const first = collectStamps(earned, {}, TODAY);
    expect(first.fresh).toContain("album-oceania-page");
    const later = collectStamps(readStamps(sources({ album: ALBUM })), first.kept, "2026-12-01");
    expect(byId(later.stamps, "album-oceania-page").earned).toBe(true);
    expect(later.fresh).toEqual([]);
    expect(parseKeptStamps(JSON.stringify(first.kept))["album-oceania-page"]).toBe(TODAY);
  });
});

describe("tour stamps", () => {
  const ROUTE = ["Europe", "Africa", "Asia"] as const;
  const tourOf = (record: TourRecord) =>
    readStamps(sources({ tour: { route: ROUTE, record } })).filter((s) => s.group === "tour");

  it("lists a leg per stop in route order, then the whole tour, none earned at first", () => {
    const stamps = tourOf({});
    expect(stamps.map((s) => s.id)).toEqual([
      "tour-europe",
      "tour-africa",
      "tour-asia",
      "tour-complete",
    ]);
    expect(stamps.every((s) => !s.earned)).toBe(true);
    expect(byId(stamps, "tour-asia")).toMatchObject({
      name: "Asia leg",
      how: "Outscore Atlas over a five-photo game in Asia",
      progress: null,
      note: null,
    });
    expect(byId(stamps, "tour-complete").how).toBe("Clear all 3 legs of the World Tour");
    expect(byId(stamps, "tour-complete").progress).toEqual({
      have: 0,
      need: 3,
      unit: ["leg", "legs"],
    });
    for (const s of stamps) expect(STAMP_IDS).toContain(s.id);
  });

  it("earns a cleared leg, counts it on the whole tour, and notes a near miss elsewhere", () => {
    let record = addLeg({}, "Africa", { you: 9000, atlas: 12000 }, TODAY);
    record = addLeg(record, "Africa", { you: 11900, atlas: 12000 }, TODAY);
    record = addLeg(record, "Europe", { you: 15000, atlas: 14000 }, TODAY);
    record = addLeg(record, "Asia", { you: 10000, atlas: 10000 }, TODAY);
    const stamps = tourOf(record);
    expect(byId(stamps, "tour-europe")).toMatchObject({ earned: true, note: null });
    // The best of the two Africa games, the smaller deficit.
    expect(byId(stamps, "tour-africa")).toMatchObject({
      earned: false,
      note: "Closest so far: 11,900 points to Atlas's 12,000",
    });
    // A tie never clears a leg.
    expect(byId(stamps, "tour-asia")).toMatchObject({
      earned: false,
      note: "Level with Atlas so far: 10,000 points each",
    });
    const whole = byId(stamps, "tour-complete");
    expect(whole.earned).toBe(false);
    expect(toGo(whole.progress!)).toBe("2 legs to go");
  });

  it("earns the whole tour once every leg on the route is cleared", () => {
    const record = ROUTE.reduce<TourRecord>(
      (r, c) => addLeg(r, c, { you: 2, atlas: 1 }, TODAY),
      // A leg off this route doesn't count, cleared or not.
      addLeg({}, "Oceania", { you: 0, atlas: 5 }, TODAY),
    );
    const stamps = tourOf(record);
    expect(stamps.every((s) => s.earned)).toBe(true);
    expect(byId(stamps, "tour-complete").progress).toMatchObject({ have: 3, need: 3 });
  });

  it("has no tour stamps without a route, and an id for every stop the tour can have", () => {
    expect(readStamps(sources()).filter((s) => s.group === "tour")).toEqual([]);
    expect(
      readStamps(sources({ tour: { route: [], record: {} } })).filter((s) => s.group === "tour"),
    ).toEqual([]);
    expect(tourLegStampId("South America")).toBe("tour-south-america");
    expect(STAMP_IDS).toContain("tour-antarctica");
    expect(STAMP_IDS).toContain("tour-complete");
  });

  it("keeps a leg's stamp once earned, even if the tour's record is cleared", () => {
    const won = addLeg({}, "Europe", { you: 2, atlas: 1 }, TODAY);
    const first = collectStamps(tourOf(won), {}, TODAY);
    expect(first.fresh).toEqual(["tour-europe"]);
    const later = collectStamps(tourOf({}), first.kept, "2026-12-01");
    expect(byId(later.stamps, "tour-europe").earned).toBe(true);
    expect(parseKeptStamps(JSON.stringify(first.kept))["tour-europe"]).toBe(TODAY);
  });
});

/** A photo bet on `ring` (0 the tightest), held or not, and Atlas's bet on its own ring. */
function round(
  id: string,
  ring: number,
  held: boolean,
  atlas: { ring: number; held: boolean } | null = null,
): BullseyeRound {
  const at = { lng: 0, lat: 0 };
  return {
    id,
    you: settleBet(at, ring, held ? 10 : 9000),
    atlas: atlas ? settleBet(at, atlas.ring, atlas.held ? 10 : 9000) : null,
  };
}

/** `n` photos bet beside Atlas: you hold `you` of them, Atlas `atlas`. */
function calibration(n: number, you: number, atlas: number): Calibration {
  let cal = emptyCalibration();
  for (let i = 0; i < n; i++) {
    cal = addRound(cal, round(`p${i}`, 2, i < you, { ring: 1, held: i < atlas }));
  }
  return cal;
}

describe("Bullseye stamps", () => {
  const bullseye = (bestTight: number, cal: Calibration = emptyCalibration()) =>
    sources({ bullseye: { bestTight, calibration: cal } });

  it("lists both under Bullseye, none earned in a fresh browser, with ids kept", () => {
    const stamps = readStamps(sources()).filter((s) => s.group === "bullseye");
    expect(stamps.map((s) => s.id)).toEqual(["bullseye-five-tight", "bullseye-calibrated"]);
    for (const s of stamps) {
      expect(s.earned).toBe(false);
      expect(s.note).toBeNull();
      expect(STAMP_IDS).toContain(s.id);
    }
    expect(byId(stamps, "bullseye-five-tight").progress).toEqual({
      have: 0,
      need: 5,
      unit: ["tight ring in a game", "tight rings in a game"],
    });
    expect(byId(stamps, "bullseye-calibrated").progress?.need).toBe(BULLSEYE_CALIBRATION_PHOTOS);
  });

  it("counts the most tight rings held in a game, and earns five", () => {
    const four = byId(readStamps(bullseye(4)), "bullseye-five-tight");
    expect(four.earned).toBe(false);
    expect(toGo(four.progress!)).toBe("1 tight ring in a game to go");
    expect(byId(readStamps(bullseye(5)), "bullseye-five-tight").earned).toBe(true);
  });

  it("counts photos bet beside Atlas, with the rates so far, short of the photos", () => {
    const s = byId(readStamps(bullseye(0, calibration(12, 9, 3))), "bullseye-calibrated");
    expect(s.earned).toBe(false);
    expect(s.progress).toMatchObject({ have: 12, need: BULLSEYE_CALIBRATION_PHOTOS });
    expect(s.note).toBe("Rings held so far: yours 75%, Atlas's 25%");
  });

  it("only counts the photos Atlas bet on toward the photos needed", () => {
    let cal = calibration(BULLSEYE_CALIBRATION_PHOTOS - 1, 20, 10);
    cal = addRound(cal, round("solo", 0, true));
    const s = byId(readStamps(bullseye(0, cal)), "bullseye-calibrated");
    expect(s.earned).toBe(false);
    expect(s.progress?.have).toBe(BULLSEYE_CALIBRATION_PHOTOS - 1);
  });

  it("earns it once your rings hold more often over enough photos, and not level or behind", () => {
    const n = BULLSEYE_CALIBRATION_PHOTOS;
    const ahead = byId(readStamps(bullseye(0, calibration(n, 16, 15))), "bullseye-calibrated");
    expect(ahead.earned).toBe(true);
    expect(ahead.progress).toBeNull();

    const level = byId(readStamps(bullseye(0, calibration(n, 15, 15))), "bullseye-calibrated");
    expect(level.earned).toBe(false);
    expect(level.progress).toBeNull();
    expect(level.note).toBe("Rings held: yours 50%, Atlas's 50%. Bet on to pull ahead.");

    const behind = byId(readStamps(bullseye(0, calibration(n, 12, 18))), "bullseye-calibrated");
    expect(behind.earned).toBe(false);
    expect(behind.note).toBe("Rings held: yours 40%, Atlas's 60%. Bet on to pull ahead.");
  });

  it("keeps a Bullseye stamp once earned, after its proof is gone", () => {
    const first = collectStamps(readStamps(bullseye(5)), {}, TODAY);
    expect(first.fresh).toContain("bullseye-five-tight");
    const later = collectStamps(readStamps(bullseye(0)), first.kept, "2026-12-01");
    expect(byId(later.stamps, "bullseye-five-tight").earned).toBe(true);
  });
});

describe("loadBullseyeSources", () => {
  beforeEach(() => localStorage.clear());

  const tightDay = (held: number, of = 5) =>
    Array.from({ length: of }, (_, i) => round(`d${i}`, 0, i < held));

  it("is empty in a fresh browser", () => {
    expect(loadBullseyeSources()).toEqual({ bestTight: 0, calibration: emptyCalibration() });
  });

  it("takes the most of the free games' kept tight rings and a whole day's", () => {
    localStorage.setItem(BEST_TIGHT_KEY, "2");
    rememberBullseyeDay("2026-11-09", tightDay(4));
    // Today's game is three photos in, all held tight: not a whole game yet.
    rememberBullseyeDay(TODAY, tightDay(3, 3));
    expect(loadBullseyeSources().bestTight).toBe(4);
  });

  it("reads a perfect free best kept before tight rings were, as five", () => {
    localStorage.setItem(BEST_BULLSEYE_KEY, "5000");
    expect(loadBullseyeSources().bestTight).toBe(5);
    localStorage.setItem(BEST_BULLSEYE_KEY, "4500");
    expect(loadBullseyeSources().bestTight).toBe(0);
  });

  it("adds up free bets and today's, as Your calibration does", () => {
    recordBullseyeRound(round("f1", 1, true, { ring: 0, held: false }));
    rememberBullseyeDay("2026-11-09", [round("d1", 1, false, { ring: 1, held: true })]);
    const { calibration: cal } = loadBullseyeSources();
    expect(cal.you[1]).toEqual({ bet: 2, held: 1 });
    expect(cal.atlas[0]).toEqual({ bet: 1, held: 0 });
    expect(cal.atlas[1]).toEqual({ bet: 1, held: 1 });
  });
});

describe("Spot the clue stamps", () => {
  const spot = (bestHottest: number, found = 0) => sources({ spot: { bestHottest, found } });

  it("lists both under Spot the clue, none earned in a fresh browser, with ids kept", () => {
    const stamps = readStamps(sources()).filter((s) => s.group === "spot");
    expect(stamps.map((s) => s.id)).toEqual(["spot-mind-reader", "spot-found"]);
    for (const s of stamps) {
      expect(s.earned).toBe(false);
      expect(s.note).toBeNull();
      expect(STAMP_IDS).toContain(s.id);
    }
    expect(byId(stamps, "spot-mind-reader").progress).toEqual({
      have: 0,
      need: 5,
      unit: ["hottest square in a game", "hottest squares in a game"],
    });
    expect(byId(stamps, "spot-found").progress).toEqual({
      have: 0,
      need: SPOT_FOUND_STAMP,
      unit: ["square found", "squares found"],
    });
  });

  it("earns Mind reader on all five of Atlas's hottest found in one game, not four", () => {
    const four = byId(readStamps(spot(4, 20)), "spot-mind-reader");
    expect(four.earned).toBe(false);
    expect(four.progress?.have).toBe(4);
    expect(byId(readStamps(spot(5)), "spot-mind-reader").earned).toBe(true);
  });

  it("counts the hottest squares found toward Sharp eye, then keeps counting", () => {
    const short = byId(readStamps(spot(0, SPOT_FOUND_STAMP - 1)), "spot-found");
    expect(short.earned).toBe(false);
    expect(short.progress?.have).toBe(SPOT_FOUND_STAMP - 1);
    const done = byId(readStamps(spot(0, SPOT_FOUND_STAMP)), "spot-found");
    expect(done.earned).toBe(true);
    expect(done.progress).toBeNull();
    expect(byId(readStamps(spot(0, 31)), "spot-found").note).toBe("31 found so far");
  });
});

describe("loadSpotSources", () => {
  beforeEach(() => localStorage.clear());

  const found = (id: string, hottest: boolean): SpotResult => ({
    id,
    cell: 0,
    points: hottest ? 1000 : 400,
    hottest,
  });
  const day = (hot: number, of = 5) =>
    Array.from({ length: of }, (_, i) => found(`d${i}`, i < hot));

  it("is empty in a fresh browser", () => {
    expect(loadSpotSources()).toEqual({ bestHottest: 0, found: 0 });
  });

  it("takes the most of the free games' kept hottest and a whole day's", () => {
    localStorage.setItem(BEST_HOTTEST_KEY, "2");
    rememberSpotDay("2026-11-09", day(4));
    // Today's game is three photos in, all spot on: not a whole game yet.
    rememberSpotDay(TODAY, day(3, 3));
    expect(loadSpotSources().bestHottest).toBe(4);
  });

  it("counts every hottest square found as your read of Atlas does", () => {
    const cells = Array<number>(49).fill(0);
    cells[6] = 1;
    cells[5] = 0.6;
    const looked: AtlasLooked = { grid: 7, crop: [0, 0, 1, 1], cells };
    recordSpotRead(looked, 6);
    recordSpotRead(looked, 5);
    recordSpotRead(looked, 6);
    expect(loadSpotSources().found).toBe(2);
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
    expect(c).toEqual({
      bestRun: 0,
      bestClimate: 0,
      bestGround: 0,
      road: EMPTY_TALLY,
      climate: EMPTY_TALLY,
      ground: EMPTY_TALLY,
    });
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

  it("takes the better of the free ground best and a whole day, never a practice best", () => {
    const cover = (id: string, picked: GroundResult["picked"], truth: GroundResult["truth"]) => ({
      id,
      picked,
      truth,
      correct: picked === truth,
      atlas: truth === "Built-up" ? ("Built-up" as const) : null,
    });
    rememberGround(2);
    // A practice game of your mix-ups keeps its own best, which is no ground reader.
    rememberGround(5, "whereabout:on-the-ground-mix-ups-best");
    // Today's game is four of four so far: not a whole game.
    rememberGroundDay(
      TODAY,
      ["a", "b", "c", "d"].map((id) => cover(id, "Tree cover", "Tree cover")),
    );
    rememberGroundDay("2026-11-09", [
      cover("a", "Built-up", "Built-up"),
      cover("b", "Permanent water bodies", "Permanent water bodies"),
      cover("c", "Tree cover", "Grassland"),
      cover("d", "Bare / sparse vegetation", "Bare / sparse vegetation"),
      cover("e", "Built-up", "Built-up"),
    ]);
    let c = loadClueSources();
    expect(c.bestGround).toBe(4);
    // Both days are in the ground's reading: 9 calls, 8 right; Atlas read the two built-up.
    expect(c.ground).toMatchObject({ rounds: 9, right: 8, atlasPlayed: 2, atlasRight: 2 });
    rememberGround(5);
    c = loadClueSources();
    expect(c.bestGround).toBe(5);
  });

  it("counts Clue mix's ground steps with What's on the ground?'s calls", () => {
    recordFreeRound("on-the-ground", { first: true, correct: true, atlas: null });
    recordFreeRound("clue-mix-ground", { first: true, correct: false, atlas: true });
    expect(loadClueSources().ground).toMatchObject({
      rounds: 2,
      right: 1,
      atlasPlayed: 1,
      atlasRight: 1,
    });
  });

  it("counts Clue mix's road and climate calls with Left or right?'s and Which climate?'s", () => {
    recordFreeRound("left-right", { first: true, correct: true, atlas: false });
    recordFreeRound("clue-mix-road", { first: true, correct: false, atlas: true });
    recordFreeRound("clue-mix-climate", { first: true, correct: true, atlas: null });
    // The continent has no stamp, so its calls count toward neither.
    recordFreeRound("clue-mix-continent", { first: true, correct: true, atlas: true });
    const c = loadClueSources();
    expect(c.road).toMatchObject({ rounds: 2, right: 1, atlasPlayed: 2, atlasRight: 1 });
    expect(c.climate).toMatchObject({ rounds: 1, right: 1, atlasPlayed: 0, atlasRight: 0 });
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
