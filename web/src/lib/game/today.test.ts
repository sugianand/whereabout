import { beforeEach, describe, expect, it } from "vitest";

import { rememberClimateDay } from "./climateDaily";
import { rememberClueDay } from "./clueDaily";
import { rememberCloseDay } from "./closeDaily";
import { type CloseResult } from "./closeUp";
import { ARCHIVE_DAYS, DAILY_SCORES_KEY, daysBefore } from "./dailyArchive";
import { rememberFarDay } from "./farDaily";
import { hotAtlas, hotPin, hotRound } from "./hotCold";
import { rememberHotDay } from "./hotDaily";
import { type PairResult } from "./howFar";
import { rememberLineDay } from "./lineDaily";
import { type RowResult } from "./lineUp";
import { rememberNameDay } from "./nameDaily";
import { rememberNorthDay } from "./northDaily";
import { rememberOddDay } from "./oddDaily";
import { SAVED_GAME_KEY } from "./saved";
import { rememberSideDay } from "./sideDaily";
import {
  CALENDAR_WEEKS,
  TODAY_GAMES,
  atlasDay,
  atlasDayWords,
  calendarWeeks,
  dayTallies,
  fullDayStreak,
  fullDaysWords,
  gamesDone,
  todayGames,
  todayShare,
  type DayTally,
  type TodayGameId,
} from "./today";
import { rememberWayDay } from "./wayDaily";
import { type ClimateResult } from "./whichClimate";

const DAY = "2026-11-03";
const NOW = new Date(`${DAY}T12:00:00Z`);
const HREF = "https://example.test/whereabout/today/?x=1#y";
const IDS = ["a", "b", "c", "d", "e"];

function pair(points: number, atlas: number | null = 500): PairResult {
  const estimate = (p: number) => ({ km: 100, ratio: 1.5, points: p, tooFar: false });
  return {
    actualKm: 100,
    you: estimate(points),
    atlas: atlas === null ? null : estimate(atlas),
  };
}

function savedDaily(day: string) {
  localStorage.setItem(
    SAVED_GAME_KEY,
    JSON.stringify({
      v: 1,
      savedAt: NOW.getTime() - 1000,
      mode: { kind: "daily", day },
      dealt: IDS,
      results: [],
      round: { photoId: "a", pin: { lng: 10, lat: 20 }, hintsUsed: 0 },
    }),
  );
}

const byId = (id: TodayGameId) => todayGames(DAY, IDS, NOW).find((g) => g.id === id)!;

beforeEach(() => localStorage.clear());

