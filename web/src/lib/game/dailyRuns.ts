/**
 * Today's runs of the quick games (Further North, Odd one out): one try a day, kept in this
 * browser per UTC day under each game's own key, so a reload resumes a run and a finished day
 * shows its result instead of dealing it again.
 *
 * A run is only counts (the streak and Atlas's tally) and how it ended, so it can be shared
 * without spoiling a photo. Each day is read back only in the shape it is written in; anything
 * else is skipped. Storage is best effort: blocked storage keeps the run for this visit only.
 */

import { dayKey } from "./daily";
import { isDayKey } from "./dailyArchive";

/** Days kept in the browser for each game; older ones are dropped as new ones are played. */
export const DAYS_KEPT = 30;

/** How one day's run stands. */
export interface DailyRun {
  /** Right picks in a row so far. */
  streak: number;
  /** Rounds Atlas got right, and rounds it played. */
  atlasRight: number;
  atlasPlayed: number;
  /** Null while the run is still going; "miss" on a wrong pick; "cleared" after every photo. */
  ended: "miss" | "cleared" | null;
}

/** A run not yet started: nothing right, nothing played. */
export const FRESH_RUN: DailyRun = { streak: 0, atlasRight: 0, atlasPlayed: 0, ended: null };

/** Today's UTC day, as the Daily Five counts it. */
export function runToday(now: Date = new Date()): string {
  return dayKey(now);
}

const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** A stored day read back only in the shape `rememberDailyRun` writes, else null. */
export function parseDailyRun(value: unknown): DailyRun | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!count(v.streak) || !count(v.atlasRight) || !count(v.atlasPlayed)) return null;
  if (v.atlasRight > v.atlasPlayed) return null;
  if (v.ended !== null && v.ended !== "miss" && v.ended !== "cleared") return null;
  return {
    streak: v.streak,
    atlasRight: v.atlasRight,
    atlasPlayed: v.atlasPlayed,
    ended: v.ended,
  };
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Every day kept under `key` in this browser, by day; anything malformed is skipped. */
export function loadDailyRuns(key: string): Record<string, DailyRun> {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const days: Record<string, DailyRun> = {};
    for (const [day, entry] of Object.entries(value)) {
      const parsed = isDayKey(day) ? parseDailyRun(entry) : null;
      if (parsed) days[day] = parsed;
    }
    return days;
  } catch {
    return {};
  }
}

/** The run kept under `key` for `day`, or null when it hasn't been started in this browser. */
export function loadDailyRun(key: string, day: string): DailyRun | null {
  return loadDailyRuns(key)[day] ?? null;
}

/** Keep `entry` as the run for `day` under `key`, holding only the latest `DAYS_KEPT` days. */
export function rememberDailyRun(key: string, day: string, entry: DailyRun): void {
  const days = { ...loadDailyRuns(key), [day]: entry };
  const kept = Object.keys(days).sort().slice(-DAYS_KEPT);
  try {
    storage()?.setItem(key, JSON.stringify(Object.fromEntries(kept.map((d) => [d, days[d]]))));
  } catch {
    // Private mode or full storage.
  }
}

/** The address to share: today's run's own page, with any query or hash dropped. */
export function dailyRunUrl(href: string): string {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** One green square a right pick (capped at 30), then a red one for the miss or a flag. */
export function runSquares(entry: DailyRun): string {
  const squares = "🟩".repeat(Math.min(entry.streak, 30)) + (entry.streak > 30 ? "…" : "");
  const end = entry.ended === "miss" ? "🟥" : entry.ended === "cleared" ? "🏁" : "";
  return squares + end;
}

/** "5h 12m" until the next UTC day's run. */
export function untilNextRun(now: Date = new Date()): string {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const minutes = Math.max(1, Math.ceil((next - now.getTime()) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
