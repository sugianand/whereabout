/**
 * Today's Hedge your bets: five photos a day and the same four countries on each, dealt from the
 * UTC date by the seeded shuffle the Daily Five uses (its own seed, apart from the other daily
 * games'), so friends spread their chips over the same choices.
 *
 * The day's seed does both jobs a free game's random seed does: it picks the five photos
 * (`dealHedge`) and shuffles each photo's four countries (`hedgeOptions`), so everyone sees the
 * countries in the same order too.
 *
 * One try a day: the bets are kept after every photo (./dailyRuns.ts), so a reload picks up at
 * the next photo not yet bet on and a day with all five bet shows its result instead of dealing
 * again. It never touches the free game's best, and the share line is points and a square per
 * photo, so it spoils no place and no country.
 *
 * A kept bet is read back only when it agrees with itself (whole chips, ten on each side, and
 * the points the scoring rule gives them); once a photo's record arrives, the page scores the
 * chips again against it with `hedgeResult`, so a stored day can't claim points the bets didn't
 * earn, and Atlas's chips come from its own answer, never from storage.
 */

import { formatPoints } from "@/lib/geo";

import { hashSeed } from "./daily";
import { dailyRunUrl, loadKeptDays, rememberKeptDay } from "./dailyRuns";
import type { GameRecord } from "./deck";
import {
  CHIPS,
  HEDGE_MAX,
  HEDGE_PHOTOS,
  OPTIONS,
  dealHedge,
  hedgeResult,
  hedgeScore,
  hedgeTotals,
  type HedgeResult,
} from "./hedge";

export const HEDGE_DAILY_KEY = "whereabout:hedge-daily";

/** One day's game: the photos bet on so far, in the order dealt. */
export interface HedgeDay {
  results: readonly HedgeResult[];
}

/** The seed of `day`'s game: it deals the photos and orders each photo's four countries. */
export function dailyHedgeSeed(day: string): number {
  return hashSeed(`whereabout:hedge:${day}`);
}

/** The day's photos: the same for everyone on `day` with the same playable photos. */
export function dailyHedgeOrder(ids: readonly string[], day: string): string[] {
  return dealHedge(ids, dailyHedgeSeed(day));
}

/** A bet of whole chips, one per option, that adds up to ten. */
function isBet(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((c) => Number.isInteger(c) && c >= 0) &&
    value.reduce((a: number, b: number) => a + b, 0) === CHIPS
  );
}

function parseResult(value: unknown): HedgeResult | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, options, chips, atlasChips, right, score, atlasScore } = value as Record<
    string,
    unknown
  >;
  if (typeof id !== "string" || id === "") return null;
  if (!Array.isArray(options) || options.length < 2 || options.length > OPTIONS) return null;
  if (!options.every((c) => typeof c === "string" && c !== "")) return null;
  if (new Set(options).size !== options.length) return null;
  if (!isBet(chips, options.length) || !isBet(atlasChips, options.length)) return null;
  if (typeof right !== "number" || !Number.isInteger(right)) return null;
  if (right < 0 || right >= options.length) return null;
  // The points follow from the chips and the right country, by the game's own rule.
  if (score !== hedgeScore(chips, right) || atlasScore !== hedgeScore(atlasChips, right)) {
    return null;
  }
  return {
    id,
    options: [...(options as string[])],
    chips: [...chips],
    atlasChips: [...atlasChips],
    right,
    score: score as number,
    atlasScore: atlasScore as number,
  };
}

/** A stored day read back only in the shape `rememberHedgeDay` writes, else null. */
export function parseHedgeDay(value: unknown): HedgeDay | null {
  if (typeof value !== "object" || value === null) return null;
  const { results: raw } = value as Record<string, unknown>;
  if (!Array.isArray(raw) || raw.length > HEDGE_PHOTOS) return null;
  const results = raw.map(parseResult);
  if (!results.every((r) => r !== null)) return null;
  if (new Set(results.map((r) => r!.id)).size !== results.length) return null;
  return { results: results as HedgeResult[] };
}

/** Every day kept in this browser, by day; anything malformed is skipped. */
export function loadHedgeDays(): Record<string, HedgeDay> {
  return loadKeptDays(HEDGE_DAILY_KEY, parseHedgeDay);
}

/** The game kept for `day`, or null when it hasn't been started in this browser. */
export function loadHedgeDay(day: string): HedgeDay | null {
  return loadHedgeDays()[day] ?? null;
}

/** Keep `results` as the game for `day`, written in the shape `parseHedgeDay` reads. */
export function rememberHedgeDay(day: string, results: readonly HedgeResult[]): void {
  const entry: HedgeDay = {
    results: results.map(({ id, options, chips, atlasChips, right, score, atlasScore }) => ({
      id,
      options: [...options],
      chips: [...chips],
      atlasChips: [...atlasChips],
      right,
      score,
      atlasScore,
    })),
  };
  rememberKeptDay(HEDGE_DAILY_KEY, day, entry, parseHedgeDay);
}

/** Whether every photo of the day has been bet on. */
export function hedgeDayDone(entry: HedgeDay | null): boolean {
  return entry !== null && entry.results.length >= HEDGE_PHOTOS;
}

/**
 * Each kept bet scored again on its photo's record, once it has arrived: which country was right,
 * both sides' points and Atlas's chips come from the catalog and Atlas's answer, never from
 * storage. Only the countries shown and the player's chips are kept from what was read back. A
 * photo still loading keeps all of it; a kept bet whose countries don't hold the photo's own
 * can't have been dealt, so it scores nothing.
 */
export function settleHedge(
  results: readonly HedgeResult[],
  records: ReadonlyMap<string, GameRecord>,
): HedgeResult[] {
  return results.map((r) => {
    const record = records.get(r.id);
    if (!record) return r;
    return (
      hedgeResult(record, r.options, r.chips) ?? {
        ...r,
        score: 0,
        atlasScore: 0,
      }
    );
  });
}

/** One photo in the share, by the chips on the right country: 🟩 7 to 10, 🟨 4 to 6, 🟧 1 to 3, 🟥 none. */
export function hedgeMark(result: HedgeResult): string {
  const on = result.chips[result.right] ?? 0;
  return on >= 7 ? "🟩" : on >= 4 ? "🟨" : on >= 1 ? "🟧" : "🟥";
}

/**
 * The share line: the day, your points beside Atlas's probabilities' and a square per photo.
 * Points and colours only, so it never names a place, a country or how the chips were spread.
 */
export function hedgeDailyShare(
  day: string,
  results: readonly HedgeResult[],
  href: string,
): string {
  const { total, atlas } = hedgeTotals(results);
  return [
    `Whereabout · Hedge your bets · ${day}`,
    `🎲 ${formatPoints(total)} of ${formatPoints(results.length * HEDGE_MAX)} · Atlas's probabilities ${formatPoints(atlas)}`,
    results.map(hedgeMark).join(""),
    dailyRunUrl(href),
  ].join("\n");
}
