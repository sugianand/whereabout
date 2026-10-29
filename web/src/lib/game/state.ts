/**
 * The game as a pure state machine, so every transition is unit-tested without a browser.
 *
 *   loading ──started──▶ guessing ──pinned──▶ guessing (pin moves)
 *                          │ ──hintRequested──▶ guessing (hinting) ──hinted──▶ guessing (one more clue)
 *                          │ submitted
 *                          ▼
 *                       guessing (submitting) ──revealed──▶ revealed ──next──▶ loading
 *                          ▲                                       └─ after the last round ─▶ finished
 *                          └─ timeUp (Blitz): the clock locks the guess in, with or without a pin
 */
import { haversineKm, scoreDistance, type LngLat } from "@/lib/geo";
import type { Clue } from "@/lib/hints";

import type { AtlasGuess, Reveal, RoundStart } from "./types";

export const ROUNDS_PER_GAME = 5;

export interface RoundResult {
  round: RoundStart;
  /** Where the player guessed, or null when a Blitz clock ran out before any pin (score 0). */
  pin: LngLat | null;
  reveal: Reveal;
  /** The hints taken this round, in order (the score already counts them). */
  clues: Clue[];
  /** Atlas's guess for this photo, scored against the same answer, or null if it has none. */
  atlas: (AtlasGuess & { distanceKm: number; score: number }) | null;
  /** Set when a Blitz clock, not the player, locked this guess in. */
  timedOut?: true;
}

export type GameState =
  | {
      phase: "loading";
      index: number;
      results: RoundResult[];
      error: string | null;
    }
  | {
      phase: "guessing";
      index: number;
      results: RoundResult[];
      round: RoundStart;
      pin: LngLat | null;
      /** Hints taken so far, newest last. */
      clues: Clue[];
      /** A hint is on its way. */
      hinting: boolean;
      submitting: boolean;
      /** The Blitz clock ran out: the guess is going in as it stands, pin or no pin. */
      timedOut: boolean;
      error: string | null;
    }
  | {
      phase: "revealed";
      index: number;
      results: RoundResult[];
      current: RoundResult;
    }
  | { phase: "finished"; results: RoundResult[] };

export type GameAction =
  | { type: "started"; round: RoundStart }
  | { type: "pinned"; pin: LngLat }
  | { type: "hintRequested" }
  | { type: "hinted"; clues: Clue[] }
  | { type: "submitted" }
  | { type: "timeUp" }
  | { type: "revealed"; reveal: Reveal; atlas: AtlasGuess | null }
  | { type: "failed"; message: string }
  | { type: "next" }
  | { type: "restart" };

export const initialState: GameState = {
  phase: "loading",
  index: 0,
  results: [],
  error: null,
};

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "restart":
      return initialState;

    case "started":
      if (state.phase !== "loading") return state;
      return {
        phase: "guessing",
        index: state.index,
        results: state.results,
        round: action.round,
        pin: null,
        clues: [],
        hinting: false,
        submitting: false,
        timedOut: false,
        error: null,
      };

    case "pinned":
      if (state.phase !== "guessing" || state.submitting) return state;
      return { ...state, pin: action.pin, error: null };

    case "hintRequested":
      if (state.phase !== "guessing" || state.submitting || state.hinting) return state;
      if (state.clues.length >= state.round.hintsAvailable) return state;
      return { ...state, hinting: true, error: null };

    case "hinted":
      if (state.phase !== "guessing" || !state.hinting) return state;
      return { ...state, hinting: false, clues: action.clues };

    case "submitted":
      if (state.phase !== "guessing" || !state.pin || state.submitting || state.hinting) {
        return state;
      }
      return { ...state, submitting: true };

    case "timeUp":
      // A guess the player already sent stands; otherwise the pin (or its absence) goes in now.
      // A hint still on its way is dropped: the round is over.
      if (state.phase !== "guessing" || state.submitting) return state;
      return { ...state, submitting: true, hinting: false, timedOut: true, error: null };

    case "revealed": {
      if (state.phase !== "guessing" || (!state.pin && !state.timedOut)) return state;
      const { atlas, reveal } = action;
      let scoredAtlas: RoundResult["atlas"] = null;
      if (atlas) {
        const distanceKm = haversineKm(atlas, reveal.answer);
        scoredAtlas = {
          ...atlas,
          distanceKm,
          score: scoreDistance(distanceKm),
        };
      }
      const current: RoundResult = {
        round: state.round,
        pin: state.pin,
        reveal,
        clues: state.clues,
        atlas: scoredAtlas,
        ...(state.timedOut ? { timedOut: true as const } : {}),
      };
      return {
        phase: "revealed",
        index: state.index,
        results: [...state.results, current],
        current,
      };
    }

    case "failed":
      if (state.phase === "guessing") {
        // A Blitz guess that failed to send can be sent again by hand, so the clock lets go.
        return {
          ...state,
          submitting: false,
          hinting: false,
          timedOut: false,
          error: action.message,
        };
      }
      if (state.phase === "loading") return { ...state, error: action.message };
      return state;

    case "next":
      if (state.phase !== "revealed") return state;
      if (state.index + 1 >= ROUNDS_PER_GAME) return { phase: "finished", results: state.results };
      return {
        phase: "loading",
        index: state.index + 1,
        results: state.results,
        error: null,
      };
  }
}

/** Game totals for the player and Atlas, counting only rounds Atlas actually played. */
export function totals(results: readonly RoundResult[]) {
  const player = results.reduce((sum, r) => sum + r.reveal.score, 0);
  const played = results.filter((r) => r.atlas);
  const atlas = played.reduce((sum, r) => sum + (r.atlas?.score ?? 0), 0);
  const playerWins = played.filter((r) => r.reveal.score > (r.atlas?.score ?? 0)).length;
  const atlasWins = played.filter((r) => r.reveal.score < (r.atlas?.score ?? 0)).length;
  return { player, atlas, playerWins, atlasWins, atlasRounds: played.length };
}
