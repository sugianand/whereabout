/**
 * Today's Name the country: one run a day that deals everyone the same photos with the same four
 * names, from the UTC date (its own seed, apart from the other daily games'), so friends can
 * compare how far they got on the same photos.
 *
 * The day's seed is the run's seed: it shuffles the deck and, through `nameSeed`, settles each
 * photo's names, so both are the same for everyone and after a reload. The next photo of a run
 * still going is `order[streak]`, since a right tap is the only way past one.
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

export const NAME_DAILY_KEY = "whereabout:name-country-daily";

/** The day's run seed: settles the order and each photo's four names. */
export function dailyNameSeed(day: string): number {
  return hashSeed(`whereabout:name-country:${day}`);
}

/** The day's photo order: the same for everyone on `day` with the same deck. */
export function dailyNameOrder(ids: readonly string[], day: string): string[] {
  return seededShuffle(ids, dailyNameSeed(day));
}

/** The run kept for `day`, or null when it hasn't been started in this browser. */
export function loadNameDay(day: string): DailyRun | null {
  return loadDailyRun(NAME_DAILY_KEY, day);
}

/** Keep `entry` as today's run for `day`. */
export function rememberNameDay(day: string, entry: DailyRun): void {
  rememberDailyRun(NAME_DAILY_KEY, day, entry);
}

/**
 * The share line: the day, the streak as one green square a photo and a red one for the miss,
 * and Atlas's tally on the same photos. Only counts, so it can never name a place or a photo.
 */
export function nameDailyShare(day: string, entry: DailyRun, href: string): string {
  const named = `${entry.streak} ${entry.streak === 1 ? "country" : "countries"} in a row`;
  const lines = [
    `Whereabout · Name the country · ${day}`,
    `🗺️ ${named}${entry.ended === "cleared" ? ", every photo" : ""}`,
    runSquares(entry),
  ];
  if (entry.atlasPlayed > 0) lines.push(`Atlas: ${entry.atlasRight} of ${entry.atlasPlayed}`);
  lines.push(dailyRunUrl(href));
  return lines.join("\n");
}