describe("todayGames", () => {
  it("lists all seven daily games, none started in a new browser", () => {
    const games = todayGames(DAY, IDS, NOW);
    expect(games.map((g) => g.id)).toEqual([
      "daily-five",
      "further-north",
      "odd-one-out",
      "which-way",
      "how-far",
      "name-country",
      "hot-cold",
    ]);
    expect(games.every((g) => g.status === "new" && g.line === "Not started")).toBe(true);
    expect(gamesDone(games)).toBe(0);
  });

  it("reads a finished Daily Five's score, ahead of a replay in progress", () => {
    localStorage.setItem(DAILY_SCORES_KEY, JSON.stringify({ [DAY]: 18240 }));
    savedDaily(DAY);
    expect(byId("daily-five")).toMatchObject({ status: "done", line: "18,240 of 25,000" });
  });

  it("shows today's Daily Five under way, but not another day's or another game", () => {
    savedDaily(DAY);
    expect(byId("daily-five")).toMatchObject({ status: "going", line: "Photo 1 of 5" });
    savedDaily("2026-11-02");
    expect(byId("daily-five").status).toBe("new");
  });

  it("reads each streak game's run, with its own noun and Atlas's tally", () => {
    rememberNorthDay(DAY, { streak: 1, atlasRight: 1, atlasPlayed: 2, ended: "miss" });
    rememberOddDay(DAY, { streak: 3, atlasRight: 0, atlasPlayed: 0, ended: null });
    rememberWayDay(DAY, { streak: 9, atlasRight: 4, atlasPlayed: 9, ended: "cleared", at: "a" });
    expect(byId("further-north")).toMatchObject({
      status: "done",
      line: "1 pair in a row",
      atlas: "1 of 2",
    });
    expect(byId("odd-one-out")).toMatchObject({
      status: "going",
      line: "3 quads in a row so far",
      atlas: null,
    });
    expect(byId("which-way")).toMatchObject({
      status: "done",
      line: "9 stops in a row, every photo",
      atlas: "4 of 9",
    });
  });

  it("reads today's Name the country, with its own plural", () => {
    rememberNameDay(DAY, { streak: 3, atlasRight: 2, atlasPlayed: 3, ended: "miss" });
    expect(byId("name-country")).toMatchObject({
      status: "done",
      line: "3 countries in a row",
      atlas: "2 of 3",
    });
    rememberNameDay(DAY, { streak: 1, atlasRight: 0, atlasPlayed: 0, ended: null });
    expect(byId("name-country").line).toBe("1 country in a row so far");
  });

  it("reads today's Hot and cold, under way from its first pin", () => {
    const truth = { lng: 2.35, lat: 48.86 };
    const pin = hotPin(truth, truth, true);
    const miss = hotPin({ lng: -150, lat: -5 }, truth, false);
    const round = hotRound("p1", [pin], hotAtlas(0, true));

    rememberHotDay(DAY, { results: [], pins: [] });
    expect(byId("hot-cold").status).toBe("new");
    rememberHotDay(DAY, { results: [], pins: [miss] });
    expect(byId("hot-cold")).toMatchObject({ status: "going", line: "0 of 5 photos, 0 points" });
    rememberHotDay(DAY, { results: [round], pins: [] });
    expect(byId("hot-cold")).toMatchObject({
      status: "going",
      line: "1 of 5 photos, 6,000 points",
      atlas: "6,000 points",
    });
    rememberHotDay(DAY, { results: Array<typeof round>(5).fill(round), pins: [] });
    expect(byId("hot-cold")).toMatchObject({
      status: "done",
      line: "30,000 of 30,000",
      atlas: "30,000 points",
    });
  });

  it("counts an empty run as not started, and a first-pick miss as played", () => {
    rememberNorthDay(DAY, { streak: 0, atlasRight: 0, atlasPlayed: 0, ended: null });
    expect(byId("further-north").status).toBe("new");
    rememberNorthDay(DAY, { streak: 0, atlasRight: 0, atlasPlayed: 1, ended: "miss" });
    expect(byId("further-north")).toMatchObject({ status: "done", line: "0 pairs in a row" });
  });

  it("reads How far apart?'s pairs, finished only when every pair is in", () => {
    rememberFarDay(DAY, { results: [pair(900), pair(100, null)] });
    expect(byId("how-far")).toMatchObject({
      status: "going",
      line: "2 of 5 pairs, 1,000 points",
      atlas: "500 points",
    });
    rememberFarDay(DAY, { results: [1, 2, 3, 4, 5].map(() => pair(700)) });
    expect(byId("how-far")).toMatchObject({
      status: "done",
      line: "3,500 of 5,000",
      atlas: "2,500 points",
    });
  });

  it("ignores another day's games and a malformed store", () => {
    rememberNorthDay("2026-11-02", { streak: 4, atlasRight: 0, atlasPlayed: 0, ended: "miss" });
    localStorage.setItem("whereabout:how-far-daily", "not json");
    localStorage.setItem(DAILY_SCORES_KEY, "{");
    expect(gamesDone(todayGames(DAY, IDS, NOW))).toBe(0);
  });
});

/** The games dealt on DAY, before Line them up joined. */
const ALL = todayGames(DAY, IDS, NOW).length;
/** Tallies newest first from DAY: one count per day, nothing after them. */
const tallies = (...done: number[]): DayTally[] =>
  Array.from({ length: ARCHIVE_DAYS }, (_, i) => ({
    day: daysBefore(DAY, i),
    done: done[i] ?? 0,
    of: ALL,
  }));

