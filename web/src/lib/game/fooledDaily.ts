/**
 * Today's Which fooled Atlas?: one run a day that everyone plays in the same order, dealt from the
 * UTC date by the seeded shuffle the Daily Five uses (src/lib/game/daily.ts) over the photos Atlas
 * pinned, so friends can compare how far they got on the same pairs.
 *
 * One try a day: the run is kept after every pick, so leaving mid-run picks up at the same pair
 * (a reload never deals a fresh start on pairs already seen), and a finished run shows the day's
 * result instead of playing again. The day's result is kept per day in this browser
 * (src/lib/game/dailyRuns.ts), apart from the free runs' best, and the share line is built from
 * counts alone, so it names no place and gives away no miss.
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

export const FOOLED_DAILY_KEY = "whereabout:fooled-atlas-daily";
/** Days kept in the browser; older ones are dropped as new ones are played. */
export const FOOLED_DAYS_KEPT = DAYS_KEPT;

/** How one day's run stands. In a run still going, the next pair is `order[streak]` and after. */
export type FooledDay = DailyRun;

/**
 * The day's photo order: the same for everyone on `day` with the same photos, on its own seed so
 * it is never Further North's or the Daily Five's order for the day.
 */
export function dailyFooledOrder(ids: readonly string[], day: string): string[] {
  return seededShuffle(ids, hashSeed(`whereabout:fooled-atlas:${day}`));
}

export const fooledToday = runToday;
export const parseFooledDay = parseDailyRun;
export const fooledDailyUrl = dailyRunUrl;
export const untilNextFooled = untilNextRun;

/** Every day kept in this browser, by day; anything malformed is skipped. */
export function loadFooledDays(): Record<string, FooledDay> {
  return loadDailyRuns(FOOLED_DAILY_KEY);
}

/** The run kept for `day`, or null when it hasn't been started in this browser. */
export function loadFooledDay(day: string): FooledDay | null {
  return loadDailyRun(FOOLED_DAILY_KEY, day);
}

/** Keep `entry` as the run for `day`, holding only the latest `FOOLED_DAYS_KEPT` days. */
export function rememberFooledDay(day: string, entry: FooledDay): void {
  rememberDailyRun(FOOLED_DAILY_KEY, day, entry);
}

/**
 * The share line: the day, the streak as one green square a pair (and a red one for the miss),
 * and Atlas's own sureness on the same pairs. Only counts, so it never names a place or a miss.
 */
export function fooledDailyShare(day: string, entry: FooledDay, href: string): string {
  const pairs = `${entry.streak} pair${entry.streak === 1 ? "" : "s"} in a row`;
  const lines = [
    `Whereabout · Which fooled Atlas? · ${day}`,
    `🤖 ${pairs}${entry.ended === "cleared" ? ", every photo" : ""}`,
    runSquares(entry),
  ];
  if (entry.atlasPlayed > 0)
    lines.push(`Atlas's own pick: ${entry.atlasRight} of ${entry.atlasPlayed}`);
  lines.push(dailyRunUrl(href));
  return lines.join("\n");
}
