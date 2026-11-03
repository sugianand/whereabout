/**
 * Today's How far apart?: five pairs a day, dealt from the UTC date by the seeded shuffle the
 * Daily Five uses (its own seed, apart from the other daily games') and paired by the free game's
 * near-and-far deal, so everyone sets the slider on the same photos and friends can compare.
 *
 * Unlike the streak games, a game here is its pairs' scores, so the day keeps every pair's result.
 * It is written after each pair: a reload picks up at the next pair with the score so far, and a
 * day with every pair answered shows its result instead of dealing again. Kept per day in this
 * browser (src/lib/game/dailyRuns.ts), apart from the free games' best; the share line is points
 * only, so it spoils no photo.
 */

import { hashSeed, seededShuffle } from "./daily";
import { dailyRunUrl, loadKeptDays, rememberKeptDay } from "./dailyRuns";
import {
  PAIRS,
  PAIR_POINTS,
  atlasTotal,
  continentLookup,
  dealPairs,
  pairGrade,
  totalPoints,
  type Estimate,
  type Pair,
  type PairResult,
} from "./howFar";
import { formatPoints } from "@/lib/geo";

export const FAR_DAILY_KEY = "whereabout:how-far-daily";

/** One day's game: the pairs answered so far, in the order they were dealt. */
export interface FarDay {
  results: readonly PairResult[];
}

/** The day's pairs: the same for everyone on `day` with the same deck. */
export function dailyFarPairs(
  ids: readonly string[],
  regions: Readonly<Record<string, readonly string[] | undefined>>,
  day: string,
): Pair[] {
  const order = seededShuffle(ids, hashSeed(`whereabout:how-far:${day}`));
  return dealPairs(order, continentLookup(regions));
}

const distance = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function parseEstimate(value: unknown): Estimate | null {
  if (typeof value !== "object" || value === null) return null;
  const { km, ratio, points, tooFar } = value as Record<string, unknown>;
  if (!distance(km) || !distance(ratio) || ratio < 1 || typeof tooFar !== "boolean") return null;
  if (typeof points !== "number" || !Number.isInteger(points)) return null;
  if (points < 0 || points > PAIR_POINTS) return null;
  return { km, ratio, points, tooFar };
}

function parseResult(value: unknown): PairResult | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const you = parseEstimate(v.you);
  const atlas = v.atlas === null ? null : parseEstimate(v.atlas);
  if (!distance(v.actualKm) || !you || (v.atlas !== null && !atlas)) return null;
  return { actualKm: v.actualKm, you, atlas };
}

/** A stored day read back only in the shape `rememberFarDay` writes, else null. */
export function parseFarDay(value: unknown): FarDay | null {
  if (typeof value !== "object" || value === null) return null;
  const { results } = value as Record<string, unknown>;
  if (!Array.isArray(results) || results.length > PAIRS) return null;
  const parsed = results.map(parseResult);
  return parsed.every((r) => r !== null) ? { results: parsed as PairResult[] } : null;
}

/** The game kept for `day`, or null when it hasn't been started in this browser. */
export function loadFarDay(day: string): FarDay | null {
  return loadKeptDays(FAR_DAILY_KEY, parseFarDay)[day] ?? null;
}

/** Keep `entry` as the game for `day`. */
export function rememberFarDay(day: string, entry: FarDay): void {
  rememberKeptDay(FAR_DAILY_KEY, day, entry, parseFarDay);
}

const SQUARE = { close: "🟩", off: "🟨", miss: "🟥" } as const;

/**
 * The share line: the day, the total, a coloured square for each pair's points and Atlas's total
 * on the same pairs. Only points, so it can never name a place or give a distance away.
 */
export function farDailyShare(day: string, results: readonly PairResult[], href: string): string {
  const atlas = atlasTotal(results);
  const lines = [
    `Whereabout · How far apart? · ${day}`,
    `📏 ${formatPoints(totalPoints(results))} of ${formatPoints(results.length * PAIR_POINTS)}`,
    results.map((r) => SQUARE[pairGrade(r.you.points)]).join(""),
  ];
  if (atlas.played > 0) {
    const of = atlas.played === results.length ? "" : ` on ${atlas.played} of the pairs`;
    lines.push(`Atlas: ${formatPoints(atlas.points)}${of}`);
  }
  lines.push(dailyRunUrl(href));
  return lines.join("\n");
}