/** Every daily game finished on `day`, each in its own store, as the games write them. */
function finishDay(day: string) {
  const run = { streak: 3, atlasRight: 1, atlasPlayed: 2, ended: "miss" as const };
  const scores = JSON.parse(localStorage.getItem(DAILY_SCORES_KEY) ?? "{}") as object;
  localStorage.setItem(DAILY_SCORES_KEY, JSON.stringify({ ...scores, [day]: 18240 }));
  rememberNorthDay(day, run);
  rememberOddDay(day, run);
  rememberWayDay(day, run);
  rememberNameDay(day, run);
  rememberFarDay(day, { results: [1, 2, 3, 4, 5].map(() => pair(700)) });
  const photo = hotRound("a", [hotPin({ lng: 0, lat: 0 }, { lng: 0, lat: 1 }, true)], null);
  rememberHotDay(day, { results: [1, 2, 3, 4, 5].map(() => photo), pins: [] });
}

describe("dayTallies", () => {
  it("reads each kept day back through the games' own stores, newest first", () => {
    finishDay(DAY);
    finishDay(daysBefore(DAY, 2));
    rememberNorthDay(daysBefore(DAY, 1), {
      streak: 1,
      atlasRight: 0,
      atlasPlayed: 0,
      ended: "miss",
    });
    rememberOddDay(daysBefore(DAY, 1), { streak: 1, atlasRight: 0, atlasPlayed: 0, ended: null });
    const kept = dayTallies(DAY, IDS, NOW);
    expect(kept).toHaveLength(ARCHIVE_DAYS);
    expect(kept.slice(0, 4)).toMatchObject([
      { day: DAY, done: ALL, of: ALL },
      { day: "2026-11-02", done: 1, of: ALL },
      { day: "2026-11-01", done: ALL, of: ALL },
      { day: "2026-10-31", done: 0, of: ALL },
    ]);
  });

  it("gives every game the whole window: a day at its far end still reads full", () => {
    const oldest = daysBefore(DAY, ARCHIVE_DAYS - 1);
    finishDay(oldest);
    expect(dayTallies(DAY, IDS, NOW).at(-1)).toMatchObject({ day: oldest, done: ALL, of: ALL });
  });

  it("keeps each finished game's call against Atlas, and only those", () => {
    const yesterday = daysBefore(DAY, 1);
    rememberNameDay(yesterday, { streak: 3, atlasRight: 2, atlasPlayed: 4, ended: "miss" });
    // Atlas sat out a photo: no call.
    rememberNorthDay(yesterday, { streak: 3, atlasRight: 1, atlasPlayed: 3, ended: "miss" });
    // Still going: no call yet.
    rememberOddDay(yesterday, { streak: 2, atlasRight: 2, atlasPlayed: 2, ended: null });
    const [today, before] = dayTallies(DAY, IDS, NOW);
    expect(today.versus).toEqual({});
    expect(before.versus).toEqual({
      "name-country": { you: 3, atlas: 2, unit: "right", call: "you" },
    });
  });
});

const ROW: RowResult = {
  order: ["a", "b", "c", "d"],
  east: ["a", "b", "c", "d"],
  right: [true, true, false, false],
  points: 2,
  atlas: { order: ["b", "a", "c", "d"], points: 1 },
};
const CLOSE: CloseResult = {
  id: "a",
  wrong: ["DE"],
  points: 2,
  atlas: { order: ["DE", "FR"], rank: 1, points: 2 },
};

/** A whole Which climate? game: 3 right, Atlas 2 right of the 5 it read. */
const CLIMATE_GAME: ClimateResult[] = [
  { id: "a", picked: "Arid", truth: "Arid", correct: true, atlas: "Arid" },
  { id: "b", picked: "Polar", truth: "Polar", correct: true, atlas: "Temperate" },
  { id: "c", picked: "Tropical", truth: "Tropical", correct: true, atlas: "Arid" },
  { id: "d", picked: "Arid", truth: "Temperate", correct: false, atlas: "Temperate" },
  { id: "e", picked: "Polar", truth: "Continental", correct: false, atlas: "Temperate" },
];

/** Finish one game joined later on `day`, as it writes its own store. */
const finishJoined: Partial<Record<TodayGameId, (day: string) => void>> = {
  "line-up": (day) => rememberLineDay(day, { results: Array<RowResult>(5).fill(ROW) }),
  "close-up": (day) =>
    rememberCloseDay(day, {
      results: ["a", "b", "c", "d", "e"].map((id) => ({ ...CLOSE, id })),
      wrong: [],
    }),
  "left-right": (day) =>
    rememberSideDay(day, { streak: 4, atlasRight: 3, atlasPlayed: 5, ended: "miss" }),
  "which-climate": (day) => rememberClimateDay(day, CLIMATE_GAME),
  "clue-mix": (day) =>
    rememberClueDay(day, { streak: 5, atlasRight: 4, atlasPlayed: 6, ended: "miss" }),
};

