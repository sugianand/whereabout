/**
 * Today's Bullseye: five photos a day, dealt from the UTC date by the seeded shuffle the Daily
 * Five uses (its own seed, apart from the other daily games'), so friends bet on the same photos.
 *
 * One try a day: the bets are kept after every photo (./dailyRuns.ts), so a reload picks up at the
 * next photo not bet on and a day with all five bet shows its result instead of dealing again. It
 * never touches the free games' best, and the share line is points, ring sizes and whether each
 * held, so it spoils no place.
 *
 * Scores are not read back: a bet's is rebuilt from its distance and ring by the game's own rules
 * (`settleBet`), so a stored day can't claim points its rings didn't hold.
 */

import { formatDistance, formatPoints } from "@/lib/geo";
import type { Units } from "@/lib/units";

import {
  BULLSEYE_PHOTOS,
  PHOTO_POINTS,
  RINGS,
  atlasBullseyeTotal,
  bullseyeTotal,
  ringsHeld,
  settleBet,
  type Bet,
  type BullseyeRound,
} from "./bullseye";
import { hashSeed, seededShuffle } from "./daily";
import { dailyRunUrl, loadKeptDays, rememberKeptDay } from "./dailyRuns";

export const BULLSEYE_DAILY_KEY = "whereabout:bullseye-daily";

/** One day's game: the photos bet on so far, in the order dealt. */
export interface BullseyeDay {
  results: readonly BullseyeRound[];
}

/** The day's photos: the same for everyone on `day` with the same deck. */
export function dailyBullseyeOrder(ids: readonly string[], day: string): string[] {
  return seededShuffle(ids, hashSeed(`whereabout:bullseye:${day}`)).slice(0, BULLSEYE_PHOTOS);
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseBet(value: unknown): Bet | null {
  if (typeof value !== "object" || value === null) return null;
  const { at, ring, km } = value as Record<string, unknown>;
  if (typeof at !== "object" || at === null) return null;
  const { lng, lat } = at as Record<string, unknown>;
  if (!finite(lng) || !finite(lat) || Math.abs(lat) > 90 || Math.abs(lng) > 540) return null;
  if (typeof ring !== "number" || !Number.isInteger(ring) || !RINGS[ring]) return null;
  // No two places on Earth are more than half its circumference apart.
  if (!finite(km) || km < 0 || km > 20_050) return null;
  return settleBet({ lng, lat }, ring, km);
}

function parseRound(value: unknown): BullseyeRound | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, you: rawYou, atlas: rawAtlas } = value as Record<string, unknown>;
  if (typeof id !== "string" || id === "") return null;
  const you = parseBet(rawYou);
  const atlas = rawAtlas === null ? null : parseBet(rawAtlas);
  if (!you || (rawAtlas !== null && !atlas)) return null;
  return { id, you, atlas };
}

/** A stored day read back only in the shape `rememberBullseyeDay` writes, else null. */
export function parseBullseyeDay(value: unknown): BullseyeDay | null {
  if (typeof value !== "object" || value === null) return null;
  const { results: raw } = value as Record<string, unknown>;
  if (!Array.isArray(raw) || raw.length > BULLSEYE_PHOTOS) return null;
  const results = raw.map(parseRound);
  if (!results.every((r) => r !== null)) return null;
  if (new Set(results.map((r) => r!.id)).size !== results.length) return null;
  return { results: results as BullseyeRound[] };
}

/** Every day kept in this browser, by day; anything malformed is skipped. */
export function loadBullseyeDays(): Record<string, BullseyeDay> {
  return loadKeptDays(BULLSEYE_DAILY_KEY, parseBullseyeDay);
}

/** The game kept for `day`, or null when it hasn't been started in this browser. */
export function loadBullseyeDay(day: string): BullseyeDay | null {
  return loadBullseyeDays()[day] ?? null;
}

/** Keep `results` as the game for `day`, written in the shape `parseBullseyeDay` reads. */
export function rememberBullseyeDay(day: string, results: readonly BullseyeRound[]): void {
  const entry: BullseyeDay = { results: results.map(({ id, you, atlas }) => ({ id, you, atlas })) };
  rememberKeptDay(BULLSEYE_DAILY_KEY, day, entry, parseBullseyeDay);
}

/** Whether every photo of the day has been bet on. */
export function bullseyeDayDone(entry: BullseyeDay | null): boolean {
  return entry !== null && entry.results.length >= BULLSEYE_PHOTOS;
}

/** One photo in the share: a green square for a ring that held, red for one that didn't. */
export function ringMark(b: Bet, units: Units): string {
  return `${b.inside ? "🟩" : "🟥"} ${formatDistance(RINGS[b.ring]!.km, units)}`;
}

const held = (n: number, of: number) => `${n} of ${of} ring${of === 1 ? "" : "s"} held`;

/**
 * The share line: the day, the points, each photo's ring and whether it held, and Atlas's points
 * and rings on the photos it played. Ring sizes and squares only, so it never names a place or
 * says how far off a pin landed.
 */
export function bullseyeDailyShare(
  day: string,
  results: readonly BullseyeRound[],
  href: string,
  units: Units = "km",
): string {
  const lines = [
    `Whereabout · Bullseye · ${day}`,
    `🎯 ${formatPoints(bullseyeTotal(results))} of ${formatPoints(results.length * PHOTO_POINTS)} · ${held(ringsHeld(results), results.length)}`,
    results.map((r) => ringMark(r.you, units)).join("  "),
  ];
  const atlas = atlasBullseyeTotal(results);
  if (atlas.played > 0) {
    const on = atlas.played === results.length ? "" : ` on ${atlas.played} of the photos`;
    lines.push(`Atlas: ${formatPoints(atlas.total)}${on} · ${held(atlas.held, atlas.played)}`);
  }
  lines.push(dailyRunUrl(href));
  return lines.join("\n");
}
