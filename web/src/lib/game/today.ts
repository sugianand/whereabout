/**
 * Today: every daily game on one page. Each game already keeps its own day in this browser, so
 * this reads those records back and adds none of its own: the Daily Five's first score and the
 * game in progress (./dailyArchive.ts, ./saved.ts), the streak games' runs (./dailyRuns.ts)
 * and the photos and rows of How far apart?, Hot and cold, Line them up, Close-up and Which climate?
 * (./farDaily.ts, ./hotDaily.ts, ./lineDaily.ts, ./closeDaily.ts, ./climateDaily.ts). What a game can't read back counts as not started.
 *
 * Like every share in the game, the combined line is scores and counts only, so it spoils no
 * photo. Only finished games go in it: a run still going has no result yet.
 *
 * The full day (`dayTallies` on) is read the same way, so a day counts as soon as its last game
 * is finished, and the days already played count from the start. Every game keeps at least
 * `ARCHIVE_DAYS` days, which is as far back as a streak can be seen: past that it reads "30+"
 * rather than guess. A Daily Five played later from its archive fills in its own day, as its
 * score keeps no date of its own.
 */

import { MAX_POINTS, formatPoints } from "@/lib/geo";

import { loadClimateDay } from "./climateDaily";
import { loadCloseDay } from "./closeDaily";
import { CLOSE_PHOTOS, CLOSE_POINTS, closeTotals } from "./closeUp";
import { ARCHIVE_DAYS, archiveDays, loadDailyScores } from "./dailyArchive";
import { dailyRunUrl, type DailyRun } from "./dailyRuns";
import { loadFarDay } from "./farDaily";
import { HOT_PHOTOS, PHOTO_POINTS, atlasTotal as hotAtlasTotal, hotTotal } from "./hotCold";
import { loadHotDay } from "./hotDaily";
import { PAIRS, PAIR_POINTS, atlasTotal, totalPoints } from "./howFar";
import { loadLineDay } from "./lineDaily";
import { ROW, ROWS, atlasLinePoints, linePoints } from "./lineUp";
import { loadNameDay } from "./nameDaily";
import { loadNorthDay } from "./northDaily";
import { loadOddDay } from "./oddDaily";
import { loadSaved } from "./saved";
import { loadSideDay } from "./sideDaily";
import { ROUNDS_PER_GAME } from "./state";
import { loadWayDay } from "./wayDaily";
import { CLIMATE_PHOTOS, climateTotals } from "./whichClimate";

export type TodayGameId =
  | "daily-five"
  | "further-north"
  | "odd-one-out"
  | "which-way"
  | "how-far"
  | "name-country"
  | "hot-cold"
  | "line-up"
  | "close-up"
  | "left-right"
  | "which-climate";

/** One daily game: where it lives, whatever the browser holds. */
export interface TodayGameInfo {
  id: TodayGameId;
  name: string;
  /** Today's game, which says for itself when it is already played. */
  href: string;
  /** Marks the game's line in the share. */
  icon: string;
  blurb: string;
  /**
   * The first day it was dealt, for a game added to Today later: earlier days never had it, so a
   * full day from before it still counts as full and a run of them isn't broken by its arrival.
   */
  since?: string;
}

