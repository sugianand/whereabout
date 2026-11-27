/**
 * Hedge your bets: four countries and ten chips for each photo. Spread the chips the way you
 * rate the countries, and score by a proper scoring rule, the quadratic (Brier) score: with
 * `q` your chips as shares of ten and `c` the photo's real country,
 *
 *     points = 500 × (1 + 2·q[c] − Σ q[i]²)
 *
 * which pays 1,000 for every chip on the right country, 0 for every chip on one wrong country,
 * and 625 for an even spread over four, whichever is right. Because the rule is proper, the
 * spread that scores best on average is the one that matches how likely you really think each
 * country is: going all in only pays when you are that sure, which is the thing a model's
 * probabilities are meant to be.
 *
 * The four countries are the photo's own and Atlas's top picks that aren't it, so the choice is
 * always between the places Atlas itself weighed. Atlas bets too, its chips its own belief over
 * the four (renormalised, rounded to whole chips by largest remainder), and is scored by the
 * same rule, so every photo is a side-by-side check of a person's sense of the odds and a
 * model's. Only photos Atlas named countries for are dealt (`hedgeIds`, read at build time in
 * bundled.ts). The rules are a pure reducer, tested without photos; the best game is kept in
 * this browser only, best effort.
 */

import { hashSeed, seededShuffle } from "./daily";
import type { GameRecord } from "./deck";
import type { AtlasGuess } from "./types";

export const HEDGE_PHOTOS = 5;
export const CHIPS = 10;
export const OPTIONS = 4;
/** The most one photo can score: every chip on the right country. */
export const HEDGE_MAX = 1000;
export const BEST_HEDGE_KEY = "whereabout:hedge-best";

/** Atlas's shortlist of countries, in its order, without blanks or repeats. */
function shortlist(atlas: AtlasGuess | null | undefined): string[] {
  const seen = new Set<string>();
  for (const c of atlas?.topCountries ?? []) {
    if (typeof c?.country === "string" && c.country) seen.add(c.country);
  }
  return [...seen];
}

/** The photos Hedge your bets can deal, in catalog order: those Atlas named countries for. */
export function hedgeIds(records: readonly GameRecord[]): string[] {
  return records
    .filter((r) => shortlist(r.atlas).some((c) => c !== r.photo.country))
    .map((r) => r.photo.id);
}

/** A game's photos for `seed`: up to five, shuffled from the ones Atlas named countries for. */
export function dealHedge(ids: readonly string[], seed: number): string[] {
  return seededShuffle(ids, seed).slice(0, HEDGE_PHOTOS);
}

/**
 * The four countries offered for `record` in a game dealt from `seed`: the photo's own and the
 * first three of Atlas's picks that aren't it, in an order shuffled by the seed and the photo,
 * so the right one isn't always first and a game dealt again from its seed offers the same.
 * Fewer than four when Atlas's list is short.
 */
export function hedgeOptions(record: GameRecord, seed: number): string[] {
  const truth = record.photo.country;
  const others = shortlist(record.atlas)
    .filter((c) => c !== truth)
    .slice(0, OPTIONS - 1);
  return seededShuffle([truth, ...others], hashSeed(`${seed >>> 0}:${record.photo.id}`));
}

/**
 * Split `CHIPS` chips in proportion to `weights` by largest remainder: each gets the whole
 * chips its share covers, then the chips left go to the largest remainders, ties to the first.
 * All-zero (or junk) weights split evenly the same way.
 */
