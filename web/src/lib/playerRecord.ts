/**
 * Your record against Atlas: games played, rounds won against Atlas, your best game and your
 * Daily Five streak. It lives only in this browser (localStorage), best effort like the intro
 * card: when storage is blocked or throws, the game still plays and the summary still shows the
 * record of this visit.
 *
 * Streaks count Daily Five *puzzle days*, which are UTC calendar days (`dayKey` in
 * `lib/game/daily.ts`), not the player's local days. So a player is never penalised for their
 * time zone or for daylight-saving changes: two Daily Fives one UTC day apart extend the streak
 * wherever and whenever they were played, and replaying the same day's puzzle leaves it alone.
 */

import { dayKey } from "@/lib/game/daily";

export const RECORD_KEY = "whereabout:record";

export interface PlayerRecord {
  /** Finished games of any kind. */
  games: number;
  /** Rounds in which Atlas also guessed, and the ones the player scored more than Atlas. */
  roundsVsAtlas: number;
  roundsWon: number;
  /** The highest game score so far, or null before the first game. */
  best: number | null;
  /** The last Daily Five puzzle day finished ("2026-10-24"), the streak ending there, the best. */
  lastDaily: string | null;
  streak: number;
  bestStreak: number;
}

/** What one finished game adds to the record. */
export interface FinishedGame {
  score: number;
  roundsVsAtlas: number;
  roundsWon: number;
  /** The Daily Five's puzzle day, or null for a fresh game. */
  daily: string | null;
}

export const EMPTY_RECORD: PlayerRecord = {
  games: 0,
  roundsVsAtlas: 0,
  roundsWon: 0,
  best: null,
  lastDaily: null,
  streak: 0,
  bestStreak: 0,
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Whole UTC days from `a` to `b` (both "YYYY-MM-DD"); immune to local time and DST. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** Fold one finished game into the record. Pure: returns a new record. */
export function addGame(record: PlayerRecord, game: FinishedGame): PlayerRecord {
  const next: PlayerRecord = {
    ...record,
    games: record.games + 1,
    roundsVsAtlas: record.roundsVsAtlas + game.roundsVsAtlas,
    roundsWon: record.roundsWon + game.roundsWon,
    best: record.best === null ? game.score : Math.max(record.best, game.score),
  };
  if (game.daily && DAY.test(game.daily)) {
    const gap = record.lastDaily ? daysBetween(record.lastDaily, game.daily) : Infinity;
    if (gap === 1) next.streak = record.streak + 1;
    else if (gap > 1) next.streak = 1;
    // gap 0 replays today's puzzle; a negative gap is an older puzzle (a clock moved back).
    // Neither touches the streak.
    if (gap > 0) next.lastDaily = game.daily;
    next.bestStreak = Math.max(record.bestStreak, next.streak);
  }
  return next;
}

/**
 * The streak as it stands on `today`: still alive if the last Daily Five was today's or
 * yesterday's puzzle (there is still time to play today's), otherwise broken.
 */
export function currentStreak(record: PlayerRecord, today: Date): number {
  if (!record.lastDaily) return 0;
  const gap = daysBetween(record.lastDaily, dayKey(today));
  return gap <= 1 ? record.streak : 0;
}

const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** Read a stored record back, rejecting anything malformed rather than trusting it. */
export function parseRecord(raw: string | null): PlayerRecord {
  if (!raw) return EMPTY_RECORD;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return EMPTY_RECORD;
  }
  if (typeof data !== "object" || data === null) return EMPTY_RECORD;
  const r = data as Record<string, unknown>;
  const ok =
    count(r.games) &&
    count(r.roundsVsAtlas) &&
    count(r.roundsWon) &&
    r.roundsWon <= r.roundsVsAtlas &&
    (r.best === null || count(r.best)) &&
    (r.lastDaily === null || (typeof r.lastDaily === "string" && DAY.test(r.lastDaily))) &&
    count(r.streak) &&
    count(r.bestStreak) &&
    r.streak <= r.bestStreak;
  if (!ok) return EMPTY_RECORD;
  return {
    games: r.games as number,
    roundsVsAtlas: r.roundsVsAtlas as number,
    roundsWon: r.roundsWon as number,
    best: r.best as number | null,
    lastDaily: r.lastDaily as string | null,
    streak: r.streak as number,
    bestStreak: r.bestStreak as number,
  };
}

/** Minimal storage surface, so tests can pass a fake (including one that throws). */
export type RecordStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStore(): RecordStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // Touching localStorage itself can throw when storage is blocked.
  }
}

export function loadRecord(store: RecordStore | null = browserStore()): PlayerRecord {
  if (!store) return EMPTY_RECORD;
  try {
    return parseRecord(store.getItem(RECORD_KEY));
  } catch {
    return EMPTY_RECORD;
  }
}

/** Add a finished game to the stored record and return the new record (saved best effort). */
export function recordGame(
  game: FinishedGame,
  store: RecordStore | null = browserStore(),
): PlayerRecord {
  const next = addGame(loadRecord(store), game);
  try {
    store?.setItem(RECORD_KEY, JSON.stringify(next));
  } catch {
    // Quota or privacy mode: the summary still shows this visit's record.
  }
  return next;
}

/** Forget the record in this browser. */
export function resetRecord(store: RecordStore | null = browserStore()): PlayerRecord {
  try {
    store?.removeItem(RECORD_KEY);
  } catch {
    // Nothing stored that we could reach; the record shown is reset either way.
  }
  return EMPTY_RECORD;
}
