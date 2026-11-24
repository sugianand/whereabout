/**
 * Today's Trust Atlas?: ten photos a day, dealt from the UTC date by the seeded shuffle the Daily
 * Five uses (its own seed, apart from the other daily games'), so friends call Atlas's answers on
 * the same photos.
 *
 * One try a day: the calls are kept after every photo (./dailyRuns.ts), so a reload picks up at
 * the next photo not yet called and a day with all ten called shows its result instead of dealing
 * again. It never touches the free game's best, and the share line is counts and a square per
 * call, so it spoils no place and no country.
 *
 * A kept result is read back only when it agrees with itself (the call and whether it was right
 * follow from whether Atlas was right); once a photo's record arrives, the page settles the call
 * against it again with `trustResult`, so a stored day can't claim calls the photos didn't earn.
 */

import { hashSeed, seededShuffle } from "./daily";
import { dailyRunUrl, loadKeptDays, rememberKeptDay } from "./dailyRuns";
import type { GameRecord } from "./deck";
import {
  TRUST_PHOTOS,
  rightCall,
  trustResult,
  trustTotals,
  type TrustCall,
  type TrustResult,
} from "./trustAtlas";

export const TRUST_DAILY_KEY = "whereabout:trust-atlas-daily";

/** One day's game: the photos called so far, in the order dealt. */
export interface TrustDay {
  results: readonly TrustResult[];
}

/** The day's photos: the same for everyone on `day` with the same playable photos. */
export function dailyTrustOrder(ids: readonly string[], day: string): string[] {
  return seededShuffle(ids, hashSeed(`whereabout:trust-atlas:${day}`)).slice(0, TRUST_PHOTOS);
}

const isCall = (v: unknown): v is TrustCall => v === "trust" || v === "doubt";

function parseResult(value: unknown): TrustResult | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, call, atlasRight, correct, atlasCall, atlasCorrect } = value as Record<
    string,
    unknown
  >;
  if (typeof id !== "string" || id === "") return null;
  if (!isCall(call) || !isCall(atlasCall)) return null;
  if (typeof atlasRight !== "boolean" || typeof correct !== "boolean") return null;
  if (typeof atlasCorrect !== "boolean") return null;
  // Whether each call was right follows from whether Atlas was, by the game's own rule.
  const right = rightCall(atlasRight);
  if (correct !== (call === right) || atlasCorrect !== (atlasCall === right)) return null;
  return { id, call, atlasRight, correct, atlasCall, atlasCorrect };
}

/** A stored day read back only in the shape `rememberTrustDay` writes, else null. */
export function parseTrustDay(value: unknown): TrustDay | null {
  if (typeof value !== "object" || value === null) return null;
  const { results: raw } = value as Record<string, unknown>;
  if (!Array.isArray(raw) || raw.length > TRUST_PHOTOS) return null;
  const results = raw.map(parseResult);
  if (!results.every((r) => r !== null)) return null;
  if (new Set(results.map((r) => r!.id)).size !== results.length) return null;
  return { results: results as TrustResult[] };
}

/** Every day kept in this browser, by day; anything malformed is skipped. */
export function loadTrustDays(): Record<string, TrustDay> {
  return loadKeptDays(TRUST_DAILY_KEY, parseTrustDay);
}

/** The game kept for `day`, or null when it hasn't been started in this browser. */
export function loadTrustDay(day: string): TrustDay | null {
  return loadTrustDays()[day] ?? null;
}

/** Keep `results` as the game for `day`, written in the shape `parseTrustDay` reads. */
export function rememberTrustDay(day: string, results: readonly TrustResult[]): void {
  const entry: TrustDay = {
    results: results.map(({ id, call, atlasRight, correct, atlasCall, atlasCorrect }) => ({
      id,
      call,
      atlasRight,
      correct,
      atlasCall,
      atlasCorrect,
    })),
  };
  rememberKeptDay(TRUST_DAILY_KEY, day, entry, parseTrustDay);
}

/** Whether every photo of the day has been called. */
export function trustDayDone(entry: TrustDay | null): boolean {
  return entry !== null && entry.results.length >= TRUST_PHOTOS;
}

/**
 * Each kept call judged again on its photo's record, once it has arrived: whether Atlas was right
 * and its own call come from the catalog and Atlas's answer, never from storage. Only the player's
 * call is kept from what was read back; a photo still loading keeps all of it.
 */
export function settleTrust(
  results: readonly TrustResult[],
  records: ReadonlyMap<string, GameRecord>,
): TrustResult[] {
  return results.map((r) => {
    const record = records.get(r.id);
    return (record && trustResult(record, r.call)) ?? r;
  });
}

/** One call in the share: green for called right, red for missed. */
export function trustMark(result: TrustResult): string {
  return result.correct ? "🟩" : "🟥";
}

/**
 * The share line: the day, the calls you got right beside Atlas's own, and a square per call.
 * Counts and colours only, so it never names a place, a country or which way you called.
 */
export function trustDailyShare(
  day: string,
  results: readonly TrustResult[],
  href: string,
): string {
  const { correct, atlasCorrect } = trustTotals(results);
  const n = results.length;
  return [
    `Whereabout · Trust Atlas? · ${day}`,
    `🤔 ${correct} of ${n} called right · Atlas's own sureness ${atlasCorrect} of ${n}`,
    results.map(trustMark).join(""),
    dailyRunUrl(href),
  ].join("\n");
}