/** Every daily game finished on `day` but `except`, each as it writes its own store. */
function finishAll(day: string, except?: TodayGameId) {
  finishDay(day);
  for (const [id, finish] of Object.entries(finishJoined)) if (id !== except) finish(day);
}

const JOINERS = TODAY_GAMES.filter((g) => g.since).map((g) => [g.id, g.since!] as const);

describe.each(JOINERS)("%s joining Today", (id, joined) => {
  const at = new Date(`${joined}T12:00:00Z`);
  const dealt = (day: string) => todayGames(day, IDS, at).some((g) => g.id === id);

  it("has a way to be finished in these tests", () => {
    expect(finishJoined[id]).toBeDefined();
  });

  it("is dealt from its first day on, and not before", () => {
    expect(dealt(joined)).toBe(true);
    expect(dealt(daysBefore(joined, -1))).toBe(true);
    expect(dealt(daysBefore(joined, 1))).toBe(false);
  });

  it("doesn't undo a run of full days from before it was dealt", () => {
    finishAll(daysBefore(joined, 1));
    finishAll(daysBefore(joined, 2));
    const run = dayTallies(joined, IDS, at);
    expect(run[1].of).toBe(run[0].of - 1);
    expect(run[1].done).toBe(run[1].of);
    // An unfinished first day hasn't broken it, and the old days stay full.
    expect(fullDayStreak(run)).toEqual({ days: 2, orMore: false, today: false });
  });

  it("counts towards a full day from then on", () => {
    finishAll(joined, id);
    expect(fullDayStreak(dayTallies(joined, IDS, at)).today).toBe(false);
    finishJoined[id]!(joined);
    expect(fullDayStreak(dayTallies(joined, IDS, at)).today).toBe(true);
  });
});

describe("the later games on Today", () => {
  const DAY_AFTER = "2026-11-08";
  const AT = new Date(`${DAY_AFTER}T12:00:00Z`);
  const game = (id: TodayGameId) => todayGames(DAY_AFTER, IDS, AT).find((g) => g.id === id)!;

  it("reads today's Line them up, under way from its first row", () => {
    expect(game("line-up")).toMatchObject({ status: "new", line: "Not started" });
    rememberLineDay(DAY_AFTER, { results: [ROW] });
    expect(game("line-up")).toMatchObject({
      status: "going",
      line: "1 of 5 rows, 2 in place",
      atlas: "1 of 4",
    });
    finishJoined["line-up"]!(DAY_AFTER);
    expect(game("line-up")).toMatchObject({
      status: "done",
      line: "10 of 20 in place",
      atlas: "5 of 20",
    });
  });

  it("reads today's Close-up, under way from its first wrong name", () => {
    expect(game("close-up")).toMatchObject({ status: "new", line: "Not started" });
    rememberCloseDay(DAY_AFTER, { results: [], wrong: ["DE"] });
    expect(game("close-up")).toMatchObject({ status: "going", line: "0 of 5 photos, 0 points" });
    rememberCloseDay(DAY_AFTER, {
      results: [CLOSE, { ...CLOSE, id: "b", atlas: null }],
      wrong: [],
    });
    expect(game("close-up")).toMatchObject({
      status: "going",
      line: "2 of 5 photos, 4 points",
      atlas: "2 of 3",
    });
    finishJoined["close-up"]!(DAY_AFTER);
    expect(game("close-up")).toMatchObject({
      status: "done",
      line: "10 of 15 points",
      atlas: "10 of 15",
    });
  });
});

