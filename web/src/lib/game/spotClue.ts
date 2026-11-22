/**
 * Spot the clue: the square of the photo Atlas saw, Atlas's pick of country, and one question:
 * which part of the photo told it most? The player picks one square of the same grid Atlas's
 * "where Atlas looked" map is measured on, and scores by how much that square mattered to Atlas.
 *
 * The map is real occlusion saliency (ml/src/whereabout_ml/saliency.py, docs/decisions/0003):
 * each cell is how much greying that patch out lowered Atlas's probability for the country it
 * picked, scaled so the cell that mattered most is 1. A square scores `SPOT_MAX` times its value
 * over the map's largest, so the hottest square is always worth the full 1,000 and a square
 * Atlas never needed scores nothing. The game is about reading the model, not the place: Atlas
 * may have picked the wrong country, and the photo still shows what led it there.
 *
 * Only photos whose map is well-formed and has a cell above zero are dealt (`spotIds`, read at
 * build time in bundled.ts), so every photo has a square worth finding. The rules are a pure
 * reducer, tested without photos; the best game is kept in this browser only, best effort.
 */

import { describeHotspot, isValidLooked } from "@/lib/looked";

import { seededShuffle } from "./daily";
import type { GameRecord } from "./deck";
import type { AtlasLooked } from "./types";

export const SPOT_PHOTOS = 5;
/** What the square that mattered most to Atlas is worth. */
export const SPOT_MAX = 1000;
export const BEST_SPOT_KEY = "whereabout:spot-the-clue-best";

/** True when Atlas's map can be played: well-formed, with at least one cell that mattered. */
export function playableLooked(looked: AtlasLooked | undefined | null): looked is AtlasLooked {
  return !!looked && isValidLooked(looked) && Math.max(...looked.cells) > 0;
}

/** The photos Spot the clue can deal, in catalog order: those with a playable map. */
export function spotIds(records: readonly GameRecord[]): string[] {
  return records.filter((r) => playableLooked(r.atlas?.looked)).map((r) => r.photo.id);
}

/** A game's photos for `seed`: up to five, shuffled from the playable ones. */
export function dealSpot(ids: readonly string[], seed: number): string[] {
  return seededShuffle(ids, seed).slice(0, SPOT_PHOTOS);
}

/** The square under a point given as fractions (0..1) across and down the square Atlas saw. */
export function cellAt(grid: number, x: number, y: number): number {
  const clamp = (v: number) => Math.min(grid - 1, Math.max(0, Math.floor(v * grid)));
  return clamp(y) * grid + clamp(x);
}

/** The square the arrow keys move to from `cell`, held at the grid's edges. */
export function stepCell(
  grid: number,
  cell: number,
  key: "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown",
): number {
  const row = Math.floor(cell / grid);
  const col = cell % grid;
  switch (key) {
    case "ArrowLeft":
      return row * grid + Math.max(0, col - 1);
    case "ArrowRight":
      return row * grid + Math.min(grid - 1, col + 1);
    case "ArrowUp":
      return Math.max(0, row - 1) * grid + col;
    case "ArrowDown":
      return Math.min(grid - 1, row + 1) * grid + col;
  }
}

/** The middle square, where the cursor starts. */
export function middleCell(grid: number): number {
  const mid = Math.floor(grid / 2);
  return mid * grid + mid;
}

/** The square or squares that mattered most to Atlas. */
export function hottestCells(looked: AtlasLooked): number[] {
  const top = Math.max(...looked.cells);
  return looked.cells.flatMap((v, i) => (v === top && top > 0 ? [i] : []));
}

/** A square's points: `SPOT_MAX` times its value over the map's largest, rounded. */
export function spotPoints(looked: AtlasLooked, cell: number): number {
  const top = Math.max(...looked.cells);
  const v = looked.cells[cell] ?? 0;
  return top > 0 ? Math.round((SPOT_MAX * v) / top) : 0;
}

/** How one photo came out. */
export interface SpotResult {
  id: string;
  cell: number;
  points: number;
  /** True when the square picked is one of those that mattered most. */
  hottest: boolean;
}

/** The result of picking `cell` on a photo whose map is `looked`. */
export function spotResult(id: string, looked: AtlasLooked, cell: number): SpotResult {
  return {
    id,
    cell,
    points: spotPoints(looked, cell),
    hottest: hottestCells(looked).includes(cell),
  };
}

export type SpotState =
  | { phase: "idle" }
  | { phase: "picking"; order: readonly string[]; results: readonly SpotResult[] }
  | { phase: "answered"; order: readonly string[]; results: readonly SpotResult[] }
  | { phase: "done"; order: readonly string[]; results: readonly SpotResult[] };

export type SpotAction =
  /** `from` picks up a game already under way, at the first photo it hasn't picked a square on. */
  | { type: "start"; order: readonly string[]; from?: readonly SpotResult[] }
  | { type: "picked"; result: SpotResult }
  | { type: "next" };

export const initialSpot: SpotState = { phase: "idle" };

export function spotReducer(state: SpotState, action: SpotAction): SpotState {
  switch (action.type) {
    case "start": {
      const { order } = action;
      const results = action.from ?? [];
      return results.length >= order.length
        ? { phase: "done", order, results }
        : { phase: "picking", order, results };
    }
    case "picked":
      if (state.phase !== "picking" || action.result.id !== state.order[state.results.length]) {
        return state;
      }
      return { ...state, phase: "answered", results: [...state.results, action.result] };
    case "next":
      if (state.phase !== "answered") return state;
      return state.results.length >= state.order.length
        ? { ...state, phase: "done" }
        : { ...state, phase: "picking" };
  }
}

/** A game's points and how many of its squares were the hottest. */
export function spotTotals(results: readonly SpotResult[]): { points: number; hottest: number } {
  return {
    points: results.reduce((sum, r) => sum + r.points, 0),
    hottest: results.filter((r) => r.hottest).length,
  };
}

/** The answer card's headline for a square's points. */
export function spotVerdict(result: SpotResult): string {
  if (result.hottest) return "Spot on";
  if (result.points >= 500) return "Warm";
  if (result.points > 0) return "Cool";
  return "Cold";
}

/** Where most of Atlas's map sits, in words: "Atlas's clue sits mostly toward the top left of the square." */
export function hottestLine(looked: AtlasLooked): string {
  const where = describeHotspot(looked);
  return where
    ? `Atlas's clue sits mostly toward ${where} of the square.`
    : "No single part of the photo stood out to Atlas.";
}

/** "Row 2, column 5": a square's place on the grid, counted from the top left. */
export function cellName(grid: number, cell: number): string {
  return `Row ${Math.floor(cell / grid) + 1}, column ${(cell % grid) + 1}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The best whole game this browser has kept, or 0 when none is stored or it can't be read. */
export function loadBestSpot(): number {
  try {
    const raw = storage()?.getItem(BEST_SPOT_KEY);
    if (!raw) return 0;
    const value: unknown = JSON.parse(raw);
    return typeof value === "number" &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= SPOT_MAX * SPOT_PHOTOS
      ? value
      : 0;
  } catch {
    return 0;
  }
}

/** Keep `points` if it beats the stored best, and return the best after that. */
export function rememberSpot(points: number): number {
  const best = loadBestSpot();
  if (points <= best) return best;
  try {
    storage()?.setItem(BEST_SPOT_KEY, JSON.stringify(points));
  } catch {
    // Private mode or full storage: the game still counts for this visit.
  }
  return points;
}
