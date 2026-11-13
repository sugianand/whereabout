/**
 * Which climate?: one photo and the five Köppen groups (tropical, arid, temperate, continental,
 * polar). The player names the group the place sits in, five photos a game, scored a point a
 * right call against Atlas's own climate read of the same photos.
 *
 * The truth is the photo's own Köppen-Geiger group (data/labels/concept_labels.csv, Beck et al.
 * 2023), the same label the reveal's real clues show. Atlas's call is `atlasClimateGroup` in
 * src/lib/trueClues.ts, the read the reveal already judges it on: its climate clue, or nothing
 * when it said nothing about the climate, which scores it no point on that photo.
 *
 * The catalog leans temperate and continental and has only a few polar photos, so a deck in
 * catalog proportions would make "always temperate" a fair strategy. `dealClimate` deals evenly
 * instead: each photo's group is drawn by a fair die over the groups that still have photos, then
 * a photo from that group's shuffled pile, so no single answer is worth more than a guess.
 *
 * The rules are a pure reducer, tested without photos. The best game is kept in this browser
 * only, best effort.
 */

import { CLIMATE_GROUPS, isClimateGroup, type ClimateGroup } from "@/lib/trueClues";

import { mulberry32, seededShuffle } from "./daily";

export const BEST_CLIMATE_KEY = "whereabout:which-climate-best";
/** Photos in a game, and so the most a game can score. */
export const CLIMATE_PHOTOS = 5;

/** Each dealable photo's Köppen group, by photo id. */
export type ClimateMap = Readonly<Record<string, ClimateGroup>>;

/** Each group in a few words, from the Köppen definitions, so a player learns what it means. */
export const CLIMATE_GIST: Record<ClimateGroup, string> = {
  Tropical: "hot all year, no winter",
  Arid: "dry: more water evaporates than falls",
  Temperate: "mild winters, warm or hot summers",
  Continental: "cold winters, warm summers",
  Polar: "cold all year, no real summer",
};

/**
 * A game's photos for `seed`: each group's photos shuffled, then `CLIMATE_PHOTOS` draws, each
 * from a group picked by a fair die over the groups with photos left. Pure in the seed. Empty
 * when the map can't fill a game from at least two groups.
 */
export function dealClimate(groups: ClimateMap, seed: number): string[] {
  const piles = CLIMATE_GROUPS.map((group, i) =>
    seededShuffle(
      Object.keys(groups).filter((id) => groups[id] === group),
      (seed + i * 0x9e3779b9) >>> 0,
    ),
  );
  const total = piles.reduce((n, p) => n + p.length, 0);
  if (total < CLIMATE_PHOTOS || piles.filter((p) => p.length > 0).length < 2) return [];
  const die = mulberry32((seed ^ 0x85ebca6b) >>> 0);
  const out: string[] = [];
  while (out.length < CLIMATE_PHOTOS) {
    const open = piles.filter((p) => p.length > 0);
    const pile = open[Math.min(open.length - 1, Math.floor(die() * open.length))];
    out.push(pile.shift()!);
  }
  return out;
}

/** One photo as it was called. */
export interface ClimateResult {
  id: string;
  picked: ClimateGroup;
  truth: ClimateGroup;
  correct: boolean;
  /** Atlas's read, or null when it said nothing about the climate. */
  atlas: ClimateGroup | null;
}

interface Game {
  order: readonly string[];
  results: readonly ClimateResult[];
}

export type ClimateState =
  | { phase: "idle" }
  /** The photo on screen is `order[results.length]`. */
  | (Game & { phase: "picking" })
  /** The answer to `results[results.length - 1]` is shown. */
  | (Game & { phase: "answered" })
  | (Game & { phase: "done" });

export type ClimateAction =
  | { type: "start"; order: readonly string[] }
  | { type: "picked"; group: ClimateGroup; truth: ClimateGroup; atlas: ClimateGroup | null }
  | { type: "next" };

export const initialClimate: ClimateState = { phase: "idle" };

export function climateReducer(state: ClimateState, action: ClimateAction): ClimateState {
  switch (action.type) {
    case "start":
      return action.order.length === 0
        ? { phase: "done", order: [], results: [] }
        : { phase: "picking", order: action.order, results: [] };
    case "picked": {
      if (state.phase !== "picking") return state;
      const id = state.order[state.results.length];
      const result: ClimateResult = {
        id,
        picked: action.group,
        truth: action.truth,
        correct: action.group === action.truth,
        atlas: action.atlas,
      };
      return { ...state, phase: "answered", results: [...state.results, result] };
    }
    case "next": {
      if (state.phase !== "answered") return state;
      return state.results.length >= state.order.length
        ? { ...state, phase: "done" }
        : { ...state, phase: "picking" };
    }
  }
}

/** A game's tally so far: your points, Atlas's, and the photos it gave a read on. */
export function climateTotals(results: readonly ClimateResult[]) {
  return {
    right: results.filter((r) => r.correct).length,
    atlasRight: results.filter((r) => r.atlas !== null && r.atlas === r.truth).length,
    atlasRead: results.filter((r) => r.atlas !== null).length,
  };
}

/** The answer in words: "A tropical climate: hot all year, no winter." */
export function climateTruthLine(group: ClimateGroup): string {
  return `${group === "Arid" ? "An" : "A"} ${group.toLowerCase()} climate: ${CLIMATE_GIST[group]}.`;
}

/** Atlas's call in words: "Atlas read it as arid: wrong." */
export function climateAtlasLine(atlas: ClimateGroup | null, truth: ClimateGroup): string {
  if (atlas === null) return "Atlas said nothing about the climate here: no point for it.";
  return `Atlas read it as ${atlas.toLowerCase()}${atlas === truth ? ", and got it." : ": wrong."}`;
}

/** Who took the game: "You beat Atlas 4 to 2." */
export function climateVerdict(right: number, atlasRight: number): string {
  if (right > atlasRight) return `You beat Atlas ${right} to ${atlasRight}.`;
  if (right < atlasRight) return `Atlas wins ${atlasRight} to ${right}.`;
  return `You and Atlas tie on ${right}.`;
}

/** "18.9° N", "54.8° S": how far from the equator, for the climate band. */
export function latitudeLabel(lat: number): string {
  const deg = Math.abs(lat).toFixed(1);
  return lat === 0 ? "0.0°" : `${deg}° ${lat > 0 ? "N" : "S"}`;
}

/** Keep only photos with a group the game names, from any record-like list. */
export function climateMap(
  photos: readonly { id: string; climateGroup?: string }[],
): Record<string, ClimateGroup> {
  return Object.fromEntries(
    photos.flatMap((p) => (isClimateGroup(p.climateGroup) ? [[p.id, p.climateGroup]] : [])),
  );
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The best game this browser has kept, or 0 when none is stored or it can't be read. */
export function loadBestClimate(): number {
  try {
    const raw = storage()?.getItem(BEST_CLIMATE_KEY);
    if (!raw) return 0;
    const value: unknown = JSON.parse(raw);
    return typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= CLIMATE_PHOTOS
      ? value
      : 0;
  } catch {
    return 0;
  }
}

/** Keep `right` if it beats the stored best, and return the best after that. */
export function rememberClimate(right: number): number {
  const best = loadBestClimate();
  if (right <= best) return best;
  try {
    storage()?.setItem(BEST_CLIMATE_KEY, JSON.stringify(right));
  } catch {
    // Private mode or full storage: the game still counts for this visit.
  }
  return right;
}
