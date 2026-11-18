/**
 * What's on the ground?: one photo and five land covers (built-up, trees, grassland, water, bare
 * ground). The player names what covers the ground around the spot the photo was taken, five
 * photos a game, scored a point a right call against Atlas's own read of the same photos.
 *
 * The truth is the photo's own ESA WorldCover 2021 class (data/labels/concept_labels.csv), the
 * label the reveal's real clues already show as "Mostly … around it". Atlas has no land-cover
 * clue, so its call is `atlasGroundCover` in src/lib/trueClues.ts: a scene clue that names a
 * cover (a city or skyline for built-up, a coast for water), or nothing, which scores it no point
 * on that photo.
 *
 * The catalog is about two-fifths built-up and has few bare-ground photos, so a deck in catalog
 * proportions would make "always built-up" a fair strategy. `dealGround` deals evenly instead:
 * each photo's cover is drawn by a fair die over the covers that still have photos, then a photo
 * from that cover's shuffled pile, so no single answer is worth more than a guess.
 *
 * The rules are a pure reducer, tested without photos. The best game is kept in this browser
 * only, best effort.
 */

import { GROUND_COVERS, isGroundCover, type GroundCover } from "@/lib/trueClues";

import { mulberry32, seededShuffle } from "./daily";

export const BEST_GROUND_KEY = "whereabout:on-the-ground-best";
/** Photos in a game, and so the most a game can score. */
export const GROUND_PHOTOS = 5;

/** Each dealable photo's land cover, by photo id. */
export type GroundMap = Readonly<Record<string, GroundCover>>;

/** Each cover's name on its button and the band. */
export const GROUND_NAME: Record<GroundCover, string> = {
  "Built-up": "Built-up",
  "Tree cover": "Trees",
  Grassland: "Grassland",
  "Permanent water bodies": "Water",
  "Bare / sparse vegetation": "Bare ground",
};

/** Each cover in a few words, from the WorldCover class definitions. */
export const GROUND_GIST: Record<GroundCover, string> = {
  "Built-up": "buildings, roads and paving",
  "Tree cover": "woods and forest",
  Grassland: "grass and herbs, few trees",
  "Permanent water bodies": "sea, lake or river all year",
  "Bare / sparse vegetation": "rock, sand or soil, little growing",
};

/**
 * A game's photos for `seed`: each cover's photos shuffled, then `GROUND_PHOTOS` draws, each from
 * a cover picked by a fair die over the covers with photos left. Pure in the seed. Empty when the
 * map can't fill a game from at least two covers.
 */
export function dealGround(covers: GroundMap, seed: number): string[] {
  const piles = GROUND_COVERS.map((cover, i) =>
    seededShuffle(
      Object.keys(covers).filter((id) => covers[id] === cover),
      (seed + i * 0x9e3779b9) >>> 0,
    ),
  );
  const total = piles.reduce((n, p) => n + p.length, 0);
  if (total < GROUND_PHOTOS || piles.filter((p) => p.length > 0).length < 2) return [];
  const die = mulberry32((seed ^ 0xc2b2ae35) >>> 0);
  const out: string[] = [];
  while (out.length < GROUND_PHOTOS) {
    const open = piles.filter((p) => p.length > 0);
    const pile = open[Math.min(open.length - 1, Math.floor(die() * open.length))];
    out.push(pile.shift()!);
  }
  return out;
}

/** One photo as it was called. */
export interface GroundResult {
  id: string;
  picked: GroundCover;
  truth: GroundCover;
  correct: boolean;
  /** Atlas's read, or null when none of its clues named a cover. */
  atlas: GroundCover | null;
}

interface Game {
  order: readonly string[];
  results: readonly GroundResult[];
}

export type GroundState =
  | { phase: "idle" }
  /** The photo on screen is `order[results.length]`. */
  | (Game & { phase: "picking" })
  /** The answer to `results[results.length - 1]` is shown. */
  | (Game & { phase: "answered" })
  | (Game & { phase: "done" });

export type GroundAction =
  | {
      type: "start";
      order: readonly string[];
      /** Calls already made to pick up from (today's game after a reload): play goes on after them. */
      from?: readonly GroundResult[];
    }
  | { type: "picked"; cover: GroundCover; truth: GroundCover; atlas: GroundCover | null }
  | { type: "next" };

export const initialGround: GroundState = { phase: "idle" };

export function groundReducer(state: GroundState, action: GroundAction): GroundState {
  switch (action.type) {
    case "start": {
      const results = action.from ?? [];
      return results.length >= action.order.length
        ? { phase: "done", order: action.order, results }
        : { phase: "picking", order: action.order, results };
    }
    case "picked": {
      if (state.phase !== "picking") return state;
      const result: GroundResult = {
        id: state.order[state.results.length],
        picked: action.cover,
        truth: action.truth,
        correct: action.cover === action.truth,
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
export function groundTotals(results: readonly GroundResult[]) {
  return {
    right: results.filter((r) => r.correct).length,
    atlasRight: results.filter((r) => r.atlas !== null && r.atlas === r.truth).length,
    atlasRead: results.filter((r) => r.atlas !== null).length,
  };
}

/** The answer in words: "Mostly water around it: sea, lake or river all year." */
export function groundTruthLine(cover: GroundCover): string {
  return `Mostly ${GROUND_NAME[cover].toLowerCase()} around it: ${GROUND_GIST[cover]}.`;
}

/** Atlas's call in words: "Atlas read it as built-up: wrong." */
export function groundAtlasLine(atlas: GroundCover | null, truth: GroundCover): string {
  if (atlas === null) return "Atlas's clues named no ground cover here: no point for it.";
  const name = GROUND_NAME[atlas].toLowerCase();
  return `Atlas read it as ${name}${atlas === truth ? ", and got it." : ": wrong."}`;
}

/** Who took the game: "You beat Atlas 4 to 2." */
export function groundVerdict(right: number, atlasRight: number): string {
  if (right > atlasRight) return `You beat Atlas ${right} to ${atlasRight}.`;
  if (right < atlasRight) return `Atlas wins ${atlasRight} to ${right}.`;
  return `You and Atlas tie on ${right}.`;
}

/** Keep only photos with a cover the game names, from any record-like list. */
export function groundMap(
  photos: readonly { id: string; landCover?: string }[],
): Record<string, GroundCover> {
  return Object.fromEntries(
    photos.flatMap((p) => (isGroundCover(p.landCover) ? [[p.id, p.landCover]] : [])),
  );
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The best game this browser has kept under `key` (the free games', or a practice game's), or 0
 * when none is stored or it can't be read.
 */
export function loadBestGround(key = BEST_GROUND_KEY): number {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return 0;
    const value: unknown = JSON.parse(raw);
    return typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= GROUND_PHOTOS
      ? value
      : 0;
  } catch {
    return 0;
  }
}

/** Keep `right` if it beats the best stored under `key`, and return the best after that. */
export function rememberGround(right: number, key = BEST_GROUND_KEY): number {
  const best = loadBestGround(key);
  if (right <= best) return best;
  try {
    storage()?.setItem(key, JSON.stringify(right));
  } catch {
    // Private mode or full storage: the game still counts for this visit.
  }
  return right;
}
