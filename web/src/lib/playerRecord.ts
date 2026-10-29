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

import { earnedBadges, isBadgeId, mergeBadges, type BadgeId } from "@/lib/badges";
import { CONTINENTS, continentOf, type Continent } from "@/lib/continents";
import { dayKey } from "@/lib/game/daily";
import type { RoundResult } from "@/lib/game/state";

export const RECORD_KEY = "whereabout:record";

/** One continent's rounds: all of them, the ones Atlas also guessed, and the ones you won. */
export interface ContinentTally {
  rounds: number;
  vsAtlas: number;
  won: number;
}

/** Tallies by the continent each photo was taken on; continents never played are absent. */
export type ContinentRecord = Partial<Record<Continent, ContinentTally>>;

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
  /** Rounds played and won against Atlas, by the continent of each photo. */
  continents: ContinentRecord;
  /** Badges earned so far (`lib/badges.ts`), in `BADGE_IDS` order. */
  badges: BadgeId[];
}

/** What one finished game adds to the record. */
export interface FinishedGame {
  score: number;
  roundsVsAtlas: number;
  roundsWon: number;
  /** The Daily Five's puzzle day, or null for a fresh game. */
  daily: string | null;
  /** This game's rounds by continent (`tallyContinents`); absent adds none. */
  continents?: ContinentRecord;
  /** The closest pin of the game in km, or null with no pin; absent counts as none. */
  closestKm?: number | null;
  /** A Hard game in which the player outscored Atlas (`gameFeats` in `lib/badges.ts`). */
  hardWon?: boolean;
}

export const EMPTY_RECORD: PlayerRecord = {
  games: 0,
  roundsVsAtlas: 0,
  roundsWon: 0,
  best: null,
  lastDaily: null,
  streak: 0,
  bestStreak: 0,
  continents: {},
  badges: [],
};

/**
 * One game's rounds by continent, from each answer's country. A round counts as won exactly as
 * the summary counts it (`totals`): Atlas guessed and you scored more. Answers with no country
 * (or one the continent table doesn't know) join no continent.
 */
export function tallyContinents(
  results: readonly Pick<RoundResult, "reveal" | "atlas">[],
): ContinentRecord {
  const out: ContinentRecord = {};
  for (const r of results) {
    const c = continentOf(r.reveal.answer.country);
    if (!c) continue;
    const t = out[c] ?? { rounds: 0, vsAtlas: 0, won: 0 };
    t.rounds += 1;
    if (r.atlas) {
      t.vsAtlas += 1;
      if (r.reveal.score > r.atlas.score) t.won += 1;
    }
    out[c] = t;
  }
  return out;
}

/** Add two continent records together. Pure; keys follow `CONTINENTS` order. */
export function addContinents(a: ContinentRecord, b: ContinentRecord): ContinentRecord {
  const out: ContinentRecord = {};
  for (const c of CONTINENTS) {
    const x = a[c];
    const y = b[c];
    if (!x && !y) continue;
    out[c] = {
      rounds: (x?.rounds ?? 0) + (y?.rounds ?? 0),
      vsAtlas: (x?.vsAtlas ?? 0) + (y?.vsAtlas ?? 0),
      won: (x?.won ?? 0) + (y?.won ?? 0),
    };
  }
  return out;
}

/** Rounds against Atlas a continent needs before it is ranked; fewer says little. */
export const MIN_RANKED_ROUNDS = 3;

export interface ContinentStanding {
  continent: Continent;
  won: number;
  vsAtlas: number;
}

/**
 * The continents you beat Atlas on most and least often, by share of rounds won against it.
 * Only continents with at least `minRounds` rounds against Atlas are ranked, and there is no
 * answer until two of them differ: one continent, or all at the same share, ranks nothing.
 * Ties go to the continent with more rounds (the steadier figure), then `CONTINENTS` order.
 */
export function continentStandings(
  record: ContinentRecord,
  minRounds = MIN_RANKED_ROUNDS,
): { most: ContinentStanding; least: ContinentStanding } | null {
  const ranked: ContinentStanding[] = [];
  for (const c of CONTINENTS) {
    const t = record[c];
    if (t && t.vsAtlas >= minRounds) ranked.push({ continent: c, won: t.won, vsAtlas: t.vsAtlas });
  }
  if (ranked.length < 2) return null;
  // Compare shares by cross-multiplying, so 2 of 3 and 4 of 6 are exactly equal.
  const cmp = (a: ContinentStanding, b: ContinentStanding) => a.won * b.vsAtlas - b.won * a.vsAtlas;
  const steadier = (a: ContinentStanding, b: ContinentStanding) => b.vsAtlas - a.vsAtlas;
  const most = [...ranked].sort((a, b) => -cmp(a, b) || steadier(a, b))[0];
  const least = [...ranked].sort((a, b) => cmp(a, b) || steadier(a, b))[0];
  return cmp(most, least) === 0 ? null : { most, least };
}

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
    continents: addContinents(record.continents, game.continents ?? {}),
    badges: record.badges,
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
  next.badges = mergeBadges(record.badges, earnedBadges(next, game));
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

const KNOWN_CONTINENTS: ReadonlySet<string> = new Set(CONTINENTS);

/**
 * Read the stored continent tallies. Records saved before continents were kept have none, and
 * a malformed entry drops only the continents, never the games, best score or streak.
 */
function parseContinents(v: unknown): ContinentRecord {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const out: ContinentRecord = {};
  for (const [k, t] of Object.entries(v as Record<string, unknown>)) {
    if (!KNOWN_CONTINENTS.has(k) || typeof t !== "object" || t === null) return {};
    const { rounds, vsAtlas, won } = t as Record<string, unknown>;
    if (!count(rounds) || !count(vsAtlas) || !count(won) || won > vsAtlas || vsAtlas > rounds) {
      return {};
    }
    out[k as Continent] = { rounds, vsAtlas, won };
  }
  return addContinents(out, {});
}

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
  const record: PlayerRecord = {
    games: r.games as number,
    roundsVsAtlas: r.roundsVsAtlas as number,
    roundsWon: r.roundsWon as number,
    best: r.best as number | null,
    lastDaily: r.lastDaily as string | null,
    streak: r.streak as number,
    bestStreak: r.bestStreak as number,
    continents: parseContinents(r.continents),
    badges: [],
  };
  // Badges the totals prove are restored, so records kept before badges existed lose nothing;
  // the rest must be known badge ids, or the stored list is dropped (the totals still count).
  const stored =
    Array.isArray(r.badges) && r.badges.every(isBadgeId) ? (r.badges as BadgeId[]) : [];
  record.badges = mergeBadges(stored, earnedBadges(record));
  return record;
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
