/**
 * Today's Spot the clue: five photos a day, dealt from the UTC date by the seeded shuffle the
 * Daily Five uses (its own seed, apart from the other daily games'), so friends read Atlas's eyes
 * on the same photos.
 *
 * One try a day: the squares are kept after every photo (./dailyRuns.ts), so a reload picks up at
 * the next photo not yet answered and a day with all five answered shows its result instead of
 * dealing again. It never touches the free game's best, and the share line is points and a
 * square of colour per photo, so it spoils no place.
 *
 * A kept square's points are only read back within the game's own bounds (the hottest square is
 * always the full `SPOT_MAX`); once a photo's map arrives, the page settles the square against
 * it again with `spotResult`, so a stored day can't claim points its squares didn't earn.
 */

import { formatPoints } from "@/lib/geo";

import { hashSeed, seededShuffle } from "./daily";
import { dailyRunUrl, loadKeptDays, rememberKeptDay } from "./dailyRuns";
import type { GameRecord } from "./deck";
import {
  SPOT_MAX,
  SPOT_PHOTOS,
  playableLooked,
  spotResult,
  spotTotals,
  spotVerdict,
  type SpotResult,
} from "./spotClue";

export const SPOT_DAILY_KEY = "whereabout:spot-the-clue-daily";

/** The most squares a map of where Atlas looked can have: far more than any grid it measures. */
const MAX_CELLS = 32 * 32;

/** One day's game: the photos answered so far, in the order dealt. */
export interface SpotDay {
  results: readonly SpotResult[];
}

/** The day's photos: the same for everyone on `day` with the same playable photos. */
export function dailySpotOrder(ids: readonly string[], day: string): string[] {
  return seededShuffle(ids, hashSeed(`whereabout:spot-the-clue:${day}`)).slice(0, SPOT_PHOTOS);
}

const whole = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

function parseResult(value: unknown): SpotResult | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, cell, points, hottest } = value as Record<string, unknown>;
  if (typeof id !== "string" || id === "") return null;
  if (!whole(cell, MAX_CELLS - 1) || !whole(points, SPOT_MAX)) return null;
  if (typeof hottest !== "boolean") return null;
  // The hottest square is worth the full points by the game's own rule.
  if (hottest && points !== SPOT_MAX) return null;
  return { id, cell, points, hottest };
}

/** A stored day read back only in the shape `rememberSpotDay` writes, else null. */
export function parseSpotDay(value: unknown): SpotDay | null {
  if (typeof value !== "object" || value === null) return null;
  const { results: raw } = value as Record<string, unknown>;
  if (!Array.isArray(raw) || raw.length > SPOT_PHOTOS) return null;
  const results = raw.map(parseResult);
  if (!results.every((r) => r !== null)) return null;
  if (new Set(results.map((r) => r!.id)).size !== results.length) return null;
  return { results: results as SpotResult[] };
}

/** Every day kept in this browser, by day; anything malformed is skipped. */
export function loadSpotDays(): Record<string, SpotDay> {
  return loadKeptDays(SPOT_DAILY_KEY, parseSpotDay);
}

/** The game kept for `day`, or null when it hasn't been started in this browser. */
export function loadSpotDay(day: string): SpotDay | null {
  return loadSpotDays()[day] ?? null;
}

/** Keep `results` as the game for `day`, written in the shape `parseSpotDay` reads. */
export function rememberSpotDay(day: string, results: readonly SpotResult[]): void {
  const entry: SpotDay = {
    results: results.map(({ id, cell, points, hottest }) => ({ id, cell, points, hottest })),
  };
  rememberKeptDay(SPOT_DAILY_KEY, day, entry, parseSpotDay);
}

/** Whether every photo of the day has been answered. */
export function spotDayDone(entry: SpotDay | null): boolean {
  return entry !== null && entry.results.length >= SPOT_PHOTOS;
}

/**
 * Each kept square scored again against its photo's map, once the record has arrived: the points
 * and the hottest come from Atlas's map, never from storage. A photo still loading keeps what was
 * read back.
 */
export function settleSpot(
  results: readonly SpotResult[],
  records: ReadonlyMap<string, GameRecord>,
): SpotResult[] {
  return results.map((r) => {
    const looked = records.get(r.id)?.atlas?.looked;
    return playableLooked(looked) ? spotResult(r.id, looked, r.cell) : r;
  });
}

/** A square's colour in the share, by the answer card's verdict: spot on, warm, cool or cold. */
const SQUARE: Record<string, string> = { "Spot on": "🟩", Warm: "🟨", Cool: "🟧", Cold: "🟥" };

/** One photo in the share, warmest green and coldest red. */
export function spotMark(result: SpotResult): string {
  return SQUARE[spotVerdict(result)] ?? "🟥";
}

/**
 * The share line: the day, the points, how many of Atlas's most telling squares were found, and
 * a square per photo. Points and colours only, so it never names a place or a square's position.
 */
export function spotDailyShare(day: string, results: readonly SpotResult[], href: string): string {
  const { points, hottest } = spotTotals(results);
  return [
    `Whereabout · Spot the clue · ${day}`,
    `🔍 ${formatPoints(points)} of ${formatPoints(results.length * SPOT_MAX)} · Atlas's clue found on ${hottest} of ${results.length}`,
    results.map(spotMark).join(""),
    dailyRunUrl(href),
  ].join("\n");
}
