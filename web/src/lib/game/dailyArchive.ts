/**
 * The Daily Five archive: the last `ARCHIVE_DAYS` puzzle days (today included) can be played
 * from `?daily=YYYY-MM-DD`, and the score of each one finished in this browser is kept, so the
 * summary can show a calendar of the days played and the days still to play.
 *
 * A past day's game is an *archive* game: it joins the record (games, rounds against Atlas, best
 * game, continents) but never the Daily Five streak, so a missed day can't be backfilled. Days
 * are UTC puzzle days, like the streak (`dayKey` in ./daily.ts). A past day is dealt by the same
 * seeded shuffle as on the day, over the photos the game has now.
 *
 * Scores live in localStorage under `DAILY_SCORES_KEY`, best effort: when storage is blocked or
 * throws, the archive still plays and the calendar shows only this visit's games.
 */

import { daysBetween } from "@/lib/playerRecord";
import { MAX_POINTS } from "@/lib/geo";

import { ROUNDS_PER_GAME } from "./state";

/** How many puzzle days can be played, counting today. */
export const ARCHIVE_DAYS = 30;

export const DAILY_SCORES_KEY = "whereabout:daily-scores";

/** First score kept for each puzzle day ("2026-10-24" → 18240). */
export type DailyScores = Readonly<Record<string, number>>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** True for a real calendar day written "YYYY-MM-DD" (so "2026-02-30" is not one). */
export function isDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/** The day `n` days before `day` (both "YYYY-MM-DD", UTC). */
export function daysBefore(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10);
}

/** True when `day` can be played from the archive on `today`: not ahead, not too old. */
export function inArchive(day: string, today: string): boolean {
  if (!isDayKey(day)) return false;
  const age = daysBetween(day, today);
  return age >= 0 && age < ARCHIVE_DAYS;
}

/** The playable puzzle days on `today`, newest first, starting with today. */
export function archiveDays(today: string): string[] {
  return Array.from({ length: ARCHIVE_DAYS }, (_, i) => daysBefore(today, i));
}

export const ARCHIVE_NOTICE = {
  ahead: "That Daily Five isn't out yet, so here's today's.",
  old: `Only the last ${ARCHIVE_DAYS} Daily Fives can be played, so here's today's.`,
} as const;

export interface DailyRequest {
  day: string;
  /** True for a past day's puzzle, which never counts toward the streak. */
  archive: boolean;
  /** Why the day asked for couldn't be played, when it couldn't. */
  notice?: string;
}

/**
 * Read `?daily=` from the address. A bare `?daily`, today's date or anything that is not a date
 * plays today's; a date in the archive plays that day's; a date ahead of today or older than the
 * archive plays today's with a one-line reason.
 */
export function parseDailyParam(value: string, today: string): DailyRequest {
  if (!isDayKey(value) || value === today) return { day: today, archive: false };
  if (inArchive(value, today)) return { day: value, archive: true };
  return {
    day: today,
    archive: false,
    notice: daysBetween(value, today) < 0 ? ARCHIVE_NOTICE.ahead : ARCHIVE_NOTICE.old,
  };
}

const isScore = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_POINTS * ROUNDS_PER_GAME;

/**
 * Keep a finished Daily Five's score. The first finish of a day is the one kept, so a replay
 * never improves it. Days that have left the archive are dropped. Pure.
 */
export function addDailyScore(
  scores: DailyScores,
  day: string,
  score: number,
  today: string,
): DailyScores {
  const out: Record<string, number> = {};
  for (const [d, s] of Object.entries(scores)) if (inArchive(d, today)) out[d] = s;
  if (inArchive(day, today) && isScore(score) && !(day in out)) out[day] = score;
  return out;
}

/** Read stored scores back: anything malformed is skipped, days out of the archive dropped. */
export function parseDailyScores(raw: string | null, today: string): DailyScores {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
  const out: Record<string, number> = {};
  for (const [d, s] of Object.entries(data as Record<string, unknown>)) {
    if (inArchive(d, today) && isScore(s)) out[d] = s;
  }
  return out;
}

/** Minimal storage surface, so tests can pass a fake (including one that throws). */
export type ScoreStore = Pick<Storage, "getItem" | "setItem">;

function browserStore(): ScoreStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadDailyScores(
  today: string,
  store: ScoreStore | null = browserStore(),
): DailyScores {
  try {
    return parseDailyScores(store?.getItem(DAILY_SCORES_KEY) ?? null, today);
  } catch {
    return {};
  }
}

/** Keep one finished Daily Five's score and return the scores (saved best effort). */
export function rememberDailyScore(
  day: string,
  score: number,
  today: string,
  store: ScoreStore | null = browserStore(),
): DailyScores {
  const next = addDailyScore(loadDailyScores(today, store), day, score, today);
  try {
    store?.setItem(DAILY_SCORES_KEY, JSON.stringify(next));
  } catch {
    // Quota or privacy mode: the calendar still shows this visit's games.
  }
  return next;
}
