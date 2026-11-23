/**
 * Trust Atlas?: Atlas names the country it thinks a photo was taken in and says how sure it is;
 * the player calls whether it got it right. The game is about the number Atlas puts on its own
 * answer: on the photos the game ships, Atlas names the right country a little under half the
 * time, so neither "always trust" nor "always doubt" wins, and reading how sure it is (and the
 * photo) is the skill.
 *
 * Atlas makes the same call about itself by a fixed rule: it trusts any answer it gave at least
 * `ATLAS_TRUSTS_FROM` of its probability, so every game is also a check of its own confidence,
 * photo by photo, beside the player's. Both sides are judged on the photo's true country from
 * the catalog. Only photos Atlas named a country for are dealt (`trustIds`, read at build time in
 * bundled.ts). The rules are a pure reducer, tested without photos; the best game is kept in this
 * browser only, best effort.
 */

import { seededShuffle } from "./daily";
import type { GameRecord } from "./deck";
import type { AtlasGuess } from "./types";

export const TRUST_PHOTOS = 10;
/** Atlas trusts its own answer when it gave that country at least this probability. */
export const ATLAS_TRUSTS_FROM = 0.5;
export const BEST_TRUST_KEY = "whereabout:trust-atlas-best";

/** A call on Atlas's answer: it is right (trust) or it is wrong (doubt). */
export type TrustCall = "trust" | "doubt";

/** Atlas's top country and how sure it was, or null when it named none. */
export function atlasPick(
  atlas: AtlasGuess | null | undefined,
): { country: string; p: number } | null {
  const top = atlas?.topCountries?.[0];
  if (!top || typeof top.country !== "string" || !top.country) return null;
  const p = Number.isFinite(atlas!.confidence) ? atlas!.confidence : top.p;
  return Number.isFinite(p) && p >= 0 && p <= 1 ? { country: top.country, p } : null;
}

/** The photos Trust Atlas? can deal, in catalog order: those Atlas named a country for. */
export function trustIds(records: readonly GameRecord[]): string[] {
  return records.filter((r) => atlasPick(r.atlas) !== null).map((r) => r.photo.id);
}

/** A game's photos for `seed`: up to ten, shuffled from the ones Atlas named a country for. */
export function dealTrust(ids: readonly string[], seed: number): string[] {
  return seededShuffle(ids, seed).slice(0, TRUST_PHOTOS);
}

/** Atlas's own call on an answer it gave probability `p`. */
export function atlasCall(p: number): TrustCall {
  return p >= ATLAS_TRUSTS_FROM ? "trust" : "doubt";
}

/** The call that was correct: trust when Atlas's country is the photo's, doubt otherwise. */
export function rightCall(atlasRight: boolean): TrustCall {
  return atlasRight ? "trust" : "doubt";
}

/** How one photo came out. */
export interface TrustResult {
  id: string;
  call: TrustCall;
  /** True when Atlas named the photo's real country. */
  atlasRight: boolean;
  /** True when the player's call was correct. */
  correct: boolean;
  /** Atlas's own call on its answer, by `ATLAS_TRUSTS_FROM`. */
  atlasCall: TrustCall;
  atlasCorrect: boolean;
}

/** The result of calling `call` on `record`, or null when Atlas named no country for it. */
export function trustResult(record: GameRecord, call: TrustCall): TrustResult | null {
  const pick = atlasPick(record.atlas);
  if (!pick) return null;
  const atlasRight = pick.country === record.photo.country;
  const own = atlasCall(pick.p);
  return {
    id: record.photo.id,
    call,
    atlasRight,
    correct: call === rightCall(atlasRight),
    atlasCall: own,
    atlasCorrect: own === rightCall(atlasRight),
  };
}

/**
 * Where the photo's real country sat on Atlas's shortlist: 1 for its pick, 2 for its runner-up,
 * and so on, with the probability it gave; null when the country isn't on the list at all.
 */
