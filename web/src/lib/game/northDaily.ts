/**
 * Today's Further North: one run a day that everyone plays in the same order, dealt from the UTC
 * date by the seeded shuffle the Daily Five uses (src/lib/game/daily.ts), so friends can compare
 * how far they got on the same pairs.
 *
 * One try a day: the run is kept after every pick, so leaving mid-run picks up at the same pair
 * (a reload never deals a fresh start on pairs already seen), and a finished run shows the day's
 * result instead of playing again. The day's result is kept per day in this browser, apart from
 * the free runs' best, and the share line is built from numbers alone, so it spoils no pair.
 */

import { dayKey, hashSeed, seededShuffle } from "./daily";
import { isDayKey } from "./dailyArchive";

export const NORTH_DAILY_KEY = "whereabout:further-north-daily";
/** Days kept in the browser; older ones are dropped as new ones are played. */
export const NORTH_DAYS_KEPT = 30;

/** How one day's run stands. */
export interface NorthDay {
  /** Right picks in a row so far. In a run still going, the next pair is `order[streak]`. */
  streak: number;
  /** Pairs Atlas got right, and pairs it played (both photos guessed). */
  atlasRight: number;
  atlasPlayed: number;
  /** Null while the run is still going; "miss" on a wrong pick; "cleared" after every photo. */
  ended: "miss" | "cleared" | null;
}

/** The day's photo order: the same for everyone on `day` with the same deck. */
export function dailyNorthOrder(ids: readonly string[], day: string): string[] {
  return seededShuffle(ids, hashSeed(`whereabout:further-north:${day}`));
}

/** Today's UTC day, as the Daily Five counts it. */
export function northToday(now: Date = new Date()): string {
  return dayKey(now);
}

const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** A stored day read back only in the shape `rememberNorthDay` writes, else null. */
export function parseNorthDay(value: unknown): NorthDay | null {
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

/** Every day kept in this browser, by day; anything malformed is skipped. */
export function loadNorthDays(): Record<string, NorthDay> {
  try {
    const raw = storage()?.getItem(NORTH_DAILY_KEY);
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const days: Record<string, NorthDay> = {};
    for (const [day, entry] of Object.entries(value)) {
      const parsed = isDayKey(day) ? parseNorthDay(entry) : null;
      if (parsed) days[day] = parsed;
    }
    return days;
  } catch {
    return {};
  }
}

/** The run kept for `day`, or null when it hasn't been started in this browser. */
export function loadNorthDay(day: string): NorthDay | null {
  return loadNorthDays()[day] ?? null;
}

/**
 * Keep `entry` as the run for `day`, holding only the latest `NORTH_DAYS_KEPT` days. Best effort:
 * blocked storage keeps the run for this visit only.
 */
export function rememberNorthDay(day: string, entry: NorthDay): void {
  const days = { ...loadNorthDays(), [day]: entry };
  const kept = Object.keys(days).sort().slice(-NORTH_DAYS_KEPT);
  try {
    storage()?.setItem(
      NORTH_DAILY_KEY,
      JSON.stringify(Object.fromEntries(kept.map((d) => [d, days[d]]))),
    );
  } catch {
    // Private mode or full storage.
  }
}

/** The address to share: today's run's own page, with any query or hash dropped. */
export function northDailyUrl(href: string): string {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * The share line: the day, the streak as one green square a pair (and a red one for the miss),
 * and Atlas's tally on the same pairs. Only counts, so it can never name a place or a photo.
 */
export function northDailyShare(day: string, entry: NorthDay, href: string): string {
  const squares = "🟩".repeat(Math.min(entry.streak, 30)) + (entry.streak > 30 ? "…" : "");
  const end = entry.ended === "miss" ? "🟥" : entry.ended === "cleared" ? "🏁" : "";
  const pairs = `${entry.streak} pair${entry.streak === 1 ? "" : "s"} in a row`;
  const lines = [
    `Whereabout · Further North · ${day}`,
    `⬆️ ${pairs}${entry.ended === "cleared" ? ", every photo" : ""}`,
    `${squares}${end}`,
  ];
  if (entry.atlasPlayed > 0) lines.push(`Atlas: ${entry.atlasRight} of ${entry.atlasPlayed}`);
  lines.push(northDailyUrl(href));
  return lines.join("\n");
}

/** "5h 12m" until the next UTC day's run. */
export function untilNextNorth(now: Date = new Date()): string {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const minutes = Math.max(1, Math.ceil((next - now.getTime()) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
