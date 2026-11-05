/**
 * Hot and cold: one photo and up to three pins to find its country.
 *
 * A pin in the right country ends the photo. A pin anywhere else (the sea counts) says how far
 * off it was and which way to head from it, by the great-circle starting bearing, without naming
 * the place; a second miss also says whether it was warmer or colder than the first. The third
 * pin ends the photo wherever it lands.
 *
 * A photo scores its closest pin on the usual distance curve (`scoreDistance`), so a wide country
 * found at its far end can still be beaten by an earlier near miss, plus `PIN_BONUS` for how few
 * pins found the country. Atlas gets one pin a photo, scored by the same rules, so its bonus is
 * the first pin's or nothing. A game is `HOT_PHOTOS` photos.
 *
 * The rules live here as a pure reducer so they can be tested without a globe; which country a
 * pin landed in comes from `countryAt` (src/lib/countryHit.ts), and only photos whose country the
 * globe draws are dealt (`streakIds`), so every photo can be found. The best game is kept in this
 * browser only, best effort.
 */

import { MAX_POINTS, formatPoints, haversineKm, scoreDistance, type LngLat } from "@/lib/geo";

import { POINT_NAMES, initialBearing, pointOf } from "./whichWay";

export const HOT_PHOTOS = 5;
export const MAX_PINS = 3;
/** Points for finding the country on the first, second and third pin. */
export const PIN_BONUS = [1000, 500, 0] as const;
/** The most one photo can score: the pin on the place, first time. */
export const PHOTO_POINTS = MAX_POINTS + PIN_BONUS[0];
export const BEST_HOT_KEY = "whereabout:hot-cold-best";

export interface HotPin {
  at: LngLat;
  km: number;
  /** The great-circle starting bearing from this pin to the photo, degrees clockwise from north. */
  bearing: number;
  /** True when it landed in the photo's country. */
  found: boolean;
}

/** What a pin that missed tells the player. Names no place. */
export interface HotClue {
  km: number;
  bearing: number;
  /** The way to head, in words: "south-east". */
  heading: string;
  /** Against the pin before it; null on the first pin. */
  trend: "warmer" | "colder" | null;
}

/** Atlas's one pin on a photo, scored by the player's rules. */
export interface HotAtlas {
  km: number;
  found: boolean;
  score: number;
}

export interface HotRound {
  id: string;
  /** Every pin dropped, in order. */
  pins: readonly HotPin[];
  /** The closest of them. */
  bestKm: number;
  /** The 1-based pin that found the country; null when none did. */
  foundOn: number | null;
  /** Points for the closest pin. */
  closest: number;
  bonus: number;
  score: number;
  /** Null when Atlas never guessed this photo. */
  atlas: HotAtlas | null;
}

/** The pin dropped at `at` for a photo at `truth`. */
export function hotPin(at: LngLat, truth: LngLat, found: boolean): HotPin {
  return { at, km: haversineKm(at, truth), bearing: initialBearing(at, truth), found };
}

/** The clue from the last of `pins`, compared with the pin before it. */
export function hotClue(pins: readonly HotPin[]): HotClue | null {
  const last = pins.at(-1);
  if (!last) return null;
  const before = pins.at(-2);
  return {
    km: last.km,
    bearing: last.bearing,
    heading: POINT_NAMES[pointOf(last.bearing)],
    trend: before ? (last.km < before.km ? "warmer" : "colder") : null,
  };
}

/** Atlas's score for a pin `km` from the photo, `found` when it landed in the right country. */
export function hotAtlas(km: number, found: boolean): HotAtlas {
  return { km, found, score: scoreDistance(km) + (found ? PIN_BONUS[0] : 0) };
}

/** A photo's result from the pins dropped on it. */
export function hotRound(id: string, pins: readonly HotPin[], atlas: HotAtlas | null): HotRound {
  const bestKm = Math.min(...pins.map((p) => p.km));
  const at = pins.findIndex((p) => p.found);
  const closest = scoreDistance(bestKm);
  const bonus = at >= 0 ? PIN_BONUS[at]! : 0;
  return {
    id,
    pins,
    bestKm,
    foundOn: at >= 0 ? at + 1 : null,
    closest,
    bonus,
    score: closest + bonus,
    atlas,
  };
}

