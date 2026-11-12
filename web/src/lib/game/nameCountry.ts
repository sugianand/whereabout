/**
 * Name the country: one photo, four country names, tap the right one. A right tap deals the next
 * photo; the first wrong tap ends the run.
 *
 * The wrong names come from the photo's own continent, so the continent alone never settles it,
 * and from the countries the globe draws (`deck.countryPool`), so none is a speck that gives
 * itself away. Which names a photo gets is worked out from a seed (`nameOptions`) rather than
 * held in state: the same run seed always gives the same four, in the same order, whatever is
 * re-rendered.
 *
 * Atlas plays along from its own country probabilities: of the four names on the screen it picks
 * the one it gave the most (`atlasName`). The wrong names were not chosen with Atlas in mind, so
 * it may have given none of them anything; then it sits the photo out. A photo Atlas never
 * guessed sits it out too. Atlas's picks don't end the run; it is only ever judged against the
 * true answer.
 *
 * The rules live here as a pure reducer so they can be tested without photos. The best run is
 * kept in this browser only, best effort.
 */

import { CONTINENT_OF, CONTINENTS, type Continent } from "@/lib/continents";

import { hashSeed, seededShuffle } from "./daily";
import type { Regions } from "./regions";
import type { AtlasGuess } from "./types";

export const BEST_NAME_KEY = "whereabout:name-country-best";
/** Names offered for one photo. */
export const NAME_OPTIONS = 4;

/** Country codes by continent, in table order. */
export type CountryPool = Partial<Record<Continent, string[]>>;

/** Group `countries` by continent; codes the continent table doesn't know join none. */
export function buildCountryPool(countries: Iterable<string>): CountryPool {
  const known = new Set(countries);
  const pool: CountryPool = {};
  for (const [code, continent] of CONTINENT_OF) {
    if (known.has(code)) (pool[continent] ??= []).push(code);
  }
  return pool;
}

/**
 * The photos a run can deal, in deck order: taken in a country the globe draws, on a continent
 * with enough photos for a game (`deck.regions`, which leaves out the lone Antarctic photo, whose
 * continent has no three other countries to offer).
 */
export function nameIds(streakIds: readonly string[], regions: Regions): string[] {
  const dealable = new Set(Object.values(regions).flat());
  return streakIds.filter((id) => dealable.has(id));
}

/** The seed for one photo's names in a run, so each photo gets its own draw. */
export function nameSeed(runSeed: number, id: string): number {
  return hashSeed(`whereabout:name-country:${runSeed}:${id}`);
}

/**
 * The four names for a photo from `truth`: three others from its continent, shuffled in with the
 * truth. A continent too small to fill them is topped up from the rest of the world, so there are
 * always four as long as the pool holds them. Pure in `seed`.
 */
export function nameOptions(truth: string, pool: CountryPool, seed: number): string[] {
  const near = (CONTINENT_OF.get(truth) && pool[CONTINENT_OF.get(truth)!]) || [];
  const far = CONTINENTS.flatMap((c) => (near === pool[c] ? [] : (pool[c] ?? [])));
  const others = [
    ...seededShuffle(
      near.filter((c) => c !== truth),
      seed,
    ),
    ...seededShuffle(
      far.filter((c) => c !== truth),
      seed + 1,
    ),
  ].slice(0, NAME_OPTIONS - 1);
  return seededShuffle([truth, ...others], seed + 2);
}

/** Atlas's read of one photo's four names. */
export interface AtlasName {
  /** The country Atlas picked. */
  picked: string;
  /** The probability Atlas gave it. */
  p: number;
  correct: boolean;
}

/** The probability Atlas gave `country`: from its whole belief, or its top countries. */
export function atlasP(guess: AtlasGuess, country: string): number {
  const top = guess.topCountries.find((t) => t.country === country)?.p ?? 0;
  return Math.max(guess.belief?.[country] ?? 0, top);
}

/**
 * Atlas's pick of `options`: the one it gave the most, the first on a tie. Null when it never
 * guessed the photo, or gave none of the four anything.
 */