export const TODAY_GAMES: readonly TodayGameInfo[] = [
  {
    id: "daily-five",
    name: "Daily Five",
    href: "/?daily",
    icon: "🌍",
    blurb: "The same five photos for everyone: pin each one on the globe.",
  },
  {
    id: "further-north",
    name: "Further North",
    href: "/further-north/daily",
    icon: "⬆️",
    blurb: "Pick the photo taken further north, until your first miss.",
  },
  {
    id: "odd-one-out",
    name: "Odd one out",
    href: "/odd-one-out/daily",
    icon: "🧩",
    blurb: "Four photos, one from another continent, until your first miss.",
  },
  {
    id: "which-way",
    name: "Which way?",
    href: "/which-way/daily",
    icon: "🧭",
    blurb: "Pick the compass point to the next photo and travel on.",
  },
  {
    id: "how-far",
    name: "How far apart?",
    href: "/how-far/daily",
    icon: "📏",
    blurb: "Five pairs of photos, one slider: how far apart were they taken?",
  },
  {
    id: "name-country",
    name: "Name the country",
    href: "/name-country/daily",
    icon: "🗺️",
    blurb: "One photo, four names from its continent, until your first miss.",
  },
  {
    id: "hot-cold",
    name: "Hot and cold",
    href: "/hot-cold/daily",
    icon: "🔥",
    blurb: "Three pins to find each of five countries, an arrow after every miss.",
  },
  {
    id: "line-up",
    name: "Line them up",
    href: "/line-up/daily",
    icon: "↔️",
    blurb: "Five rows of four photos to put in order from west to east.",
    since: "2026-11-06",
  },
  {
    id: "close-up",
    name: "Close-up",
    href: "/close-up/daily",
    icon: "🔍",
    blurb: "Five tight crops and four names each: every wrong name zooms out.",
    since: "2026-11-07",
  },
  {
    id: "left-right",
    name: "Left or right?",
    href: "/left-right/daily",
    icon: "🛣️",
    blurb: "Which side of the road do they drive on? Call it until your first miss.",
    since: "2026-11-13",
  },
  {
    id: "which-climate",
    name: "Which climate?",
    href: "/which-climate/daily",
    icon: "🌦️",
    blurb: "Five photos: tropical, arid, temperate, continental or polar?",
    // From the next UTC day, so a day already played in full isn't left one game short.
    since: "2026-11-14",
  },
];

export type TodayStatus = "new" | "going" | "done";

/** How one daily game stands in this browser today. */
export interface TodayGame extends TodayGameInfo {
  status: TodayStatus;
  /** Where it stands in words, for the card; a finished game's is also its line in the share. */
  line: string;
  /** Atlas's result on the same photos, when the game keeps one. */
  atlas: string | null;
  /**
   * You and Atlas side by side on a finished game, only when Atlas played every photo or row you
   * did: on fewer, its tally isn't a score to set against yours (see `atlasDay`).
   */
  versus: Versus | null;
}

/** Who came out ahead on one game, or on the whole day. */
export type AtlasCall = "you" | "atlas" | "level";

/** One finished game's tally for you and for Atlas, in the game's own unit. */
export interface Versus {
  you: number;
  atlas: number;
  /** "right", "points" or "in place". */
  unit: string;
  call: AtlasCall;
}

function versus(you: number, atlas: number, unit: string): Versus {
  return { you, atlas, unit, call: you > atlas ? "you" : you < atlas ? "atlas" : "level" };
}

const NOT_STARTED = "Not started";

function streakGame(
  run: DailyRun | null,
  noun: string,
  nouns: string = `${noun}s`,
): Pick<TodayGame, "status" | "line" | "atlas" | "versus"> {
  // A run writes itself after its first answer, so a run with nothing to show isn't started.
  if (!run || (run.ended === null && run.streak === 0)) {
    return { status: "new", line: NOT_STARTED, atlas: null, versus: null };
  }
  const inARow = `${run.streak} ${run.streak === 1 ? noun : nouns} in a row`;
  const atlas = run.atlasPlayed > 0 ? `${run.atlasRight} of ${run.atlasPlayed}` : null;
  if (run.ended === null) {
    return { status: "going", line: `${inARow} so far`, atlas, versus: null };
  }
  // The photos you were shown: every one you got right, and the one you missed.
  const played = run.streak + (run.ended === "miss" ? 1 : 0);
  return {
    status: "done",
    line: run.ended === "cleared" ? `${inARow}, every photo` : inARow,
    atlas,
    versus: run.atlasPlayed === played ? versus(run.streak, run.atlasRight, "right") : null,
  };
}

