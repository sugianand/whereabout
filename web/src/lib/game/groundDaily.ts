/**
 * Today's What's on the ground?: five photos a day that everyone calls in the same order, dealt
 * from the UTC date by the free games' own even deal (`dealGround` in ./onTheGround.ts), so each
 * photo's land cover is still drawn by a fair die and always calling built-up is still a guess.
 *
 * One try a day: the calls are kept after every photo (./dailyRuns.ts), so a reload picks up at the
 * next photo and a day with all five called shows its result instead of dealing it again. A call
 * is kept whole (your cover, the truth and Atlas's read), so the day reads back exactly as played.
 * It never touches the free games' best, and the share line is a score and squares only, so it
 * spoils no photo.
 */

import { isGroundCover } from "@/lib/trueClues";

import { hashSeed } from "./daily";
import { dailyRunUrl, loadKeptDays, rememberKeptDay } from "./dailyRuns";
import {
  GROUND_PHOTOS,
  dealGround,
  groundTotals,
  type GroundMap,
  type GroundResult,
} from "./onTheGround";

export const GROUND_DAILY_KEY = "whereabout:on-the-ground-daily";

/** One day's game: the photos called so far, in the order dealt. */
export interface GroundDay {
  results: readonly GroundResult[];
}

/** The day's seed, apart from the Daily Five's and the other daily games'. */
export function groundDaySeed(day: string): number {
  return hashSeed(`whereabout:on-the-ground:${day}`);
}

/** The day's photos: the same for everyone on `day` with the same photos and covers. */
export function dailyGroundOrder(covers: GroundMap, day: string): string[] {
  return dealGround(covers, groundDaySeed(day));
}

function parseResult(value: unknown): GroundResult | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, picked, truth, atlas } = value as Record<string, unknown>;
  if (typeof id !== "string" || id === "" || !isGroundCover(picked) || !isGroundCover(truth))
    return null;
  if (atlas !== null && !isGroundCover(atlas)) return null;
  return { id, picked, truth, correct: picked === truth, atlas };
}

/** A stored day read back only in the shape `rememberGroundDay` writes, else null. */
export function parseGroundDay(value: unknown): GroundDay | null {
  if (typeof value !== "object" || value === null) return null;
  const { results: raw } = value as Record<string, unknown>;
  if (!Array.isArray(raw) || raw.length > GROUND_PHOTOS) return null;
  const results = raw.map(parseResult);
  if (!results.every((r) => r !== null)) return null;
  if (new Set(results.map((r) => r!.id)).size !== results.length) return null;
  return { results: results as GroundResult[] };
}

/** Every day kept in this browser, by day; anything malformed is skipped. */
export function loadGroundDays(): Record<string, GroundDay> {
  return loadKeptDays(GROUND_DAILY_KEY, parseGroundDay);
}

/** The game kept for `day`, or null when it hasn't been started in this browser. */
export function loadGroundDay(day: string): GroundDay | null {
  return loadGroundDays()[day] ?? null;
}

/** Keep `results` as the game for `day`, written in the shape `parseGroundDay` reads. */
export function rememberGroundDay(day: string, results: readonly GroundResult[]): void {
  const entry: GroundDay = {
    results: results.map(({ id, picked, truth, atlas }) => ({
      id,
      picked,
      truth,
      atlas,
      correct: picked === truth,
    })),
  };
  rememberKeptDay(GROUND_DAILY_KEY, day, entry, parseGroundDay);
}

/**
 * The share line: the day, the score, a square a photo (green right, red wrong) and Atlas's tally
 * on the photos it read. Only counts and squares, so it can never name a place or a land cover.
 */
export function groundDailyShare(
  day: string,
  results: readonly GroundResult[],
  href: string,
): string {
  const { right, atlasRight, atlasRead } = groundTotals(results);
  const lines = [
    `Whereabout · What's on the ground? · ${day}`,
    `🌱 ${right} of ${results.length}`,
    results.map((r) => (r.correct ? "🟩" : "🟥")).join(""),
  ];
  if (atlasRead > 0) {
    const silent = results.length - atlasRead;
    lines.push(
      `Atlas: ${atlasRight} of ${atlasRead}${silent > 0 ? ` (no read on ${silent})` : ""}`,
    );
  }
  lines.push(dailyRunUrl(href));
  return lines.join("\n");
}