interface Game {
  order: readonly string[];
  index: number;
  results: readonly HotRound[];
}

export type HotState =
  | { phase: "idle" }
  | (Game & {
      /** Pinning photo `index`: `pins` have missed, `pin` is the next one, null until tapped. */
      phase: "guessing";
      pins: readonly HotPin[];
      pin: LngLat | null;
    })
  | (Game & {
      /** The photo is over and its answer shown; its result is the last of `results`. */
      phase: "answered";
      round: HotRound;
    })
  | { phase: "finished"; order: readonly string[]; results: readonly HotRound[] };

export type HotAction =
  | {
      type: "start";
      order: readonly string[];
      /** A game picked back up: the photos finished, and the pins already on the next one. */
      from?: { results: readonly HotRound[]; pins: readonly HotPin[] };
    }
  | { type: "pinned"; pin: LngLat }
  | {
      type: "dropped";
      truth: LngLat;
      /** Whether the pin landed in the photo's country (src/lib/countryHit.ts). */
      found: boolean;
      atlas: HotAtlas | null;
    }
  | { type: "next" };

export const initialHot: HotState = { phase: "idle" };

export function hotReducer(state: HotState, action: HotAction): HotState {
  switch (action.type) {
    case "start": {
      const { order, from } = action;
      const results = from?.results ?? [];
      if (results.length >= order.length) return { phase: "finished", order, results };
      const pins = from?.pins ?? [];
      return { phase: "guessing", order, index: results.length, results, pins, pin: null };
    }
    case "pinned":
      return state.phase === "guessing" ? { ...state, pin: action.pin } : state;
    case "dropped": {
      if (state.phase !== "guessing" || !state.pin) return state;
      const pins = [...state.pins, hotPin(state.pin, action.truth, action.found)];
      if (!action.found && pins.length < MAX_PINS) return { ...state, pins, pin: null };
      const round = hotRound(state.order[state.index]!, pins, action.atlas);
      const { order, index } = state;
      return { phase: "answered", order, index, results: [...state.results, round], round };
    }
    case "next": {
      if (state.phase !== "answered") return state;
      const { order, results } = state;
      const index = state.index + 1;
      return index >= order.length
        ? { phase: "finished", order, results }
        : { phase: "guessing", order, index, results, pins: [], pin: null };
    }
  }
}

export function hotTotal(results: readonly HotRound[]): number {
  return results.reduce((sum, r) => sum + r.score, 0);
}

/** Atlas's total over the photos it played, and how many that was. */
export function atlasTotal(results: readonly HotRound[]): { total: number; played: number } {
  let total = 0;
  let played = 0;
  for (const r of results) {
    if (!r.atlas) continue;
    total += r.atlas.score;
    played += 1;
  }
  return { total, played };
}

/**
 * The end screen's line about Atlas, or null if it played none of the photos. Who won is only
 * called over a whole game: on fewer photos its total isn't a score to set against yours.
 */
export function hotAtlasLine(results: readonly HotRound[]): string | null {
  const { total, played } = atlasTotal(results);
  if (played === 0) return null;
  if (played < results.length) {
    return `Atlas scored ${formatPoints(total)} with one pin each on the ${played} of ${results.length} photos it played.`;
  }
  const you = hotTotal(results);
  const atlas = `Atlas scored ${formatPoints(total)} with one pin a photo`;
  if (you === total) return `${atlas}: level with you.`;
  const by = formatPoints(Math.abs(you - total));
  return you > total ? `${atlas}. You beat it by ${by}.` : `${atlas}, ${by} ahead of you.`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The best game's points in this browser, 0 when none is stored or it can't be read. */
export function loadBestHot(): number {
  try {
    const value = Number(storage()?.getItem(BEST_HOT_KEY));
    return Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** Keep `total` if it beats the stored best, and return the best after that. */
export function rememberHot(total: number): number {
  const best = loadBestHot();
  if (total <= best) return best;
  try {
    storage()?.setItem(BEST_HOT_KEY, String(total));
  } catch {
    // Private mode or full storage: the game still counts for this visit.
  }
  return total;
}
