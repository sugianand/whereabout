/**
 * Today's Odd one out: one run a day that deals everyone the same quads, from a random stream
 * seeded by the UTC date (its own seed, apart from the Daily Five's and Further North's), so
 * friends can compare how far they got on the same photos.
 *
 * The quads are dealt by the free runs' own `dealQuad`, one after another, keeping back photos
 * already dealt while each continent has fresh ones. Quad n is always the nth draw from the
 * day's stream, so a run picked back up after a reload replays the stream to the quad it was on
 * (`dailyOddDealer(...).skip(streak)`) and never deals a fresh start on photos already seen.
 *
 * One try a day, kept per day in this browser under its own key (src/lib/game/dailyRuns.ts),
 * apart from the free runs' best; the share line is counts only, so it spoils no photo.
 */

import { hashSeed, mulberry32 } from "./daily";
import {
  dailyRunUrl,
  loadDailyRun,
  rememberDailyRun,
  runSquares,
  type DailyRun,
} from "./dailyRuns";
import { dealQuad, type Quad } from "./oddOneOut";
import type { Regions } from "./regions";

export const ODD_DAILY_KEY = "whereabout:odd-one-out-daily";

/** Deals the day's quads in order. */
export interface OddDealer {
  /** The next quad of the day, or null when the deck can't deal one. */
  next(): Quad | null;
  /** Skip the next `n` quads (the ones a resumed run already answered). */
  skip(n: number): void;
}

/** The day's quads, the same for everyone on `day` with the same deck. */
export function dailyOddDealer(regions: Regions, day: string): OddDealer {
  const random = mulberry32(hashSeed(`whereabout:odd-one-out:${day}`));
  const seen = new Set<string>();
  const next = () => {
    const quad = dealQuad(regions, random, seen);
    quad?.ids.forEach((id) => seen.add(id));
    return quad;
  };
  return {
    next,
    skip(n) {
      for (let i = 0; i < n; i++) next();
    },
  };
}

/** The run kept for `day`, or null when it hasn't been started in this browser. */
export function loadOddDay(day: string): DailyRun | null {
  return loadDailyRun(ODD_DAILY_KEY, day);
}

/** Keep `entry` as today's run for `day`. */
export function rememberOddDay(day: string, entry: DailyRun): void {
  rememberDailyRun(ODD_DAILY_KEY, day, entry);
}

/**
 * The share line: the day, the streak as one green square a quad and a red one for the miss,
 * and Atlas's tally on the same quads. Only counts, so it can never name a place or a photo.
 */
export function oddDailyShare(day: string, entry: DailyRun, href: string): string {
  const lines = [
    `Whereabout · Odd one out · ${day}`,
    `🧩 ${entry.streak} quad${entry.streak === 1 ? "" : "s"} in a row`,
    runSquares(entry),
  ];
  if (entry.atlasPlayed > 0) lines.push(`Atlas: ${entry.atlasRight} of ${entry.atlasPlayed}`);
  lines.push(dailyRunUrl(href));
  return lines.join("\n");
}