export function toChips(weights: readonly number[], chips = CHIPS): number[] {
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  const shares = sum > 0 ? w.map((x) => (x / sum) * chips) : w.map(() => chips / w.length);
  const out = shares.map(Math.floor);
  let left = chips - out.reduce((a, b) => a + b, 0);
  const order = shares
    .map((s, i) => ({ i, r: s - Math.floor(s) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]! += 1;
    left -= 1;
  }
  return out;
}

/**
 * Atlas's chips on `options`: its belief in each (the heatmap's whole distribution where the
 * guess has one, its shortlist's probability otherwise, nothing for a country on neither),
 * renormalised over the four and rounded to whole chips.
 */
export function atlasChips(
  atlas: AtlasGuess | null | undefined,
  options: readonly string[],
): number[] {
  const p = (country: string): number => {
    const b = atlas?.belief?.[country];
    if (typeof b === "number") return b;
    return atlas?.topCountries?.find((c) => c.country === country)?.p ?? 0;
  };
  return toChips(options.map(p));
}

/**
 * The quadratic score of `chips` when option `right` is the photo's country, 0 to `HEDGE_MAX`.
 * Null unless every chip is placed, each a whole number, and `right` is one of the options.
 */
export function hedgeScore(chips: readonly number[], right: number): number | null {
  if (right < 0 || right >= chips.length) return null;
  if (chips.some((c) => !Number.isInteger(c) || c < 0)) return null;
  if (chips.reduce((a, b) => a + b, 0) !== CHIPS) return null;
  const q = chips.map((c) => c / CHIPS);
  const brier = 2 * q[right]! - q.reduce((a, x) => a + x * x, 0);
  return Math.round((HEDGE_MAX / 2) * (1 + brier));
}

/** How one photo came out. */
export interface HedgeResult {
  id: string;
  /** The countries offered, in the order shown. */
  options: string[];
  /** Your chips on each option. */
  chips: number[];
  atlasChips: number[];
  /** The option that was the photo's country. */
  right: number;
  score: number;
  atlasScore: number;
}

/**
 * The result of betting `chips` on `options` for `record`, or null when the bet is incomplete
 * or the options don't hold the photo's country.
 */
export function hedgeResult(
  record: GameRecord,
  options: readonly string[],
  chips: readonly number[],
): HedgeResult | null {
  if (chips.length !== options.length) return null;
  const right = options.indexOf(record.photo.country);
  const score = hedgeScore(chips, right);
  if (score === null) return null;
  const theirs = atlasChips(record.atlas, options);
  return {
    id: record.photo.id,
    options: [...options],
    chips: [...chips],
    atlasChips: theirs,
    right,
    score,
    atlasScore: hedgeScore(theirs, right) ?? 0,
  };
}

/** Add one chip to option `i`, while chips are left; the bet unchanged otherwise. */
export function addChip(chips: readonly number[], i: number): number[] {
  const placed = chips.reduce((a, b) => a + b, 0);
  if (i < 0 || i >= chips.length || placed >= CHIPS) return [...chips];
  return chips.map((c, j) => (j === i ? c + 1 : c));
}

/** Take one chip off option `i`, if it has one. */
export function takeChip(chips: readonly number[], i: number): number[] {
  if (i < 0 || i >= chips.length || chips[i]! <= 0) return [...chips];
  return chips.map((c, j) => (j === i ? c - 1 : c));
}

/** Chips still to place. */
export function chipsLeft(chips: readonly number[]): number {
  return CHIPS - chips.reduce((a, b) => a + b, 0);
}

export type HedgeState =
  | { phase: "idle" }
  | { phase: "betting"; order: readonly string[]; seed: number; results: readonly HedgeResult[] }
  | { phase: "answered"; order: readonly string[]; seed: number; results: readonly HedgeResult[] }
  | { phase: "done"; order: readonly string[]; seed: number; results: readonly HedgeResult[] };

export type HedgeAction =
  | { type: "start"; order: readonly string[]; seed: number; from?: readonly HedgeResult[] }
  | { type: "bet"; result: HedgeResult }
  | { type: "next" };

export const initialHedge: HedgeState = { phase: "idle" };

export function hedgeReducer(state: HedgeState, action: HedgeAction): HedgeState {
  switch (action.type) {
    case "start": {
      // `from` picks a game back up: today's bets kept before a reload.
      const { order, seed } = action;
      const results = action.from ?? [];
      return results.length >= order.length
        ? { phase: "done", order, seed, results }
        : { phase: "betting", order, seed, results };
    }
    case "bet":
      if (state.phase !== "betting" || action.result.id !== state.order[state.results.length]) {
        return state;
      }
      return { ...state, phase: "answered", results: [...state.results, action.result] };
    case "next":
      if (state.phase !== "answered") return state;
      return state.results.length >= state.order.length
        ? { ...state, phase: "done" }
        : { ...state, phase: "betting" };
  }
}

/** A game's points, yours and Atlas's. */
export function hedgeTotals(results: readonly HedgeResult[]): { total: number; atlas: number } {
  return {
    total: results.reduce((a, r) => a + r.score, 0),
    atlas: results.reduce((a, r) => a + r.atlasScore, 0),
  };
}

/** "6 chips", "1 chip". */
export function chipWord(n: number): string {
  return `${n} ${n === 1 ? "chip" : "chips"}`;
}

/** The answer card's line on how the bet scored, yours then Atlas's. */
export function hedgeLine(result: HedgeResult, name: (country: string) => string): string {
  const truth = name(result.options[result.right]!);
  const yours = result.chips[result.right]!;
  const theirs = result.atlasChips[result.right]!;
  return `You had ${chipWord(yours)} on ${truth}, Atlas ${chipWord(theirs)}.`;
}

/** The end screen's line on the two sides' points. */
export function hedgeEndLine(results: readonly HedgeResult[]): string {
  const { total, atlas } = hedgeTotals(results);
  return total > atlas
    ? "You read the odds better than Atlas's own probabilities."
    : total < atlas
      ? "Atlas's probabilities read the odds better this time."
      : "You and Atlas's probabilities read the odds level.";
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The most points in one whole game this browser has kept, 0 when none can be read. */
export function loadBestHedge(): number {
  try {
    const raw = storage()?.getItem(BEST_HEDGE_KEY);
    if (!raw) return 0;
    const value: unknown = JSON.parse(raw);
    return typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= HEDGE_PHOTOS * HEDGE_MAX
      ? value
      : 0;
  } catch {
    return 0;
  }
}

/** Keep `points` if it beats the stored best, and return the best after that. */
export function rememberHedge(points: number): number {
  const best = loadBestHedge();
  if (!Number.isInteger(points) || points <= best || points > HEDGE_PHOTOS * HEDGE_MAX) return best;
  try {
    storage()?.setItem(BEST_HEDGE_KEY, JSON.stringify(points));
  } catch {
    // Private mode or full storage: the game still counts for this visit.
  }
  return points;
}
