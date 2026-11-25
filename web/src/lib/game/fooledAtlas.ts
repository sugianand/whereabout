/**
 * Which fooled Atlas?: two photos side by side, and the player picks the one Atlas placed further
 * from where it was really taken.
 *
 * Higher-or-lower style, like Further North: after a right pick the second photo stays and a new
 * one is dealt beside it, and the run ends on the first wrong pick or when every photo has been
 * played. Only photos Atlas pinned are dealt (`fooledIds`, read at build time in bundled.ts, ids
 * only, so how far off Atlas was never reaches the page before the answer).
 *
 * Two misses within `TIE_RATIO` of each other, or both under `NEAR_KM`, are too close to call, so
 * either pick counts as right. Atlas plays along by its own sureness: it picks the photo it gave
 * the lower probability as the one that fooled it, judged by the same rule, so every pair is also
 * a check of whether Atlas knows when it is lost.
 *
 * The rules live here as a pure reducer so they can be tested without photos. The best streak is
 * kept in this browser only, best effort.
 */

import { haversineKm } from "@/lib/geo";

import type { GameRecord } from "./deck";
import type { Side } from "./furtherNorth";

export type { Side } from "./furtherNorth";

/** Two misses where the larger is at most this many times the smaller are a dead heat. */
export const TIE_RATIO = 1.5;
/** Two misses both under this many kilometres are both bullseyes: a dead heat. */
export const NEAR_KM = 25;
export const BEST_FOOLED_KEY = "whereabout:fooled-atlas-best";

/** How far Atlas's pin landed from the photo, in kilometres, or null when it has no pin. */
export function atlasMissKm(record: GameRecord): number | null {
  const atlas = record.atlas;
  if (!atlas || !Number.isFinite(atlas.lat) || !Number.isFinite(atlas.lng)) return null;
  return haversineKm(record.photo, atlas);
}

/** How sure Atlas was of its answer for a photo, or null when it didn't say. */
export function atlasSureness(record: GameRecord): number | null {
  const p = record.atlas?.confidence;
  return typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1 ? p : null;
}

/** The photos Which fooled Atlas? can deal, in catalog order: those Atlas pinned. */
export function fooledIds(records: readonly GameRecord[]): string[] {
  return records.filter((r) => atlasMissKm(r) !== null).map((r) => r.photo.id);
}

/** How one pair came out. */
export interface FooledVerdict {
  /** The side picked. */
  picked: Side;
  /** The side Atlas really missed by more (by a hair, when `tie`). */
  fooled: Side;
  /** True when the misses are too close to call, so either pick counts. */
  tie: boolean;
  correct: boolean;
}

/** True when misses of `a` and `b` km are too close to call. */
export function tooClose(a: number, b: number): boolean {
  const [low, high] = a <= b ? [a, b] : [b, a];
  return high < NEAR_KM || high <= low * TIE_RATIO;
}

/** Judges a pick of `picked` between photos Atlas missed by `missA` and `missB` km. */
export function judgeFooled(picked: Side, missA: number, missB: number): FooledVerdict {
  const fooled: Side = missA >= missB ? "a" : "b";
  const tie = tooClose(missA, missB);
  return { picked, fooled, tie, correct: tie || picked === fooled };
}

/**
 * Atlas's own pick: the photo it was less sure of, or null when it didn't say how sure it was
 * of both. Even sureness picks the first photo.
 */
export function atlasFooledPick(sureA: number | null, sureB: number | null): Side | null {
  if (sureA === null || sureB === null) return null;
  return sureB < sureA ? "b" : "a";
}

interface Run {
  order: readonly string[];
  /** The pair on screen is `order[index]` and `order[index + 1]`. */
  index: number;
  /** Right picks in a row this run. */
  streak: number;
  /** Pairs Atlas's own pick got right, and pairs it played (sure of both photos). */
  atlasRight: number;
  atlasPlayed: number;
}

export type FooledState =
  | { phase: "idle" }
  | (Run & { phase: "picking" })
  | (Run & {
      /** The pair's misses are shown. A wrong pick ends the run; a right one plays on. */
      phase: "answered";
      verdict: FooledVerdict;
      /** Atlas's own pick on the same pair, judged the same way, or null when it sat it out. */
      atlas: FooledVerdict | null;
    })
  | (Run & {
      /** Every photo played without a wrong pick. */
      phase: "cleared";
    });

export type FooledAction =
  | {
      type: "start";
      order: readonly string[];
      /** A run picked back up where it was left (today's run): the pair after `streak` right. */
      from?: { streak: number; atlasRight: number; atlasPlayed: number };
    }
  | {
      type: "picked";
      side: Side;
      /** How far Atlas's pin landed from each photo, in kilometres. */
      missA: number;
      missB: number;
      /** How sure Atlas was of each answer, or null where it didn't say. */
      sureA: number | null;
      sureB: number | null;
    }
  | { type: "next" };

export const initialFooled: FooledState = { phase: "idle" };

export function fooledReducer(state: FooledState, action: FooledAction): FooledState {
  switch (action.type) {
    case "start": {
      const blank: Run = { order: action.order, index: 0, streak: 0, atlasRight: 0, atlasPlayed: 0 };
      const run: Run = action.from ? { ...blank, ...action.from, index: action.from.streak } : blank;
      return run.index + 1 >= action.order.length
        ? { phase: "cleared", ...run }
        : { phase: "picking", ...run };
    }
    case "picked": {
      if (state.phase !== "picking") return state;
      const verdict = judgeFooled(action.side, action.missA, action.missB);
      const own = atlasFooledPick(action.sureA, action.sureB);
      const atlas = own === null ? null : judgeFooled(own, action.missA, action.missB);
      return {
        ...state,
        phase: "answered",
        streak: state.streak + (verdict.correct ? 1 : 0),
        atlasRight: state.atlasRight + (atlas?.correct ? 1 : 0),
        atlasPlayed: state.atlasPlayed + (atlas ? 1 : 0),
        verdict,
        atlas,
      };
    }
    case "next": {
      // A wrong pick ends the run; only a new "start" plays on.
      if (state.phase !== "answered" || !state.verdict.correct) return state;
      const { order, streak, atlasRight, atlasPlayed } = state;
      const run = { order, index: state.index + 1, streak, atlasRight, atlasPlayed };
      return run.index + 1 >= order.length
        ? { phase: "cleared", ...run }
        : { phase: "picking", ...run };
    }
  }
}

/** True once the run has ended, by a wrong pick or by playing every photo. */
export function fooledOver(state: FooledState): boolean {
  return state.phase === "cleared" || (state.phase === "answered" && !state.verdict.correct);
}

/** "very sure", "fairly sure", "unsure": Atlas's sureness in words, for the answer card. */
export function surenessWords(p: number): string {
  if (p >= 0.75) return "very sure";
  if (p >= 0.5) return "fairly sure";
  if (p >= 0.25) return "unsure";
  return "guessing";
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The best streak this browser has kept, or 0 when none is stored or it can't be read. */
export function loadBestFooled(): number {
  try {
    const raw = storage()?.getItem(BEST_FOOLED_KEY);
    if (!raw) return 0;
    const value: unknown = JSON.parse(raw);
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * Keep `streak` if it beats the stored best, and return the best after that. Called after every
 * right pick, so a player who leaves mid-run keeps how far they got.
 */
export function rememberFooled(streak: number): number {
  const best = loadBestFooled();
  if (streak <= best) return best;
  try {
    storage()?.setItem(BEST_FOOLED_KEY, JSON.stringify(streak));
  } catch {
    // Private mode or full storage: the streak still counts for this visit.
  }
  return streak;
}
