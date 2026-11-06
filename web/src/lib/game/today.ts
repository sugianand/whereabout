/**
 * Today: every daily game on one page. Each game already keeps its own day in this browser, so
 * this reads those records back and adds none of its own: the Daily Five's first score and the
 * game in progress (./dailyArchive.ts, ./saved.ts), the streak games' runs (./dailyRuns.ts)
 * and the photos of How far apart? and Hot and cold (./farDaily.ts, ./hotDaily.ts). What a game can't read back counts as not started.
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

import { ARCHIVE_DAYS, archiveDays, loadDailyScores } from "./dailyArchive";
import { dailyRunUrl, type DailyRun } from "./dailyRuns";
import { loadFarDay } from "./farDaily";
import { HOT_PHOTOS, PHOTO_POINTS, atlasTotal as hotAtlasTotal, hotTotal } from "./hotCold";
import { loadHotDay } from "./hotDaily";
import { PAIRS, PAIR_POINTS, atlasTotal, totalPoints } from "./howFar";
import { loadNameDay } from "./nameDaily";
import { loadNorthDay } from "./northDaily";
import { loadOddDay } from "./oddDaily";
import { loadSaved } from "./saved";
import { ROUNDS_PER_GAME } from "./state";
import { loadWayDay } from "./wayDaily";

export type TodayGameId =
  | "daily-five"
  | "further-north"
  | "odd-one-out"
  | "which-way"
  | "how-far"
  | "name-country"
  | "hot-cold";

/** One daily game: where it lives, whatever the browser holds. */
export interface TodayGameInfo {
  id: TodayGameId;
  name: string;
  /** Today's game, which says for itself when it is already played. */
  href: string;
  /** Marks the game's line in the share. */
  icon: string;
  blurb: string;
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
];

export type TodayStatus = "new" | "going" | "done";

/** How one daily game stands in this browser today. */
export interface TodayGame extends TodayGameInfo {
  status: TodayStatus;
  /** Where it stands in words, for the card; a finished game's is also its line in the share. */
  line: string;
  /** Atlas's result on the same photos, when the game keeps one. */
  atlas: string | null;
}

const NOT_STARTED = "Not started";

function streakGame(
  run: DailyRun | null,
  noun: string,
  nouns: string = `${noun}s`,
): Pick<TodayGame, "status" | "line" | "atlas"> {
  // A run writes itself after its first answer, so a run with nothing to show isn't started.
  if (!run || (run.ended === null && run.streak === 0)) {
    return { status: "new", line: NOT_STARTED, atlas: null };
  }
  const inARow = `${run.streak} ${run.streak === 1 ? noun : nouns} in a row`;
  const atlas = run.atlasPlayed > 0 ? `${run.atlasRight} of ${run.atlasPlayed}` : null;
  if (run.ended === null) return { status: "going", line: `${inARow} so far`, atlas };
  return {
    status: "done",
    line: run.ended === "cleared" ? `${inARow}, every photo` : inARow,
    atlas,
  };
}

function dailyFive(day: string, deckIds: readonly string[], now: Date) {
  const score = loadDailyScores(day)[day];
  if (score !== undefined) {
    const of = formatPoints(MAX_POINTS * ROUNDS_PER_GAME);
    return { status: "done" as const, line: `${formatPoints(score)} of ${of}`, atlas: null };
  }
  const saved = loadSaved(deckIds, now.getTime());
  if (saved?.mode.kind === "daily" && !saved.mode.archive && saved.mode.day === day) {
    const photo = Math.min(saved.results.length + 1, ROUNDS_PER_GAME);
    return {
      status: "going" as const,
      line: `Photo ${photo} of ${ROUNDS_PER_GAME}`,
      atlas: null,
    };
  }
  return { status: "new" as const, line: NOT_STARTED, atlas: null };
}

function howFar(day: string) {
  const results = loadFarDay(day)?.results ?? [];
  if (results.length === 0) return { status: "new" as const, line: NOT_STARTED, atlas: null };
  const points = formatPoints(totalPoints(results));
  const atlas = atlasTotal(results);
  const rival = atlas.played > 0 ? `${formatPoints(atlas.points)} points` : null;
  if (results.length < PAIRS) {
    const line = `${results.length} of ${PAIRS} pairs, ${points} points`;
    return { status: "going" as const, line, atlas: rival };
  }
  const line = `${points} of ${formatPoints(PAIRS * PAIR_POINTS)}`;
  return { status: "done" as const, line, atlas: rival };
}

function hotCold(day: string) {
  const kept = loadHotDay(day);
  if (!kept || (kept.results.length === 0 && kept.pins.length === 0)) {
    return { status: "new" as const, line: NOT_STARTED, atlas: null };
  }
  const { results } = kept;
  const points = formatPoints(hotTotal(results));
  const atlas = hotAtlasTotal(results);
  const rival = atlas.played > 0 ? `${formatPoints(atlas.total)} points` : null;
  if (results.length < HOT_PHOTOS) {
    const line = `${results.length} of ${HOT_PHOTOS} photos, ${points} points`;
    return { status: "going" as const, line, atlas: rival };
  }
  const line = `${points} of ${formatPoints(HOT_PHOTOS * PHOTO_POINTS)}`;
  return { status: "done" as const, line, atlas: rival };
}

/** Every daily game's standing in this browser on `day`. */
export function todayGames(
  day: string,
  deckIds: readonly string[],
  now: Date = new Date(),
): TodayGame[] {
  return TODAY_GAMES.map((info) => {
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
    }
  });
}

/** How many of the day's games are finished. */
export function gamesDone(games: readonly TodayGame[]): number {
  return games.filter((g) => g.status === "done").length;
}

/** How many of a day's daily games this browser finished. */
export interface DayTally {
  day: string;
  done: number;
}

/** Weeks the calendar shows, this one included; all of them lie within what every game keeps. */
export const CALENDAR_WEEKS = 4;

/** Every day any game still keeps, newest first, starting with `today`. */
export function dayTallies(
  today: string,
  deckIds: readonly string[],
  now: Date = new Date(),
): DayTally[] {
  return archiveDays(today).map((day) => ({
    day,
    done: gamesDone(todayGames(day, deckIds, now)),
  }));
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
  const full = (t: DayTally) => t.done >= TODAY_GAMES.length;
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
 * The share line: the day, how many games are finished, one line per finished game, a run of
 * full days once there is one to tell, and the address of this page. Scores and counts only, so
 * it can never name a place or a photo.
 */
export function todayShare(
  day: string,
  games: readonly TodayGame[],
  href: string,
  streak?: FullDayStreak,
): string {
  const done = games.filter((g) => g.status === "done");
  return [
    `Whereabout · Today · ${day}`,
    `${done.length} of ${games.length} daily games`,
    ...done.map((g) => `${g.icon} ${g.name}: ${g.line}`),
    ...(streak?.today && streak.days > 1 ? [`🔥 ${fullDaysWords(streak)} in a row`] : []),
    dailyRunUrl(href),
  ].join("\n");
}
