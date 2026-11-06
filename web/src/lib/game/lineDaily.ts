/**
 * Today's Line them up: five rows a day, dealt from the UTC date (its own seed, apart from the
 * other daily games') by the free game's own deal, so friends sort the same photos.
 *
 * A game here is its rows, so the day keeps every locked row and is written after each one: a
 * reload picks up at the next row with the score so far, and a day with every row locked shows
 * its result instead of dealing again. A row not yet locked is not kept: nothing about it has
 * been revealed, so starting it over gives nothing away. Kept per day in this browser
 * (src/lib/game/dailyRuns.ts), apart from the free games' best; the share line is squares and
 * counts only, so it spoils no photo.
 *
 * Reading a row back checks it holds the same four photos throughout, and its points come from
 * the places marked right, so a stored count is never trusted.
 */

import { hashSeed, mulberry32 } from "./daily";
import { dailyRunUrl, loadKeptDays, rememberKeptDay } from "./dailyRuns";
import { ROW, ROWS, atlasLinePoints, dealRows, linePoints, type RowResult } from "./lineUp";
import type { Regions } from "./regions";

export const LINE_DAILY_KEY = "whereabout:line-up-daily";

/** One day's game: the rows locked so far, in the order they were dealt. */
export interface LineDay {
  results: readonly RowResult[];
}

/** The day's rows: the same for everyone on `day` with the same deck. */
export function dailyLineRows(regions: Regions, day: string): string[][] {
  return dealRows(regions, mulberry32(hashSeed(`whereabout:line-up:${day}`)));
}

function parseIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length !== ROW) return null;
  if (!value.every((id) => typeof id === "string" && id !== "")) return null;
  return new Set(value).size === ROW ? (value as string[]) : null;
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  [...a].sort().join() === [...b].sort().join();

function parseAtlas(value: unknown, order: readonly string[]): RowResult["atlas"] | undefined {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const { order: raw, points } = value as Record<string, unknown>;
  const atlasOrder = parseIds(raw);
  if (!atlasOrder || !sameIds(atlasOrder, order)) return undefined;
  if (typeof points !== "number" || !Number.isInteger(points)) return undefined;
  return points >= 0 && points <= ROW ? { order: atlasOrder, points } : undefined;
}

function parseRow(value: unknown): RowResult | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const order = parseIds(v.order);
  const east = parseIds(v.east);
  if (!order || !east || !sameIds(order, east)) return null;
  const { right } = v;
  if (!Array.isArray(right) || right.length !== ROW) return null;
  if (!right.every((r) => typeof r === "boolean")) return null;
  const atlas = parseAtlas(v.atlas, order);
  if (atlas === undefined) return null;
  return { order, east, right, points: right.filter(Boolean).length, atlas };
}

/** A stored day read back only in the shape `rememberLineDay` writes, else null. */
export function parseLineDay(value: unknown): LineDay | null {
  if (typeof value !== "object" || value === null) return null;
  const { results } = value as Record<string, unknown>;
  if (!Array.isArray(results) || results.length > ROWS) return null;
  const parsed = results.map(parseRow);
  return parsed.every((r) => r !== null) ? { results: parsed as RowResult[] } : null;
}

/** The game kept for `day`, or null when it hasn't been started in this browser. */
export function loadLineDay(day: string): LineDay | null {
  return loadKeptDays(LINE_DAILY_KEY, parseLineDay)[day] ?? null;
}

/** Keep `entry` as the game for `day`. */
export function rememberLineDay(day: string, entry: LineDay): void {
  rememberKeptDay(LINE_DAILY_KEY, day, entry, parseLineDay);
}

/** One row's places, west to east: green for a photo in place, red for one that wasn't. */
export function rowSquares(row: RowResult): string {
  return row.right.map((r) => (r ? "🟩" : "🟥")).join("");
}

/**
 * The share line: the day, the total, each row's places and Atlas's total on the same rows. Only
 * counts and squares, so it can never name a place or a photo.
 */
export function lineDailyShare(day: string, results: readonly RowResult[], href: string): string {
  const atlas = atlasLinePoints(results);
  const lines = [
    `Whereabout · Line them up · ${day}`,
    `↔️ ${linePoints(results)} of ${results.length * ROW} in place`,
    ...results.map(rowSquares),
  ];
  if (atlas.rows > 0) lines.push(`Atlas: ${atlas.points} of ${atlas.rows * ROW}`);
  lines.push(dailyRunUrl(href));
  return lines.join("\n");
}