function dailyFive(day: string, deckIds: readonly string[], now: Date) {
  const score = loadDailyScores(day)[day];
  if (score !== undefined) {
    const of = formatPoints(MAX_POINTS * ROUNDS_PER_GAME);
    return {
      status: "done" as const,
      line: `${formatPoints(score)} of ${of}`,
      atlas: null,
      versus: null,
    };
  }
  const saved = loadSaved(deckIds, now.getTime());
  if (saved?.mode.kind === "daily" && !saved.mode.archive && saved.mode.day === day) {
    const photo = Math.min(saved.results.length + 1, ROUNDS_PER_GAME);
    return {
      status: "going" as const,
      line: `Photo ${photo} of ${ROUNDS_PER_GAME}`,
      atlas: null,
      versus: null,
    };
  }
  return { status: "new" as const, line: NOT_STARTED, atlas: null, versus: null };
}

function howFar(day: string) {
  const results = loadFarDay(day)?.results ?? [];
  if (results.length === 0)
    return { status: "new" as const, line: NOT_STARTED, atlas: null, versus: null };
  const points = formatPoints(totalPoints(results));
  const atlas = atlasTotal(results);
  const rival = atlas.played > 0 ? `${formatPoints(atlas.points)} points` : null;
  if (results.length < PAIRS) {
    const line = `${results.length} of ${PAIRS} pairs, ${points} points`;
    return { status: "going" as const, line, atlas: rival, versus: null };
  }
  const line = `${points} of ${formatPoints(PAIRS * PAIR_POINTS)}`;
  const called =
    atlas.played === PAIRS ? versus(totalPoints(results), atlas.points, "points") : null;
  return { status: "done" as const, line, atlas: rival, versus: called };
}

function hotCold(day: string) {
  const kept = loadHotDay(day);
  if (!kept || (kept.results.length === 0 && kept.pins.length === 0)) {
    return { status: "new" as const, line: NOT_STARTED, atlas: null, versus: null };
  }
  const { results } = kept;
  const points = formatPoints(hotTotal(results));
  const atlas = hotAtlasTotal(results);
  const rival = atlas.played > 0 ? `${formatPoints(atlas.total)} points` : null;
  if (results.length < HOT_PHOTOS) {
    const line = `${results.length} of ${HOT_PHOTOS} photos, ${points} points`;
    return { status: "going" as const, line, atlas: rival, versus: null };
  }
  const line = `${points} of ${formatPoints(HOT_PHOTOS * PHOTO_POINTS)}`;
  const called =
    atlas.played === HOT_PHOTOS ? versus(hotTotal(results), atlas.total, "points") : null;
  return { status: "done" as const, line, atlas: rival, versus: called };
}

function lineUp(day: string) {
  const results = loadLineDay(day)?.results ?? [];
  if (results.length === 0)
    return { status: "new" as const, line: NOT_STARTED, atlas: null, versus: null };
  const points = linePoints(results);
  const { points: atlasPoints, rows } = atlasLinePoints(results);
  const atlas = rows > 0 ? `${atlasPoints} of ${rows * ROW}` : null;
  if (results.length < ROWS) {
    const line = `${results.length} of ${ROWS} rows, ${points} in place`;
    return { status: "going" as const, line, atlas, versus: null };
  }
  const called = rows === ROWS ? versus(points, atlasPoints, "in place") : null;
  return {
    status: "done" as const,
    line: `${points} of ${ROWS * ROW} in place`,
    atlas,
    versus: called,
  };
}

function closeUp(day: string) {
  const kept = loadCloseDay(day);
  if (!kept || (kept.results.length === 0 && kept.wrong.length === 0)) {
    return { status: "new" as const, line: NOT_STARTED, atlas: null, versus: null };
  }
  const { results } = kept;
  const { you, atlas, atlasPlayed } = closeTotals(results);
  const rival = atlasPlayed > 0 ? `${atlas} of ${atlasPlayed * CLOSE_POINTS[0]}` : null;
  if (results.length < CLOSE_PHOTOS) {
    const line = `${results.length} of ${CLOSE_PHOTOS} photos, ${you} points`;
    return { status: "going" as const, line, atlas: rival, versus: null };
  }
  const line = `${you} of ${CLOSE_PHOTOS * CLOSE_POINTS[0]} points`;
  const called = atlasPlayed === CLOSE_PHOTOS ? versus(you, atlas, "points") : null;
  return { status: "done" as const, line, atlas: rival, versus: called };
}

