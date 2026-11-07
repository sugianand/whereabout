/**
 * Today's Close-up: five photos a day, dealt from the UTC date (its own seed, apart from the other
 * daily games'), each with the same four names for everyone, so friends compare the same photos.
 *
 * The day's seed is the game's seed: it deals the photos and, through `nameSeed`, settles each
 * photo's names, as in today's Name the country.
 *
 * A wrong name zooms the photo out, and a wider crop is a clue, so a reload must not take one back:
 * the day keeps the wrong names on the photo in play as well as the photos over, written as each
 * name is tapped, and the game picks up at the very crop it was left on. A day with every photo
 * over shows its result instead of dealing again. Kept per day in this browser
 * (src/lib/game/dailyRuns.ts), apart from the free games' best; the share line is points and
 * tries only, so it spoils no photo.
 *
 * Points are not read back: a photo's come from its wrong names, and Atlas's from where the answer
 * stood in its order, by the game's own rules.
 */

import { CLOSE_PHOTOS, CLOSE_POINTS, closePoints, closeTotals, type CloseResult } from "./closeUp";
import { hashSeed } from "./daily";
import { dailyRunUrl, loadKeptDays, rememberKeptDay } from "./dailyRuns";

export const CLOSE_DAILY_KEY = "whereabout:close-up-daily";

/** The wrong names that end a photo. */
const MAX_WRONG = CLOSE_POINTS.length;
/** The names on a photo. */
const NAMES = 4;

/** One day's game: the photos over, in the order dealt, and the wrong names on the one in play. */
export interface CloseDay {
  results: readonly CloseResult[];
  wrong: readonly string[];
}

/** The day's seed: settles the photos and each one's four names. */
export function dailyCloseSeed(day: string): number {
  return hashSeed(`whereabout:close-up:${day}`);
}

function parseNames(value: unknown, most: number): string[] | null {
  if (!Array.isArray(value) || value.length > most) return null;
  if (!value.every((c) => typeof c === "string" && c !== "")) return null;
  return new Set(value).size === value.length ? (value as string[]) : null;
}

function parseAtlas(value: unknown): CloseResult["atlas"] | undefined {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const { order: rawOrder, rank } = value as Record<string, unknown>;
  const order = parseNames(rawOrder, NAMES);
  if (!order || order.length === 0) return undefined;
  if (rank === null) return { order, rank: null, points: 0 };
  if (typeof rank !== "number" || !Number.isInteger(rank)) return undefined;
  if (rank < 0 || rank >= order.length) return undefined;
  return { order, rank, points: closePoints(rank) };
}

function parseResult(value: unknown): CloseResult | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, wrong: rawWrong, atlas: rawAtlas } = value as Record<string, unknown>;
  const wrong = parseNames(rawWrong, MAX_WRONG);
  const atlas = parseAtlas(rawAtlas);
  if (typeof id !== "string" || id === "" || !wrong || atlas === undefined) return null;
  return { id, wrong, points: closePoints(wrong.length), atlas };
}

/** A stored day read back only in the shape `rememberCloseDay` writes, else null. */
export function parseCloseDay(value: unknown): CloseDay | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.results) || v.results.length > CLOSE_PHOTOS) return null;
  const results = v.results.map(parseResult);
  if (!results.every((r) => r !== null)) return null;
  if (new Set(results.map((r) => r!.id)).size !== results.length) return null;
  // The wrong names in play leave a try, on a photo still to play.
  const wrong = parseNames(v.wrong, MAX_WRONG - 1);
  if (!wrong || (wrong.length > 0 && results.length === CLOSE_PHOTOS)) return null;
  return { results: results as CloseResult[], wrong };
}

/** The game kept for `day`, or null when it hasn't been started in this browser. */
export function loadCloseDay(day: string): CloseDay | null {
  return loadKeptDays(CLOSE_DAILY_KEY, parseCloseDay)[day] ?? null;
}

/** Keep `entry` as the game for `day`. */
export function rememberCloseDay(day: string, entry: CloseDay): void {
  rememberKeptDay(CLOSE_DAILY_KEY, day, entry, parseCloseDay);
}

/** One photo's tries: a red square for each wrong name, then a green one if it was found. */
export function trySquares(result: CloseResult): string {
  const found = result.wrong.length < MAX_WRONG;
  return "🟥".repeat(result.wrong.length) + (found ? "🟩" : "");
}

/**
 * The share line: the day, the points, each photo's tries and Atlas's points on the photos it
 * played. Only points and squares, so it can never name a place or a country.
 */
export function closeDailyShare(day: string, results: readonly CloseResult[], href: string): string {
  const { you, atlas, atlasPlayed } = closeTotals(results);
  const lines = [
    `Whereabout · Close-up · ${day}`,
    `🔍 ${you} of ${results.length * CLOSE_POINTS[0]} points`,
    results.map(trySquares).join(" "),
  ];
  if (atlasPlayed > 0) {
    const of = atlasPlayed === results.length ? "" : ` on ${atlasPlayed} of the photos`;
    lines.push(`Atlas: ${atlas} of ${atlasPlayed * CLOSE_POINTS[0]}${of}`);
  }
  lines.push(dailyRunUrl(href));
  return lines.join("\n");
}