describe("today's Left or right? on Today", () => {
  const DAY_IN = "2026-11-14";
  const AT = new Date(`${DAY_IN}T12:00:00Z`);
  const game = () => todayGames(DAY_IN, IDS, AT).find((g) => g.id === "left-right")!;

  it("reads the run as it is kept, and calls it against Atlas when Atlas called every photo", () => {
    expect(game()).toMatchObject({ status: "new", line: "Not started", href: "/left-right/daily" });
    rememberSideDay(DAY_IN, { streak: 1, atlasRight: 1, atlasPlayed: 1, ended: null });
    expect(game()).toMatchObject({ status: "going", line: "1 photo in a row so far" });
    finishJoined["left-right"]!(DAY_IN);
    expect(game()).toMatchObject({
      status: "done",
      line: "4 photos in a row",
      atlas: "3 of 5",
      versus: { you: 4, atlas: 3, unit: "right", call: "you" },
    });
  });
});

describe("today's Which climate? on Today", () => {
  const DAY_IN = "2026-11-14";
  const AT = new Date(`${DAY_IN}T12:00:00Z`);
  const game = () => todayGames(DAY_IN, IDS, AT).find((g) => g.id === "which-climate")!;

  it("reads the calls as they are kept, and calls the game against Atlas when it read every photo", () => {
    expect(todayGames("2026-11-13", IDS, AT).some((g) => g.id === "which-climate")).toBe(false);
    expect(game()).toMatchObject({
      status: "new",
      line: "Not started",
      href: "/which-climate/daily",
    });
    rememberClimateDay(DAY_IN, CLIMATE_GAME.slice(0, 2));
    expect(game()).toMatchObject({
      status: "going",
      line: "2 of 5 photos, 2 right",
      atlas: "1 of 2",
    });
    finishJoined["which-climate"]!(DAY_IN);
    expect(game()).toMatchObject({
      status: "done",
      line: "3 of 5 right",
      atlas: "2 of 5",
      versus: { you: 3, atlas: 2, unit: "right", call: "you" },
    });
  });

  it("makes no call against Atlas when it sat a photo out", () => {
    rememberClimateDay(DAY_IN, [{ ...CLIMATE_GAME[0], atlas: null }, ...CLIMATE_GAME.slice(1)]);
    expect(game()).toMatchObject({ status: "done", atlas: "1 of 4", versus: null });
  });
});

describe("today's Clue mix on Today", () => {
  const DAY_IN = "2026-11-15";
  const AT = new Date(`${DAY_IN}T12:00:00Z`);
  const game = () => todayGames(DAY_IN, IDS, AT).find((g) => g.id === "clue-mix")!;

  it("reads the run as it is kept, and calls it against Atlas when Atlas read every step", () => {
    expect(game()).toMatchObject({ status: "new", line: "Not started", href: "/clue-mix/daily" });
    rememberClueDay(DAY_IN, { streak: 1, atlasRight: 0, atlasPlayed: 1, ended: null });
    expect(game()).toMatchObject({ status: "going", line: "1 clue in a row so far" });
    finishJoined["clue-mix"]!(DAY_IN);
    expect(game()).toMatchObject({
      status: "done",
      line: "5 clues in a row",
      atlas: "4 of 6",
      versus: { you: 5, atlas: 4, unit: "right", call: "you" },
    });
  });

  it("leaves the call out when Atlas sat a step out", () => {
    rememberClueDay(DAY_IN, { streak: 5, atlasRight: 4, atlasPlayed: 5, ended: "miss" });
    expect(game()).toMatchObject({ status: "done", atlas: "4 of 5", versus: null });
  });
});

describe("fullDayStreak", () => {
  it("counts days in a row with every game finished, up to today", () => {
    expect(fullDayStreak(tallies(ALL, ALL, ALL, ALL - 1, ALL))).toEqual({
      days: 3,
      orMore: false,
      today: true,
    });
  });

  it("isn't broken by a today that can still be finished, and doesn't count it", () => {
    expect(fullDayStreak(tallies(2, ALL, ALL))).toEqual({ days: 2, orMore: false, today: false });
    expect(fullDayStreak(tallies(0, ALL))).toEqual({ days: 1, orMore: false, today: false });
  });

  it("is broken by a day missed, and six of seven is a miss", () => {
    expect(fullDayStreak(tallies(0, ALL - 1, ALL)).days).toBe(0);
    expect(fullDayStreak(tallies()).days).toBe(0);
  });

  it("says when the run reaches further back than the games keep", () => {
    const every = Array.from({ length: ARCHIVE_DAYS }, () => ALL);
    expect(fullDayStreak(tallies(...every))).toEqual({
      days: ARCHIVE_DAYS,
      orMore: true,
      today: true,
    });
    // The morning after: a day has left the window, but the run hasn't shrunk.
    const morning = fullDayStreak(tallies(0, ...every.slice(1)));
    expect(morning).toMatchObject({ days: ARCHIVE_DAYS - 1, orMore: true, today: false });
    expect(fullDaysWords(morning)).toBe("29+ full days");
  });

  it("words the count", () => {
    expect(fullDaysWords({ days: 1, orMore: false })).toBe("1 full day");
    expect(fullDaysWords({ days: 2, orMore: false })).toBe("2 full days");
  });
});

