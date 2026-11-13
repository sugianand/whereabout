/**
 * Today's Left or right?: one run a day that everyone plays on the same photos in the same order,
 * dealt from the UTC date by the free runs' own even deal (`leftRightOrder` in ./leftRight.ts),
 * so the left and right piles are drawn by a fair coin and always calling one side is still a
 * coin flip.
 *
 * One try a day: the run is kept after every call (./dailyRuns.ts), so a reload picks up at the
 * same photo and a finished run shows the day's result instead of dealing it again. It never
 * touches the free runs' best, and the share line is counts only, so it spoils no photo.
 */

import { hashSeed } from "./daily";
import {
  dailyRunUrl,
  loadDailyRun,
  loadDailyRuns,
  rememberDailyRun,
  runSquares,
  type DailyRun,
} from "./dailyRuns";
import { leftRightOrder, type SideMap } from "./leftRight";

export const SIDE_DAILY_KEY = "whereabout:left-right-daily";

/** How one day's run stands. In a run still going, the next photo is `order[streak]`. */
export type SideDay = DailyRun;

/** The day's seed, apart from the Daily Five's and the other quick games'. */
export function sideDaySeed(day: string): number {
  return hashSeed(`whereabout:left-right:${day}`);
}

/** The day's photos: the same for everyone on `day` with the same photos and sides. */
export function dailySideOrder(sides: SideMap, day: string): string[] {
  return leftRightOrder(sides, sideDaySeed(day));
}

/** Every day kept in this browser, by day; anything malformed is skipped. */
export function loadSideDays(): Record<string, SideDay> {
  return loadDailyRuns(SIDE_DAILY_KEY);
}

/** The run kept for `day`, or null when it hasn't been started in this browser. */
export function loadSideDay(day: string): SideDay | null {
  return loadDailyRun(SIDE_DAILY_KEY, day);
}

/** Keep `entry` as the run for `day`, with only the latest days kept. */
export function rememberSideDay(day: string, entry: SideDay): void {
  rememberDailyRun(SIDE_DAILY_KEY, day, entry);
}

/**
 * The share line: the day, the run as one green square a right call (and a red one for the
 * miss, or a flag when every photo was called), and Atlas's tally on the same photos.
 */
export function sideDailyShare(day: string, entry: SideDay, href: string): string {
  const photos = `${entry.streak} photo${entry.streak === 1 ? "" : "s"} in a row`;
  const lines = [
    `Whereabout · Left or right? · ${day}`,
    `🛣️ ${photos}${entry.ended === "cleared" ? ", every photo" : ""}`,
    runSquares(entry),
  ];
  if (entry.atlasPlayed > 0) lines.push(`Atlas: ${entry.atlasRight} of ${entry.atlasPlayed}`);
  lines.push(dailyRunUrl(href));
  return lines.join("\n");
}
