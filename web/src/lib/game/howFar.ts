/**
 * How far apart?: two photos, and the player sets how far apart they think the photos were taken
 * on a slider with a log scale from `MIN_KM` to `MAX_KM`. Five pairs a game.
 *
 * A pair is scored by how many times off the estimate was, not by kilometres: saying 200 km for
 * two photos 100 km apart is as far off as saying 2,000 km for two photos 1,000 km apart. Both
 * distances are clamped to the slider's range first, so two photos taken in the same town count
 * as `MIN_KM` apart and nothing is ever more than `MAX_KM` (about half the Earth's circumference).
 *
 * Atlas plays along: its estimate is the great-circle distance between its own guesses for the
 * two photos, scored the same way, so the reveal can put its number beside the player's.
 *
 * The rules live here as a pure reducer so they can be tested without photos. The best game is
 * kept in this browser only, best effort.
 */

import { haversineKm, type LngLat } from "@/lib/geo";

export const MIN_KM = 10;
export const MAX_KM = 20_000;
/** The slider's steps from `MIN_KM` to `MAX_KM`; each one is about 2% further. */
export const SLIDER_STEPS = 400;
/** Pairs in a game. */
export const PAIRS = 5;
/** The most one pair can score: an estimate within a hair of the truth. */
export const PAIR_POINTS = 1000;
/** Estimates within this factor of the truth read "Spot on". */
export const SPOT_ON = 1.1;
export const BEST_HOW_FAR_KEY = "whereabout:how-far-best";

const LOG_SPAN = Math.log(MAX_KM / MIN_KM);

/** `km` held to the slider's range. */
export function clampKm(km: number): number {
  if (!Number.isFinite(km)) return MAX_KM;
  return Math.min(MAX_KM, Math.max(MIN_KM, km));
}

/** Kilometres at a slider step: `MIN_KM` at 0, `MAX_KM` at `SLIDER_STEPS`, evenly in log. */
export function stepToKm(step: number): number {
  const t = Math.min(SLIDER_STEPS, Math.max(0, step)) / SLIDER_STEPS;
  return MIN_KM * Math.exp(t * LOG_SPAN);
}

/** The slider step nearest to `km` (clamped to the range). */
export function kmToStep(km: number): number {
  return Math.round((Math.log(clampKm(km) / MIN_KM) / LOG_SPAN) * SLIDER_STEPS);
}

/** Where `km` sits along the log scale, from 0 (`MIN_KM`) to 1 (`MAX_KM`). */
export function scalePosition(km: number): number {
  return Math.log(clampKm(km) / MIN_KM) / LOG_SPAN;
}

/** How many times off an estimate is: 1 when exact, never below 1, on clamped distances. */
export function timesOff(estimateKm: number, actualKm: number): number {
  const e = clampKm(estimateKm);
  const a = clampKm(actualKm);
  return Math.max(e, a) / Math.min(e, a);
}

/**
 * Points for an estimate `ratio` times off: `PAIR_POINTS` when exact, losing a third of them by
 * 2× off and all of them at 10× off or worse.
 */
export function scoreRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio < 1) throw new RangeError("ratio must be at least 1");
  return Math.round(PAIR_POINTS * Math.max(0, 1 - Math.log10(ratio)));
}

/** One estimate judged against the truth. */
export interface Estimate {
  km: number;
  ratio: number;
  points: number;
  /** Whether the estimate was further than the truth (false when spot on or too close). */
  tooFar: boolean;
}

export function judgeEstimate(estimateKm: number, actualKm: number): Estimate {
  const ratio = timesOff(estimateKm, actualKm);
  return {
    km: estimateKm,
    ratio,
    points: scoreRatio(ratio),
    tooFar: clampKm(estimateKm) > clampKm(actualKm),
  };
}

/** "Spot on", "1.6× too far", "12× too close". */
export function describeEstimate(estimate: Estimate): string {
  if (estimate.ratio < SPOT_ON) return "Spot on";
  const r = estimate.ratio;
  const times = r < 10 ? (Math.floor(r * 10) / 10).toFixed(1) : String(Math.floor(r));
  return `${times}× ${estimate.tooFar ? "too far" : "too close"}`;
}

/** How one pair came out. */
export interface PairResult {
  /** Great-circle distance between where the two photos were taken. */
  actualKm: number;
  you: Estimate;
  /** Atlas's estimate from its own two guesses, or null when it hasn't guessed both photos. */
  atlas: Estimate | null;
}

/** The pair's ids as dealt: `[first, second]`. */
export type Pair = readonly [string, string];

