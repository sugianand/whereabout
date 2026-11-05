/**
 * Today's Hot and cold: five photos a day, dealt from the UTC date by the seeded shuffle the Daily
 * Five uses (its own seed, apart from the other daily games'), so friends compare the same photos.
 *
 * A clue is worth having, so a reload must not take a miss back: the day keeps the pins on the
 * photo in play as well as the photos finished, written after every pin, and a game picks up at
 * the very pin it was left on. A day with every photo over shows its result instead of dealing
 * again. Kept per day in this browser (src/lib/game/dailyRuns.ts), apart from the free games'
 * best; the share line is points and pin counts only, so it spoils no photo.
 *
 * Scores are not read back: a photo's are rebuilt from its pins by the game's own rules.
 */

import { formatPoints } from "@/lib/geo";

import { hashSeed, seededShuffle } from "./daily";
import { dailyRunUrl, loadKeptDays, rememberKeptDay } from "./dailyRuns";
import {
  HOT_PHOTOS,
  MAX_PINS,
  PHOTO_POINTS,
  atlasTotal,
  hotAtlas,
  hotRound,
  hotTotal,
  type HotAtlas,
  type HotPin,
  type HotRound,
} from "./hotCold";

export const HOT_DAILY_KEY = "whereabout:hot-cold-daily";

/** One day's game: the photos over, in the order dealt, and the pins on the one in play. */
export interface HotDay {
  results: readonly HotRound[];
  pins: readonly HotPin[];
}

/** The day's photos: the same for everyone on `day` with the same deck. */
export function dailyHotOrder(ids: readonly string[], day: string): string[] {
  return seededShuffle(ids, hashSeed(`whereabout:hot-cold:${day}`)).slice(0, HOT_PHOTOS);
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const distance = (v: unknown): v is number => finite(v) && v >= 0;

function parsePin(value: unknown): HotPin | null {
  if (typeof value !== "object" || value === null) return null;
  const { at, km, bearing, found } = value as Record<string, unknown>;
  if (typeof at !== "object" || at === null) return null;
  const { lng, lat } = at as Record<string, unknown>;
  if (!finite(lng) || !finite(lat) || !distance(km) || !finite(bearing)) return null;
  if (typeof found !== "boolean") return null;
  return { at: { lng, lat }, km, bearing, found };
}

function parsePins(value: unknown): HotPin[] | null {
  if (!Array.isArray(value) || value.length > MAX_PINS) return null;
  const pins = value.map(parsePin);
  return pins.every((p) => p !== null) ? pins : null;
}

function parseAtlas(value: unknown): HotAtlas | null {
  if (typeof value !== "object" || value === null) return null;
  const { km, found } = value as Record<string, unknown>;
  return distance(km) && typeof found === "boolean" ? hotAtlas(km, found) : null;
}

function parseRound(value: unknown): HotRound | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, pins: rawPins, atlas: rawAtlas } = value as Record<string, unknown>;
  const pins = parsePins(rawPins);
  const atlas = rawAtlas === null ? null : parseAtlas(rawAtlas);
  if (typeof id !== "string" || id === "" || !pins || (rawAtlas !== null && !atlas)) return null;
  // A photo ends on the pin that finds it, or on the last.
  const end = pins.findIndex((p) => p.found);
  if (end >= 0 ? end !== pins.length - 1 : pins.length !== MAX_PINS) return null;
  return hotRound(id, pins, atlas);
}

/** A stored day read back only in the shape `rememberHotDay` writes, else null. */
export function parseHotDay(value: unknown): HotDay | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.results) || v.results.length > HOT_PHOTOS) return null;
  const results = v.results.map(parseRound);
  const pins = parsePins(v.pins);
  if (!pins || !results.every((r) => r !== null)) return null;
  // The pins in play are misses with one left to drop, on a photo still to play.
  if (pins.length === MAX_PINS || pins.some((p) => p.found)) return null;
  if (pins.length > 0 && results.length === HOT_PHOTOS) return null;
  return { results: results as HotRound[], pins };
}

/** The game kept for `day`, or null when it hasn't been started in this browser. */
export function loadHotDay(day: string): HotDay | null {
  return loadKeptDays(HOT_DAILY_KEY, parseHotDay)[day] ?? null;
}

/** Keep `entry` as the game for `day`. */
export function rememberHotDay(day: string, entry: HotDay): void {
  rememberKeptDay(HOT_DAILY_KEY, day, entry, parseHotDay);
}

/** One photo's pins: a red square for each miss and a green one for the find. */
export function pinSquares(round: HotRound): string {
  return round.pins.map((p) => (p.found ? "🟩" : "🟥")).join("");
}

/**
 * The share line: the day, the total, each photo's pins and Atlas's total on the same photos.
 * Only points and pin counts, so it can never name a place or a distance.
 */
export function hotDailyShare(day: string, results: readonly HotRound[], href: string): string {
  const atlas = atlasTotal(results);
  const lines = [
    `Whereabout · Hot and cold · ${day}`,
    `🔥 ${formatPoints(hotTotal(results))} of ${formatPoints(results.length * PHOTO_POINTS)}`,
    results.map(pinSquares).join(" "),
  ];
  if (atlas.played > 0) {
    const of = atlas.played === results.length ? "" : ` on ${atlas.played} of the photos`;
    lines.push(`Atlas: ${formatPoints(atlas.total)}${of}`);
  }
  lines.push(dailyRunUrl(href));
  return lines.join("\n");
}