describe("calendarWeeks", () => {
  // DAY, 2026-11-03, is a Tuesday.
  it("runs Monday to Sunday, oldest first, leaving the days to come empty", () => {
    const weeks = calendarWeeks(tallies(ALL));
    expect(weeks).toHaveLength(CALENDAR_WEEKS);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0]?.day).toBe("2026-10-12");
    expect(new Date("2026-10-12T12:00:00Z").getUTCDay()).toBe(1);
    expect(weeks[3].map((d) => d?.day ?? null)).toEqual([
      "2026-11-02",
      DAY,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it.each([
    ["2026-11-01", 0], // A Sunday, the week's last day.
    ["2026-11-02", 6], // A Monday, the week's first.
  ])("fills whole weeks ending on %s", (day, toCome) => {
    const cells = calendarWeeks([{ day, done: 0, of: ALL }, ...tallies().slice(0, 29)]).flat();
    expect(cells.filter((c) => c === null)).toHaveLength(toCome);
    expect(cells).toHaveLength(CALENDAR_WEEKS * 7);
  });
});

describe("todayShare", () => {
  it("adds the run of full days once today is one of two or more", () => {
    const games = todayGames(DAY, IDS, NOW);
    const line = (done: number[]) => todayShare(DAY, games, HREF, fullDayStreak(tallies(...done)));
    expect(line([ALL, ALL, ALL])).toContain("🔥 3 full days in a row\n");
    expect(line([ALL])).not.toContain("🔥");
    expect(line([1, ALL, ALL])).not.toContain("🔥");
  });

  it("gathers finished games only, with the page's clean address", () => {
    rememberNorthDay(DAY, { streak: 6, atlasRight: 3, atlasPlayed: 4, ended: "miss" });
    rememberFarDay(DAY, { results: [1, 2, 3, 4, 5].map(() => pair(700)) });
    rememberOddDay(DAY, { streak: 2, atlasRight: 0, atlasPlayed: 0, ended: null });
    expect(todayShare(DAY, todayGames(DAY, IDS, NOW), HREF)).toBe(
      [
        "Whereabout · Today · 2026-11-03",
        "2 of 7 daily games",
        "⬆️ Further North: 6 pairs in a row",
        "📏 How far apart?: 3,500 of 5,000",
        "🤖 You took the day from Atlas, 1–0",
        "https://example.test/whereabout/today/",
      ].join("\n"),
    );
  });
});

describe("Atlas's day", () => {
  const DAY_AFTER = "2026-11-08";
  const AT = new Date(`${DAY_AFTER}T12:00:00Z`);
  const games = () => todayGames(DAY_AFTER, IDS, AT);
  const game = (id: TodayGameId) => games().find((g) => g.id === id)!;

  it("calls a streak game only when Atlas played every photo you were shown", () => {
    // Shown three right and the miss: four photos.
    rememberNorthDay(DAY_AFTER, { streak: 3, atlasRight: 4, atlasPlayed: 4, ended: "miss" });
    expect(game("further-north").versus).toEqual({
      you: 3,
      atlas: 4,
      unit: "right",
      call: "atlas",
    });
    rememberNorthDay(DAY_AFTER, { streak: 3, atlasRight: 1, atlasPlayed: 3, ended: "miss" });
    expect(game("further-north").versus).toBeNull();
    // A cleared run has no miss to count.
    rememberWayDay(DAY_AFTER, { streak: 5, atlasRight: 5, atlasPlayed: 5, ended: "cleared" });
    expect(game("which-way").versus).toMatchObject({ you: 5, atlas: 5, call: "level" });
    // A run still going has no call yet.
    rememberOddDay(DAY_AFTER, { streak: 2, atlasRight: 2, atlasPlayed: 2, ended: null });
    expect(game("odd-one-out").versus).toBeNull();
  });

  it("calls the points games only over a whole game Atlas played", () => {
    rememberFarDay(DAY_AFTER, { results: [1, 2, 3, 4, 5].map(() => pair(700)) });
    expect(game("how-far").versus).toEqual({
      you: 3500,
      atlas: 2500,
      unit: "points",
      call: "you",
    });
    const sitOut = [1, 2, 3, 4, 5].map((i) => pair(700, i === 3 ? null : 900));
    rememberFarDay(DAY_AFTER, { results: sitOut });
    expect(game("how-far").versus).toBeNull();

    const truth = { lng: 0, lat: 1 };
    const hot = (atlas: boolean) =>
      hotRound("a", [hotPin({ lng: 0, lat: 0 }, truth, true)], atlas ? hotAtlas(0, true) : null);
    rememberHotDay(DAY_AFTER, { results: [1, 2, 3, 4, 5].map(() => hot(true)), pins: [] });
    expect(game("hot-cold").versus?.call).toBe("atlas");
    rememberHotDay(DAY_AFTER, { results: [1, 2, 3, 4, 5].map((i) => hot(i > 1)), pins: [] });
    expect(game("hot-cold").versus).toBeNull();

    finishJoined["line-up"]!(DAY_AFTER);
    expect(game("line-up").versus).toEqual({ you: 10, atlas: 5, unit: "in place", call: "you" });
    finishJoined["close-up"]!(DAY_AFTER);
    expect(game("close-up").versus).toEqual({ you: 10, atlas: 10, unit: "points", call: "level" });
  });

  it("never calls the Daily Five, whose score against Atlas isn't kept", () => {
    finishAll(DAY_AFTER);
    expect(game("daily-five")).toMatchObject({ status: "done", versus: null });
    expect(atlasDay(games()).uncalled.map((g) => g.id)).toContain("daily-five");
  });

  it("counts the games each side took, and who took the day", () => {
    expect(atlasDay(games())).toMatchObject({ called: [], call: null });
    expect(atlasDayWords(atlasDay(games()))).toBeNull();

    // Further North: Atlas 2 to your 1 on two pairs; Line them up: you 10 to Atlas's 5.
    rememberNorthDay(DAY_AFTER, { streak: 1, atlasRight: 2, atlasPlayed: 2, ended: "miss" });
    finishJoined["line-up"]!(DAY_AFTER);
    let day = atlasDay(games());
    expect(day).toMatchObject({ you: 1, atlas: 1, level: 0, call: "level" });
    expect(atlasDayWords(day)).toBe("Level with Atlas, 1–1");

    finishJoined["close-up"]!(DAY_AFTER);
    rememberFarDay(DAY_AFTER, { results: [1, 2, 3, 4, 5].map(() => pair(100)) });
    day = atlasDay(games());
    expect(day.called.map((g) => g.id)).toEqual([
      "further-north",
      "how-far",
      "line-up",
      "close-up",
    ]);
    expect(day).toMatchObject({ you: 1, atlas: 2, level: 1, call: "atlas" });
    expect(atlasDayWords(day)).toBe("Atlas took the day, 2–1, 1 level");

    // A game Atlas sat part of out is finished but uncalled.
    rememberNameDay(DAY_AFTER, { streak: 6, atlasRight: 1, atlasPlayed: 2, ended: "miss" });
    expect(atlasDay(games()).uncalled.map((g) => g.id)).toEqual(["name-country"]);
  });

  it("says who took the day in the share, after the games", () => {
    rememberWayDay(DAY_AFTER, { streak: 4, atlasRight: 2, atlasPlayed: 5, ended: "miss" });
    expect(todayShare(DAY_AFTER, games(), HREF)).toContain(
      "🧭 Which way?: 4 stops in a row\n🤖 You took the day from Atlas, 1–0\nhttps://",
    );
    rememberWayDay(DAY_AFTER, { streak: 4, atlasRight: 2, atlasPlayed: 3, ended: "miss" });
    expect(todayShare(DAY_AFTER, games(), HREF)).not.toContain("🤖");
  });
});
