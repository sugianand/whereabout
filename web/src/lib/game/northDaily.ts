/**
 * Today's Further North: one run a day that everyone plays in the same order, dealt from the UTC
 * date by the seeded shuffle the Daily Five uses (src/lib/game/daily.ts), so friends can compare
 * how far they got on the same pairs.
 *
 * One try a day: the run is kept after every pick, so leaving mid-run picks up at the same pair
 * (a reload never deals a fresh start on pairs already seen), and a finished run shows the day's
 * result instead of playing again. The day's result is kept per day in this browser
 * (src/lib/game/dailyRuns.ts), apart from the free runs' best, and the share line is built from
 * numbers alone, so it spoils no pair.
 */

import { hashSeed, seededShuffle } from "./daily";
import {
  DAYS_KEPT,
  dailyRunUrl,
  loadDailyRun,
  loadDailyRuns,
  parseDailyRun,
  rememberDailyRun,
  runSquares,
  runToday,
  untilNextRun,
  type DailyRun,
} from "./dailyRuns";

export const NORTH_DAILY_KEY = "whereabout:further-north-daily";
/** Days kept in the browser; older ones are dropped as new ones are played. */
export const NORTH_DAYS_KEPT = DAYS_KEPT;

/** How one day's run stands. In a run still going, the next pair is `order[streak]`. */
export type NorthDay = DailyRun;

/** The day's photo order: the same for everyone on `day` with the same deck. */
export function dailyNorthOrder(ids: readonly string[], day: string): string[] {
  return seededShuffle(ids, hashSeed(`whereabout:further-north:${day}`));
}

export const northToday = runToday;
export const parseNorthDay = parseDailyRun;
export const northDailyUrl = dailyRunUrl;
export const untilNextNorth = untilNextRun;

/** Every day kept in this browser, by day; anything malformed is skipped. */
export function loadNorthDays(): Record<string, NorthDay> {
  return loadDailyRuns(NORTH_DAILY_KEY);
}

/** The run kept for `day`, or null when it hasn't been started in this browser. */
export function loadNorthDay(day: string): NorthDay | null {
  return loadDailyRun(NORTH_DAILY_KEY, day);
}

/** Keep `entry` as the run for `day`, holding only the latest `NORTH_DAYS_KEPT` days. */
export function rememberNorthDay(day: string, entry: NorthDay): void {
  rememberDailyRun(NORTH_DAILY_KEY, day, entry);
}

/**
 * The share line: the day, the streak as one green square a pair (and a red one for the miss),
 * and Atlas's tally on the same pairs. Only counts, so it can never name a place or a photo.
 */
export function northDailyShare(day: string, entry: NorthDay, href: string): string {
  const pairs = `${entry.streak} pair${entry.streak === 1 ? "" : "s"} in a row`;
  const lines = [
    `Whereabout · Further North · ${day}`,
    `⬆️ ${pairs}${entry.ended === "cleared" ? ", every photo" : ""}`,
    runSquares(entry),
  ];
  if (entry.atlasPlayed > 0) lines.push(`Atlas: ${entry.atlasRight} of ${entry.atlasPlayed}`);
  lines.push(dailyRunUrl(href));
  return lines.join("\n");
}