export function truthRank(
  atlas: AtlasGuess | null | undefined,
  country: string,
): { rank: number; p: number } | null {
  const list = atlas?.topCountries ?? [];
  const i = list.findIndex((c) => c.country === country);
  return i < 0 ? null : { rank: i + 1, p: list[i]!.p };
}

export type TrustState =
  | { phase: "idle" }
  | { phase: "calling"; order: readonly string[]; results: readonly TrustResult[] }
  | { phase: "answered"; order: readonly string[]; results: readonly TrustResult[] }
  | { phase: "done"; order: readonly string[]; results: readonly TrustResult[] };

export type TrustAction =
  | { type: "start"; order: readonly string[] }
  | { type: "called"; result: TrustResult }
  | { type: "next" };

export const initialTrust: TrustState = { phase: "idle" };

export function trustReducer(state: TrustState, action: TrustAction): TrustState {
  switch (action.type) {
    case "start":
      return action.order.length === 0
        ? { phase: "done", order: action.order, results: [] }
        : { phase: "calling", order: action.order, results: [] };
    case "called":
      if (state.phase !== "calling" || action.result.id !== state.order[state.results.length]) {
        return state;
      }
      return { ...state, phase: "answered", results: [...state.results, action.result] };
    case "next":
      if (state.phase !== "answered") return state;
      return state.results.length >= state.order.length
        ? { ...state, phase: "done" }
        : { ...state, phase: "calling" };
  }
}

/** A game's tallies: the player's correct calls, Atlas's own, and how often Atlas was right. */
export function trustTotals(results: readonly TrustResult[]): {
  correct: number;
  atlasCorrect: number;
  atlasRight: number;
} {
  return {
    correct: results.filter((r) => r.correct).length,
    atlasCorrect: results.filter((r) => r.atlasCorrect).length,
    atlasRight: results.filter((r) => r.atlasRight).length,
  };
}

/** "Under 1%", "85%": a probability as the game shows it. */
export function percent(p: number): string {
  const n = Math.round(p * 100);
  return n < 1 && p > 0 ? "under 1%" : `${n}%`;
}

/** The answer card's line on Atlas's own call: "Atlas, 85% sure, trusted itself: right." */
export function atlasCallLine(result: TrustResult, p: number): string {
  const own =
    result.atlasCall === "trust"
      ? `At ${percent(p)} sure, Atlas trusted its answer`
      : `At only ${percent(p)} sure, Atlas doubted its answer`;
  return `${own}, and ${result.atlasCorrect ? "that call was right" : "that call was wrong"}.`;
}

/** The end screen's line on the two sides' calls. */
export function trustEndLine(results: readonly TrustResult[]): string {
  const { correct, atlasCorrect } = trustTotals(results);
  const n = results.length;
  const lead =
    correct > atlasCorrect
      ? "You read Atlas better than it reads itself."
      : correct < atlasCorrect
        ? "Atlas's own sureness called it better this time."
        : "You and Atlas's own sureness called it level.";
  return `${lead} Atlas trusts itself at ${percent(ATLAS_TRUSTS_FROM)} sure or more: that called ${atlasCorrect} of ${n}.`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The most correct calls in one whole game this browser has kept, 0 when none can be read. */
export function loadBestTrust(): number {
  try {
    const raw = storage()?.getItem(BEST_TRUST_KEY);
    if (!raw) return 0;
    const value: unknown = JSON.parse(raw);
    return typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= TRUST_PHOTOS
      ? value
      : 0;
  } catch {
    return 0;
  }
}

/** Keep `correct` if it beats the stored best, and return the best after that. */
export function rememberTrust(correct: number): number {
  const best = loadBestTrust();
  if (!Number.isInteger(correct) || correct <= best || correct > TRUST_PHOTOS) return best;
  try {
    storage()?.setItem(BEST_TRUST_KEY, JSON.stringify(correct));
  } catch {
    // Private mode or full storage: the game still counts for this visit.
  }
  return correct;
}