function whichClimate(day: string) {
  const results = loadClimateDay(day)?.results ?? [];
  if (results.length === 0)
    return { status: "new" as const, line: NOT_STARTED, atlas: null, versus: null };
  const { right, atlasRight, atlasRead } = climateTotals(results);
  const atlas = atlasRead > 0 ? `${atlasRight} of ${atlasRead}` : null;
  if (results.length < CLIMATE_PHOTOS) {
    const line = `${results.length} of ${CLIMATE_PHOTOS} photos, ${right} right`;
    return { status: "going" as const, line, atlas, versus: null };
  }
  // Atlas's tally is only a score against yours when it read every photo.
  const called = atlasRead === CLIMATE_PHOTOS ? versus(right, atlasRight, "right") : null;
  return {
    status: "done" as const,
    line: `${right} of ${CLIMATE_PHOTOS} right`,
    atlas,
    versus: called,
  };
}

/** Every daily game dealt on `day`, with its standing in this browser. */
export function todayGames(
  day: string,
  deckIds: readonly string[],
  now: Date = new Date(),
): TodayGame[] {
  const dealt = TODAY_GAMES.filter((info) => !info.since || day >= info.since);
  return dealt.map((info) => {
    switch (info.id) {
      case "daily-five":
        return { ...info, ...dailyFive(day, deckIds, now) };
      case "further-north":
        return { ...info, ...streakGame(loadNorthDay(day), "pair") };
      case "odd-one-out":
        return { ...info, ...streakGame(loadOddDay(day), "quad") };
      case "which-way":
        return { ...info, ...streakGame(loadWayDay(day), "stop") };
      case "how-far":
        return { ...info, ...howFar(day) };
      case "name-country":
        return { ...info, ...streakGame(loadNameDay(day), "country", "countries") };
      case "hot-cold":
        return { ...info, ...hotCold(day) };
      case "line-up":
        return { ...info, ...lineUp(day) };
      case "close-up":
        return { ...info, ...closeUp(day) };
      case "left-right":
        return { ...info, ...streakGame(loadSideDay(day), "photo") };
      case "which-climate":
        return { ...info, ...whichClimate(day) };
    }
  });
}

/** How many of the day's games are finished. */
export function gamesDone(games: readonly TodayGame[]): number {
  return games.filter((g) => g.status === "done").length;
}

/** You against Atlas across the day's finished games. */
export interface AtlasDay {
  /** Finished games with a call, in Today's order. */
  called: TodayGame[];
  /** Finished games with no call: Atlas sat some of it out, or its score isn't kept. */
  uncalled: TodayGame[];
  /** Games each side took, and games level. */
  you: number;
  atlas: number;
  level: number;
  /** Who took the day on games won, or null before any game can be called. */
  call: AtlasCall | null;
}

/**
 * Atlas's day: every finished game where Atlas played the same photos all the way through, and
 * who took more of them. A game still going has no result yet, so it waits until it is done.
 */
export function atlasDay(games: readonly TodayGame[]): AtlasDay {
  const done = games.filter((g) => g.status === "done");
  const called = done.filter((g) => g.versus !== null);
  const count = (c: AtlasCall) => called.filter((g) => g.versus!.call === c).length;
  const you = count("you");
  const atlas = count("atlas");
  return {
    called,
    uncalled: done.filter((g) => g.versus === null),
    you,
    atlas,
    level: count("level"),
    call: called.length === 0 ? null : you > atlas ? "you" : you < atlas ? "atlas" : "level",
  };
}

/**
 * "You took the day from Atlas, 3–1", "Atlas took the day, 2–1, 1 level" or "Level with Atlas,
 * 1–1"; null before any game can be called.
 */
export function atlasDayWords(day: AtlasDay): string | null {
  if (day.call === null) return null;
  const head =
    day.call === "you"
      ? `You took the day from Atlas, ${day.you}–${day.atlas}`
      : day.call === "atlas"
        ? `Atlas took the day, ${day.atlas}–${day.you}`
        : `Level with Atlas, ${day.you}–${day.atlas}`;
  return day.level > 0 ? `${head}, ${day.level} level` : head;
}