export function atlasName(
  guess: AtlasGuess | null,
  options: readonly string[],
  truth: string,
): AtlasName | null {
  if (!guess) return null;
  let picked: string | null = null;
  let p = 0;
  for (const country of options) {
    const q = atlasP(guess, country);
    if (q > p) {
      picked = country;
      p = q;
    }
  }
  return picked === null ? null : { picked, p, correct: picked === truth };
}

interface Run {
  order: readonly string[];
  index: number;
  /** The run's seed: with a photo's id, it settles that photo's names (`nameSeed`). */
  seed: number;
  /** Right taps in a row this run. */
  streak: number;
  /** Photos Atlas got right, and photos it played (`atlasName` was not null). */
  atlasRight: number;
  atlasPlayed: number;
}

export type NameState =
  | { phase: "idle" }
  /** Nothing to deal. */
  | { phase: "none" }
  | (Run & { phase: "guessing" })
  | (Run & {
      phase: "answered";
      truth: string;
      picked: string;
      correct: boolean;
      atlas: AtlasName | null;
    })
  /** Every photo named without a miss. */
  | (Run & { phase: "cleared" });

export type NameAction =
  | {
      type: "start";
      order: readonly string[];
      seed: number;
      /** Pick a run back up: the tally so far, with `order[streak]` the photo it stands at. */
      from?: { streak: number; atlasRight: number; atlasPlayed: number };
    }
  | {
      type: "picked";
      /** The country tapped; ignored unless it is one of `options`. */
      country: string;
      options: readonly string[];
      truth: string;
      atlas: AtlasGuess | null;
    }
  | { type: "next" };

export const initialName: NameState = { phase: "idle" };

export function nameReducer(state: NameState, action: NameAction): NameState {
  switch (action.type) {
    case "start": {
      if (action.order.length === 0) return { phase: "none" };
      const { order, seed } = action;
      const { streak, atlasRight, atlasPlayed } = action.from ?? {
        streak: 0,
        atlasRight: 0,
        atlasPlayed: 0,
      };
      // A kept run can stand past a deck that has since shrunk: it has named every photo.
      return streak >= order.length
        ? {
            phase: "cleared",
            order,
            seed,
            index: order.length - 1,
            streak,
            atlasRight,
            atlasPlayed,
          }
        : { phase: "guessing", order, seed, index: streak, streak, atlasRight, atlasPlayed };
    }
    case "picked": {
      if (state.phase !== "guessing" || !action.options.includes(action.country)) return state;
      const correct = action.country === action.truth;
      const atlas = atlasName(action.atlas, action.options, action.truth);
      return {
        ...state,
        phase: "answered",
        truth: action.truth,
        picked: action.country,
        correct,
        atlas,
        streak: state.streak + (correct ? 1 : 0),
        atlasRight: state.atlasRight + (atlas?.correct ? 1 : 0),
        atlasPlayed: state.atlasPlayed + (atlas ? 1 : 0),
      };
    }
    case "next": {
      // A wrong tap ends the run; only a new "start" plays on.
      if (state.phase !== "answered" || !state.correct) return state;
      const { order, index, seed, streak, atlasRight, atlasPlayed } = state;
      const run = { order, seed, streak, atlasRight, atlasPlayed };
      return index + 1 >= order.length
        ? { ...run, phase: "cleared", index }
        : { ...run, phase: "guessing", index: index + 1 };
    }
  }
}

/** True once a wrong tap has ended the run. */
export function nameOver(state: NameState): boolean {
  return state.phase === "answered" && !state.correct;
}

/** What Atlas's pick came to, as a percentage it can be shown as: never a bare 0%. */
export function atlasPercent(p: number): number {
  return Math.max(1, Math.round(p * 100));
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The best run this browser has kept, or 0 when none is stored or it can't be read. `key` picks
 * which best: free runs, or practice runs (`nameMixUps.ts`), which keep their own.
 */
export function loadBestName(key = BEST_NAME_KEY): number {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return 0;
    const value: unknown = JSON.parse(raw);
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** Keep `streak` if it beats the stored best, and return the best after that. */
export function rememberName(streak: number, key = BEST_NAME_KEY): number {
  const best = loadBestName(key);
  if (streak <= best) return best;
  try {
    storage()?.setItem(key, JSON.stringify(streak));
  } catch {
    // Private mode or full storage: the run still counts for this visit.
  }
  return streak;
}
