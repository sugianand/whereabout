/**
 * Left or right?: one photo at a time, and the player calls which side of the road traffic keeps
 * to where it was taken. Endless until the first wrong call, like Further North.
 *
 * The truth is the photo's own driving-side label (data/labels/concept_labels.csv, the side of the
 * country it was taken in), so a photo of a glacier still has an answer: the game asks the player
 * to read the country from whatever the photo shows, not only from cars.
 *
 * About three in four catalog photos are from right-hand-traffic countries, so a deck in catalog
 * proportions would let "always right" run long. `leftRightOrder` deals evenly instead: each photo
 * comes from the left or the right pile by a fair coin, and the run is cleared when either pile
 * runs out, so no call is ever worth more than a guess without reading the photo.
 *
 * Atlas plays along with the read the reveal's real clues already judge it on (`atlasDrivingSide`
 * in src/lib/trueClues.ts): its "Drives on the …" clue, or else the side of the country it picked.
 *
 * The rules are a pure reducer, so they're tested without photos. The best run is kept in this
 * browser only, best effort.
 */

import type { DrivingSide } from "@/lib/drivingSides";
import { countryInSentence } from "@/lib/missLesson";
import type { AtlasSideRead } from "@/lib/trueClues";

import { mulberry32, seededShuffle } from "./daily";

export const BEST_LEFT_RIGHT_KEY = "whereabout:left-right-best";

/** Each dealable photo's driving side, by photo id, in catalog order. */
export type SideMap = Readonly<Record<string, DrivingSide>>;

export const SIDES: readonly DrivingSide[] = ["left", "right"];

/**
 * The run's photos for `seed`: both piles shuffled, then drawn from one or the other by a fair
 * coin until either is empty. Pure in the seed, so a run can be dealt again from it.
 */
export function leftRightOrder(sides: SideMap, seed: number): string[] {
  const ids = Object.keys(sides);
  const piles = {
    left: seededShuffle(
      ids.filter((id) => sides[id] === "left"),
      seed,
    ),
    right: seededShuffle(
      ids.filter((id) => sides[id] === "right"),
      (seed ^ 0x9e3779b9) >>> 0,
    ),
  };
  const coin = mulberry32((seed + 0x6d2b79f5) >>> 0);
  const out: string[] = [];
  let l = 0;
  let r = 0;
  while (l < piles.left.length && r < piles.right.length) {
    out.push(coin() < 0.5 ? piles.left[l++] : piles.right[r++]);
  }
  return out;
}

/** How one call came out. */
export interface SideVerdict {
  picked: DrivingSide;
  truth: DrivingSide;
  correct: boolean;
}

/** Atlas's call on the same photo, judged on the same truth. */
export interface AtlasSideVerdict extends SideVerdict {
  read: AtlasSideRead;
}

interface Run {
  order: readonly string[];
  /** The photo on screen is `order[index]`. */
  index: number;
  /** Right calls in a row this run. */
  streak: number;
  /** Photos Atlas called right, and photos it called. */
  atlasRight: number;
  atlasPlayed: number;
}

export type LeftRightState =
  | { phase: "idle" }
  | (Run & { phase: "picking" })
  | (Run & {
      /** The photo's country and side are shown. A wrong call ends the run. */
      phase: "answered";
      verdict: SideVerdict;
      /** Atlas's call, or null when it said nothing about the road. */
      atlas: AtlasSideVerdict | null;
    })
  | (Run & { phase: "cleared" });

export type LeftRightAction =
  | {
      type: "start";
      order: readonly string[];
      /** A kept run to pick up from (today's run after a reload): it goes on at `order[streak]`. */
      from?: { streak: number; atlasRight: number; atlasPlayed: number };
    }
  | { type: "picked"; side: DrivingSide; truth: DrivingSide; atlas: AtlasSideRead | null }
  | { type: "next" };

export const initialLeftRight: LeftRightState = { phase: "idle" };

export function leftRightReducer(state: LeftRightState, action: LeftRightAction): LeftRightState {
  switch (action.type) {
    case "start": {
      const from = action.from ?? { streak: 0, atlasRight: 0, atlasPlayed: 0 };
      const run: Run = { order: action.order, index: from.streak, ...from };
      return run.index >= action.order.length
        ? { phase: "cleared", ...run }
        : { phase: "picking", ...run };
    }
    case "picked": {
      if (state.phase !== "picking") return state;
      const verdict: SideVerdict = {
        picked: action.side,
        truth: action.truth,
        correct: action.side === action.truth,
      };
      const atlas: AtlasSideVerdict | null = action.atlas
        ? {
            read: action.atlas,
            picked: action.atlas.side,
            truth: action.truth,
            correct: action.atlas.side === action.truth,
          }
        : null;
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
      if (state.phase !== "answered" || !state.verdict.correct) return state;
      const { order, streak, atlasRight, atlasPlayed } = state;
      const run: Run = { order, index: state.index + 1, streak, atlasRight, atlasPlayed };
      return run.index >= order.length
        ? { phase: "cleared", ...run }
        : { phase: "picking", ...run };
    }
  }
}

/** True once the run has ended, by a wrong call or by calling every photo dealt. */
export function leftRightOver(state: LeftRightState): boolean {
  return state.phase === "cleared" || (state.phase === "answered" && !state.verdict.correct);
}

/** The answer in words: "In Japan they drive on the left." */
export function truthLine(country: string, side: DrivingSide): string {
  return `In ${countryInSentence(country)} they drive on the ${side}.`;
}

/**
 * Atlas's call in words, from what it actually read: "Atlas read the left from the photo, and
 * got it." or "Atlas picked Brazil, where they drive on the right: wrong."
 */
export function atlasLine(atlas: AtlasSideVerdict): string {
  const outcome = atlas.correct ? ", and got it." : ": wrong.";
  return atlas.read.from === "clue"
    ? `Atlas read the ${atlas.picked} from the photo${outcome}`
    : `Atlas picked ${countryInSentence(atlas.read.country)}, where they drive on the ${atlas.picked}${outcome}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The best run this browser has kept, or 0 when none is stored or it can't be read. */
export function loadBestLeftRight(): number {
  try {
    const raw = storage()?.getItem(BEST_LEFT_RIGHT_KEY);
    if (!raw) return 0;
    const value: unknown = JSON.parse(raw);
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** Keep `streak` if it beats the stored best, and return the best after that. */
export function rememberLeftRight(streak: number): number {
  const best = loadBestLeftRight();
  if (streak <= best) return best;
  try {
    storage()?.setItem(BEST_LEFT_RIGHT_KEY, JSON.stringify(streak));
  } catch {
    // Private mode or full storage: the run still counts for this visit.
  }
  return streak;
}
