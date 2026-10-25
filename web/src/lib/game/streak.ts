/**
 * Country Streak: name the country each photo was taken in by tapping it on the globe, one
 * photo after another, until the first miss.
 *
 * The rules live here as a pure reducer so they can be tested without a globe. Which country a
 * tap lands in comes from `countryAt` (src/lib/countryHit.ts), and only photos whose country
 * the globe draws are dealt (`streakIds`), so every photo has a country the player can tap.
 * The best streak is kept in this browser only, best effort.
 */

import type { LngLat } from "@/lib/geo";

export const BEST_STREAK_KEY = "whereabout:country-streak-best";

/** The player's current choice: where they tapped and the country there (null over the sea). */
export interface StreakPick {
  at: LngLat;
  country: string | null;
}

export interface StreakAnswer {
  /** The country the photo was taken in. */
  truth: string;
  /** The country the player named. */
  guess: string;
  correct: boolean;
}

export type StreakState =
  | { phase: "idle" }
  | {
      /** Picking a country for photo `index`; `pick` is null until the first tap. */
      phase: "guessing";
      order: readonly string[];
      index: number;
      streak: number;
      pick: StreakPick | null;
    }
  | {
      /** The answer is shown. A miss ends the run; a hit goes on to the next photo. */
      phase: "answered";
      order: readonly string[];
      index: number;
      streak: number;
      pick: StreakPick & { country: string };
      answer: StreakAnswer;
    }
  | {
      /** Every photo named without a miss. */
      phase: "cleared";
      order: readonly string[];
      streak: number;
    };

export type StreakAction =
  | { type: "start"; order: readonly string[] }
  | { type: "picked"; pick: StreakPick }
  | { type: "answered"; truth: string }
  | { type: "next" };

export const initialStreak: StreakState = { phase: "idle" };

export function streakReducer(state: StreakState, action: StreakAction): StreakState {
  switch (action.type) {
    case "start":
      return action.order.length === 0
        ? { phase: "cleared", order: [], streak: 0 }
        : { phase: "guessing", order: action.order, index: 0, streak: 0, pick: null };
    case "picked":
      return state.phase === "guessing" ? { ...state, pick: action.pick } : state;
    case "answered": {
      // A tap on the sea names no country, so there is nothing to check yet.
      if (state.phase !== "guessing" || !state.pick?.country) return state;
      const pick = { ...state.pick, country: state.pick.country };
      const correct = pick.country === action.truth;
      return {
        phase: "answered",
        order: state.order,
        index: state.index,
        streak: state.streak + (correct ? 1 : 0),
        pick,
        answer: { truth: action.truth, guess: pick.country, correct },
      };
    }
    case "next": {
      // After a miss the run is over; only a new "start" plays on.
      if (state.phase !== "answered" || !state.answer.correct) return state;
      const index = state.index + 1;
      if (index >= state.order.length) {
        return { phase: "cleared", order: state.order, streak: state.streak };
      }
      return { phase: "guessing", order: state.order, index, streak: state.streak, pick: null };
    }
  }
}

/** True once the run has ended, by a miss or by naming every photo. */
export function runOver(state: StreakState): boolean {
  return state.phase === "cleared" || (state.phase === "answered" && !state.answer.correct);
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The best streak this browser has seen, 0 when none is stored or storage is unavailable. */
export function loadBestStreak(): number {
  try {
    const value = Number(storage()?.getItem(BEST_STREAK_KEY));
    return Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * Keep `streak` if it beats the stored best, and return the best after that. Called after
 * every hit, so a player who leaves mid-run keeps their streak.
 */
export function rememberStreak(streak: number): number {
  const best = loadBestStreak();
  if (streak <= best) return best;
  try {
    storage()?.setItem(BEST_STREAK_KEY, String(streak));
  } catch {
    // Private mode or full storage: the streak still counts for this visit.
  }
  return streak;
}