/**
 * Deal up to `PAIRS` pairs of different photos from a shuffled order, mixing near and far: the
 * first, third and fifth pairs are two photos from the same continent where the deck has one,
 * the others two photos from different continents, so a game uses the slider's whole range
 * rather than every pair landing thousands of kilometres apart. `continentOf` names each photo's
 * continent (undefined when unknown); with no match left, a pair takes the next photo in order.
 */
export function dealPairs(
  order: readonly string[],
  continentOf: (id: string) => string | undefined = () => undefined,
  count = PAIRS,
): Pair[] {
  const left = [...order];
  const pairs: Pair[] = [];
  while (left.length >= 2 && pairs.length < count) {
    const first = left.shift()!;
    const home = continentOf(first);
    const near = pairs.length % 2 === 0;
    let at = -1;
    if (home !== undefined) {
      at = left.findIndex((id) => {
        const other = continentOf(id);
        return other !== undefined && (near ? other === home : other !== home);
      });
    }
    const [second] = left.splice(at < 0 ? 0 : at, 1);
    pairs.push([first, second]);
  }
  return pairs;
}

/** A photo-to-continent lookup from a deck's continent lists. */
export function continentLookup(
  regions: Readonly<Record<string, readonly string[] | undefined>>,
): (id: string) => string | undefined {
  const byId = new Map<string, string>();
  for (const [continent, ids] of Object.entries(regions)) {
    for (const id of ids ?? []) byId.set(id, continent);
  }
  return (id) => byId.get(id);
}

interface Game {
  pairs: readonly Pair[];
  /** The pair on screen. */
  index: number;
  results: readonly PairResult[];
}

export type HowFarState =
  | { phase: "idle" }
  | (Game & { phase: "setting" })
  | (Game & { phase: "answered" })
  | (Game & { phase: "finished" });

export type HowFarAction =
  | { type: "start"; pairs: readonly Pair[] }
  | {
      type: "estimated";
      km: number;
      /** Where the pair's photos were really taken. */
      a: LngLat;
      b: LngLat;
      /** Atlas's guesses for the pair, or null where it has none. */
      atlasA: LngLat | null;
      atlasB: LngLat | null;
    }
  | { type: "next" };

export const initialHowFar: HowFarState = { phase: "idle" };

export function howFarReducer(state: HowFarState, action: HowFarAction): HowFarState {
  switch (action.type) {
    case "start": {
      const game: Game = { pairs: action.pairs, index: 0, results: [] };
      return action.pairs.length === 0
        ? { phase: "finished", ...game }
        : { phase: "setting", ...game };
    }
    case "estimated": {
      if (state.phase !== "setting") return state;
      const actualKm = haversineKm(action.a, action.b);
      const atlas =
        action.atlasA && action.atlasB
          ? judgeEstimate(haversineKm(action.atlasA, action.atlasB), actualKm)
          : null;
      const result: PairResult = { actualKm, you: judgeEstimate(action.km, actualKm), atlas };
      return { ...state, phase: "answered", results: [...state.results, result] };
    }
    case "next": {
      if (state.phase !== "answered") return state;
      const index = state.index + 1;
      return index >= state.pairs.length
        ? { ...state, phase: "finished" }
        : { ...state, phase: "setting", index };
    }
  }
}

/** The game's points so far. */
export function totalPoints(results: readonly PairResult[]): number {
  return results.reduce((sum, r) => sum + r.you.points, 0);
}

/** Atlas's points over the pairs it played, and how many it played. */
export function atlasTotal(results: readonly PairResult[]): { points: number; played: number } {
  let points = 0;
  let played = 0;
  for (const r of results) {
    if (!r.atlas) continue;
    points += r.atlas.points;
    played += 1;
  }
  return { points, played };
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The best game's points this browser has kept, or 0 when none is stored or it can't be read. */
export function loadBestHowFar(): number {
  try {
    const raw = storage()?.getItem(BEST_HOW_FAR_KEY);
    if (!raw) return 0;
    const value: unknown = JSON.parse(raw);
    return typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= PAIRS * PAIR_POINTS
      ? value
      : 0;
  } catch {
    return 0;
  }
}

/**
 * Keep a finished game's `points` if they beat the stored best, and return the best after that.
 * Only a whole game counts, so games are compared on the same number of pairs.
 */
export function rememberHowFar(points: number): number {
  const best = loadBestHowFar();
  if (points <= best) return best;
  try {
    storage()?.setItem(BEST_HOW_FAR_KEY, JSON.stringify(points));
  } catch {
    // Private mode or full storage: the game still counts for this visit.
  }
  return points;
}
