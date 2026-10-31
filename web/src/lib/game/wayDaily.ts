/**
 * Today's Which way?: one journey a day that everyone sets off on from the same photo, through
 * the same stops, dealt from the UTC date by the seeded shuffle the Daily Five uses (its own
 * seed, apart from the Daily Five's and the other quick games'), so friends can compare how far
 * they travelled.
 *
 * Which way? skips a stop that makes no fair question with where you stand (one city, or nearly
 * the other side of the planet), so the streak alone can't say where in the day's order a run
 * stands. The run keeps the photo you stand at (`at`) after every right pick, and a reload picks
 * the journey back up from there (`resumeWayOrder`): the skips depend only on where the photos
 * were taken, so a run resumed is the run everyone else plays from that stop on.
 *
 * One try a day, kept per day in this browser under its own key (src/lib/game/dailyRuns.ts),
 * apart from the free runs' best; the share line is counts only, so it spoils no photo.
 */

import { hashSeed, seededShuffle } from "./daily";
import {
  dailyRunUrl,
  loadDailyRun,
  rememberDailyRun,
  runSquares,
  type DailyRun,
} from "./dailyRuns";

export const WAY_DAILY_KEY = "whereabout:which-way-daily";

/** The day's photo order: the same for everyone on `day` with the same deck. */
export function dailyWayOrder(ids: readonly string[], day: string): string[] {
  return seededShuffle(ids, hashSeed(`whereabout:which-way:${day}`));
}

/**
 * The order a kept run plays on from: the day's order from the photo it stands at. A run not
 * started, or standing at a photo the deck no longer has, plays the day from the start.
 */
export function resumeWayOrder(order: readonly string[], kept: DailyRun | null): string[] {
  const from = kept?.at ? order.indexOf(kept.at) : -1;
  return from > 0 ? order.slice(from) : [...order];
}

/** The run kept for `day`, or null when it hasn't been started in this browser. */
export function loadWayDay(day: string): DailyRun | null {
  return loadDailyRun(WAY_DAILY_KEY, day);
}

/** Keep `entry` as today's run for `day`. */
export function rememberWayDay(day: string, entry: DailyRun): void {
  rememberDailyRun(WAY_DAILY_KEY, day, entry);
}

/**
 * The share line: the day, the journey as one green square a stop and a red one for the miss,
 * and Atlas's tally on the same stops. Only counts, so it can never name a place or a photo.
 */
export function wayDailyShare(day: string, entry: DailyRun, href: string): string {
  const stops = `${entry.streak} stop${entry.streak === 1 ? "" : "s"} in a row`;
  const lines = [
    `Whereabout · Which way? · ${day}`,
    `🧭 ${stops}${entry.ended === "cleared" ? ", every photo" : ""}`,
    runSquares(entry),
  ];
  if (entry.atlasPlayed > 0) lines.push(`Atlas: ${entry.atlasRight} of ${entry.atlasPlayed}`);
  lines.push(dailyRunUrl(href));
  return lines.join("\n");
}
