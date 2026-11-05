/**
 * Close-up: a tight crop of a photo and four country names. Each wrong name zooms the crop out and
 * costs a point, so the fewer clues it takes, the better: three points on the tightest crop, two
 * and one on the wider ones, none when the third wrong name ends the photo. Five photos a game.
 *
 * The four names are Name the country's (`nameOptions`): three others from the photo's continent,
 * worked out from a seed rather than held in state.
 *
 * Atlas plays by the same points from its own country probabilities: it would try the four in the
 * order of what it gave them, so the name's place in that order (`atlasTries`) is how many wrong
 * names it pays for. It only ever saw the whole photo, and the screen says so. A name it gave
 * nothing it would never try, so a truth it gave nothing scores it none; a photo it never guessed,
 * or where it gave none of the four anything, sits it out.
 *
 * The rules live here as a pure reducer so they can be tested without photos. The best game is
 * kept in this browser only, best effort.
 */

import { seededShuffle } from "./daily";
import { atlasP } from "./nameCountry";
import type { AtlasGuess } from "./types";

export const BEST_CLOSE_KEY = "whereabout:close-up-best";
/** Photos in a game. */
export const CLOSE_PHOTOS = 5;
/** What a photo is worth after 0, 1 and 2 wrong names; the third wrong name ends it on nothing. */
export const CLOSE_POINTS = [3, 2, 1] as const;
/** The most a game can score. */
export const CLOSE_MAX = CLOSE_PHOTOS * CLOSE_POINTS[0];

/** What a photo is worth after `wrong` wrong names. */
export function closePoints(wrong: number): number {
  return CLOSE_POINTS[wrong] ?? 0;
}

/** A game's photos: `CLOSE_PHOTOS` of `ids`, pure in `seed`. */
export function dealClose(ids: readonly string[], seed: number): string[] {
  return seededShuffle(ids, seed).slice(0, CLOSE_PHOTOS);
}

/** How Atlas would have played one photo's four names. */
export interface AtlasTries {
  /** The names it would try, in order: only those it gave anything. */
  order: string[];
  /** The answer's place in `order`, so its wrong tries; null when it would never try it. */
  rank: number | null;
  points: number;
}

/** Atlas's order for `options`, the first on a tie; null when it has nothing to say on them. */
export function atlasTries(
  guess: AtlasGuess | null,
  options: readonly string[],
  truth: string,
): AtlasTries | null {
  if (!guess) return null;
  const order = options
    .map((country, i) => ({ country, i, p: atlasP(guess, country) }))
    .filter(({ p }) => p > 0)
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map(({ country }) => country);
  if (order.length === 0) return null;
  const at = order.indexOf(truth);
  const rank = at < 0 ? null : at;
  return { order, rank, points: rank === null ? 0 : closePoints(rank) };
}

/** One photo's outcome. */
export interface CloseResult {
  id: string;
  points: number;
  atlas: AtlasTries | null;
}

interface Run {
  order: readonly string[];
  index: number;
  /** The run's seed: with a photo's id, it settles that photo's names. */
  seed: number;
  /** The wrong names tapped on this photo. */
  wrong: readonly string[];
  /** The photos over so far. */
  results: readonly CloseResult[];
}

export type CloseState =
  | { phase: "idle" }
  /** Nothing to deal. */
  | { phase: "none" }
  | (Run & { phase: "guessing" })
  | (Run & { phase: "answered"; truth: string; found: boolean; result: CloseResult })
  | (Run & { phase: "over" });

export type CloseAction =
  | { type: "start"; order: readonly string[]; seed: number }
  | {
      type: "picked";
      /** The country tapped; ignored unless it is one of `options` and not yet ruled out. */
      country: string;
      options: readonly string[];
      truth: string;
      atlas: AtlasGuess | null;
    }
  | { type: "next" };

export const initialClose: CloseState = { phase: "idle" };

export function closeReducer(state: CloseState, action: CloseAction): CloseState {
  switch (action.type) {
    case "start": {
      if (action.order.length === 0) return { phase: "none" };
      const { order, seed } = action;
      return { phase: "guessing", order, seed, index: 0, wrong: [], results: [] };
    }
    case "picked": {
      const { country, options, truth, atlas } = action;
      if (state.phase !== "guessing") return state;
      if (!options.includes(country) || state.wrong.includes(country)) return state;
      const found = country === truth;
      const wrong = found ? state.wrong : [...state.wrong, country];
      if (!found && wrong.length < CLOSE_POINTS.length) return { ...state, wrong };
      const result: CloseResult = {
        id: state.order[state.index],
        points: found ? closePoints(wrong.length) : 0,
        atlas: atlasTries(atlas, options, truth),
      };
      return {
        ...state,
        phase: "answered",
        wrong,
        truth,
        found,
        result,
        results: [...state.results, result],
      };
    }
    case "next": {
      if (state.phase !== "answered") return state;
      const { order, seed, index, results } = state;
      const run = { order, seed, results, wrong: [] };
      return index + 1 >= order.length
        ? { ...run, phase: "over", index }
        : { ...run, phase: "guessing", index: index + 1 };
    }
  }
}

/** Your points so far, and Atlas's on the photos it played. */
export function closeTotals(results: readonly CloseResult[]) {
  const played = results.filter((r) => r.atlas);
  return {
    you: results.reduce((n, r) => n + r.points, 0),
    /** Your points on just the photos Atlas played, so the two can be set side by side. */
    youOnPlayed: played.reduce((n, r) => n + r.points, 0),
    atlas: played.reduce((n, r) => n + r.atlas!.points, 0),
    atlasPlayed: played.length,
  };
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The best game this browser has kept, or 0 when none is stored or it can't be read. */
export function loadBestClose(): number {
  try {
    const raw = storage()?.getItem(BEST_CLOSE_KEY);
    if (!raw) return 0;
    const value: unknown = JSON.parse(raw);
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** Keep `points` if they beat the stored best, and return the best after that. */
export function rememberClose(points: number): number {
  const best = loadBestClose();
  if (points <= best) return best;
  try {
    storage()?.setItem(BEST_CLOSE_KEY, JSON.stringify(points));
  } catch {
    // Private mode or full storage: the game still counts for this visit.
  }
  return points;
}