/**
 * The daily games that can be called against Atlas: every one but the Daily Five, whose score
 * against Atlas isn't kept.
 */
export const VERSUS_GAMES: readonly TodayGameInfo[] = TODAY_GAMES.filter(
  (g) => g.id !== "daily-five",
);

/** How many of a day's daily games this browser finished. */
export interface DayTally {
  day: string;
  done: number;
  /** The daily games dealt that day. */
  of: number;
  /**
   * You against Atlas on each game finished that day that can be called (`TodayGame.versus`).
   * Absent reads as none.
   */
  versus?: Partial<Record<TodayGameId, Versus>>;
}

/** Weeks the calendar shows, this one included; all of them lie within what every game keeps. */
export const CALENDAR_WEEKS = 4;

/** Every day any game still keeps, newest first, starting with `today`. */
export function dayTallies(
  today: string,
  deckIds: readonly string[],
  now: Date = new Date(),
): DayTally[] {
  return archiveDays(today).map((day) => {
    const games = todayGames(day, deckIds, now);
    const versus: Partial<Record<TodayGameId, Versus>> = {};
    for (const g of games) if (g.status === "done" && g.versus) versus[g.id] = g.versus;
    return { day, done: gamesDone(games), of: games.length, versus };
  });
}

/** Days in a row with every daily game finished. */
export interface FullDayStreak {
  days: number;
  /** The run reaches the oldest day kept, so it may well be longer. */
  orMore: boolean;
  /** Today is one of them. Until it is, an unfinished today hasn't broken the run. */
  today: boolean;
}

/** The run of full days up to today, or up to yesterday while today can still be finished. */
export function fullDayStreak(tallies: readonly DayTally[]): FullDayStreak {
  const full = (t: DayTally) => t.done >= t.of;
  const today = tallies.length > 0 && full(tallies[0]);
  let days = 0;
  for (let i = today ? 0 : 1; i < tallies.length && full(tallies[i]); i++) days++;
  const seen = today ? days : days + 1;
  return { days, orMore: days > 0 && seen === ARCHIVE_DAYS, today };
}

/** "3 full days", "1 full day" or "30+ full days". */
export function fullDaysWords({ days, orMore }: Pick<FullDayStreak, "days" | "orMore">): string {
  return `${days}${orMore ? "+" : ""} full ${days === 1 && !orMore ? "day" : "days"}`;
}

/**
 * The calendar: the last `CALENDAR_WEEKS` weeks, Monday first and oldest first, with null for
 * the days still to come this week.
 */
export function calendarWeeks(tallies: readonly DayTally[]): (DayTally | null)[][] {
  if (tallies.length === 0) return [];
  const mondayFirst = (new Date(`${tallies[0].day}T12:00:00Z`).getUTCDay() + 6) % 7;
  const toCome: null[] = new Array<null>(6 - mondayFirst).fill(null);
  const shown = CALENDAR_WEEKS * 7 - toCome.length;
  const days = [...tallies.slice(0, shown)].reverse();
  const cells = [...days, ...toCome];
  return Array.from({ length: CALENDAR_WEEKS }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/**
 * The share line: the day, how many games are finished, one line per finished game, who took
 * the day between you and Atlas once a game can be called, a run of full days once there is one
 * to tell, and the address of this page. Scores and counts only, so
 * it can never name a place or a photo.
 */
export function todayShare(
  day: string,
  games: readonly TodayGame[],
  href: string,
  streak?: FullDayStreak,
): string {
  const done = games.filter((g) => g.status === "done");
  const rival = atlasDayWords(atlasDay(games));
  return [
    `Whereabout · Today · ${day}`,
    `${done.length} of ${games.length} daily games`,
    ...done.map((g) => `${g.icon} ${g.name}: ${g.line}`),
    ...(rival ? [`🤖 ${rival}`] : []),
    ...(streak?.today && streak.days > 1 ? [`🔥 ${fullDaysWords(streak)} in a row`] : []),
    dailyRunUrl(href),
  ].join("\n");
}
