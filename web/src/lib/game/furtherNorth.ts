/**
 * Further North: two photos side by side, and the player picks the one taken further north.
 *
 * Higher-or-lower style: after a right pick the second photo stays and a new one is dealt next to
 * it, so every photo is judged twice, once against the photo before it and once against the one
 * after. The run ends on the first wrong pick, or when every photo has been played.
 *
 * Two photos whose latitudes are within `TIE_DEGREES` of each other (about 110 km north to
 * south) are too close to call from a photo, so either pick counts as right. Atlas plays along:
 * its pick is the photo whose Atlas guess lies further north, judged by the same rule, so the
 * reveal can say whether Atlas would have got the pair.
 *
 * The rules live here as a pure reducer so they can be tested without photos. The best streak is
 * kept in this browser only, best effort.
 */

import { EARTH_RADIUS_KM } from "@/lib/geo";

/** Latitudes closer than this count as a dead heat: either pick is right. */
export const TIE_DEGREES = 1;
export const BEST_NORTH_KEY = "whereabout:further-north-best";

/** The first photo of the pair (left on wide screens, top on phones) or the second. */
export type Side = "a" | "b";

/** How one pair came out. */
export interface NorthVerdict {
  /** The side the player picked. */
  picked: Side;
  /** The side really taken further north (by a hair, when `tie`). */
  north: Side;
  /** True when the latitudes are within `TIE_DEGREES`, so either pick counts. */
  tie: boolean;
  correct: boolean;
  /** North-south distance between the two photos, in kilometres. */
  apartKm: number;
}

/** Kilometres of north-south distance between two latitudes, along a meridian. */
export function northSouthKm(latA: number, latB: number): number {
  return (Math.abs(latA - latB) * Math.PI * EARTH_RADIUS_KM) / 180;
}

/** Judges a pick of `picked` between photos at latitudes `latA` and `latB`. */
export function judgeNorth(picked: Side, latA: number, latB: number): NorthVerdict {
  const north: Side = latA >= latB ? "a" : "b";
  const tie = Math.abs(latA - latB) < TIE_DEGREES;
  return {
    picked,
    north,
    tie,
    correct: tie || picked === north,
    apartKm: northSouthKm(latA, latB),
  };
}

/** "59.6° N", "33.9° S", "0.0°" on the Equator. */
export function formatLatitude(lat: number): string {
  const rounded = Math.round(Math.abs(lat) * 10) / 10;
  if (rounded === 0) return "0.0°";
  return `${rounded.toFixed(1)}° ${lat > 0 ? "N" : "S"}`;
}

interface Run {
  order: readonly string[];
  /** The pair on screen is `order[index]` and `order[index + 1]`. */
  index: number;
  /** Right picks in a row this run. */
  streak: number;
  /** Pairs Atlas would have got right, and pairs it played (both photos guessed). */
  atlasRight: number;
  atlasPlayed: number;
}

export type NorthState =
  | { phase: "idle" }
  | (Run & { phase: "picking" })
  | (Run & {
      /** The pair's places are shown. A wrong pick ends the run; a right one plays on. */
      phase: "answered";
      verdict: NorthVerdict;
      /** Atlas's verdict on the same pair, or null when it hasn't guessed both photos. */
      atlas: NorthVerdict | null;
    })
  | (Run & {
      /** Every photo played without a wrong pick. */
      phase: "cleared";
    });

export type NorthAction =
  | {
      type: "start";
      order: readonly string[];
      /**
       * Pick a run back up where it was left (today's run, src/lib/game/northDaily.ts): the
       * pair on screen is `order[streak]` and `order[streak + 1]`.
       */
      from?: { streak: number; atlasRight: number; atlasPlayed: number };
    }
  | {
      type: "picked";
      side: Side;
      /** The pair's true latitudes. */
      latA: number;
      latB: number;
      /** Atlas's guessed latitudes for the pair, or null where it has no guess. */
      atlasA: number | null;
      atlasB: number | null;
    }
  | { type: "next" };

export const initialNorth: NorthState = { phase: "idle" };

const blankRun = (order: readonly string[]): Run => ({
  order,
  index: 0,
  streak: 0,
  atlasRight: 0,
  atlasPlayed: 0,
});

export function northReducer(state: NorthState, action: NorthAction): NorthState {
  switch (action.type) {
    case "start": {
      const run = action.from
        ? { ...blankRun(action.order), ...action.from, index: action.from.streak }
        : blankRun(action.order);
      return run.index + 1 >= action.order.length
        ? { phase: "cleared", ...run }
        : { phase: "picking", ...run };
    }
    case "picked": {
      if (state.phase !== "picking") return state;
      const verdict = judgeNorth(action.side, action.latA, action.latB);
      let atlas: NorthVerdict | null = null;
      if (action.atlasA !== null && action.atlasB !== null) {
        // Atlas picks the photo whose guess is further north; it is judged on the true latitudes.
        const atlasPick: Side = action.atlasA >= action.atlasB ? "a" : "b";
        atlas = judgeNorth(atlasPick, action.latA, action.latB);
      }
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
      const index = state.index + 1;
      const run = { order, index, streak, atlasRight, atlasPlayed };
      return index + 1 >= order.length
        ? { phase: "cleared", ...run }
        : { phase: "picking", ...run };
    }
  }
}

/** True once the run has ended, by a wrong pick or by playing every photo. */
export function northOver(state: NorthState): boolean {
  return state.phase === "cleared" || (state.phase === "answered" && !state.verdict.correct);
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The best streak this browser has kept, or 0 when none is stored or it can't be read. */
export function loadBestNorth(): number {
  try {
    const raw = storage()?.getItem(BEST_NORTH_KEY);
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
export function rememberNorth(streak: number): number {
  const best = loadBestNorth();
  if (streak <= best) return best;
  try {
    storage()?.setItem(BEST_NORTH_KEY, JSON.stringify(streak));
  } catch {
    // Private mode or full storage: the streak still counts for this visit.
  }
  return streak;
}
