/**
 * Line them up: four photos to put in order from west to east, as on a flat world map that starts
 * at the date line. Five rows a game, a point for each photo standing in its place.
 *
 * A row is dealt from different continents wherever it can (`dealRows`), so most rows are worth
 * thinking about rather than four photos from one country. Two photos can still land nearly due
 * north and south of each other, and no photo settles a difference that small: longitudes within
 * `TIE_DEGREES` count as level, so a place is judged by the longitude standing there, not by which
 * photo it is (`inPlace`).
 *
 * Atlas plays along from its own guesses: it sorts the four pins it dropped, and that order is
 * scored by the same rule against the same truth. A row with a photo Atlas never guessed sits it
 * out.
 *
 * The rules live here as a pure reducer so they can be tested without photos. The best game is
 * kept in this browser only, best effort.
 */

import { CONTINENTS } from "@/lib/continents";

import { seededShuffle } from "./daily";
import type { Regions } from "./regions";

export const BEST_LINE_KEY = "whereabout:line-up-best";
/** Photos in a row. */
export const ROW = 4;
/** Rows in a game. */
export const ROWS = 5;
/** Longitudes closer than this, about 220 km at the Equator, are level. */
export const TIE_DEGREES = 2;

/**
 * Up to `count` rows of `ROW` different photos: one from each of four continents where there are
 * four with photos left, topped up from whichever continents still have some.
 */
export function dealRows(
  regions: Regions,
  random: () => number = Math.random,
  count = ROWS,
): string[][] {
  const seed = () => Math.floor(random() * 2 ** 32);
  const left = CONTINENTS.map((c) => seededShuffle(regions[c] ?? [], seed())).filter(
    (ids) => ids.length > 0,
  );
  const rows: string[][] = [];
  while (rows.length < count && left.reduce((n, ids) => n + ids.length, 0) >= ROW) {
    const row: string[] = [];
    while (row.length < ROW) {
      for (const ids of seededShuffle(left, seed())) {
        if (row.length < ROW && ids.length > 0) row.push(ids.pop()!);
      }
    }
    rows.push(row);
  }
  return rows;
}

/** Where one photo of a row really is, and where Atlas put it (null when it never guessed). */
export interface Spot {
  lng: number;
  atlasLng: number | null;
}

export type Spots = Readonly<Record<string, Spot>>;

/** `ids` sorted west to east by `lngOf`, ties by id so the order never depends on the input's. */
function sortedBy(ids: readonly string[], lngOf: (id: string) => number): string[] {
  return [...ids].sort((a, b) => lngOf(a) - lngOf(b) || (a < b ? -1 : 1));
}

/** The row in its true order, west to east. */
export function eastward(ids: readonly string[], spots: Spots): string[] {
  return sortedBy(ids, (id) => spots[id].lng);
}

/** For each place in `order`, whether the photo there is level with the truth at that place. */
export function inPlace(order: readonly string[], spots: Spots): boolean[] {
  const east = eastward(order, spots);
  return order.map((id, i) => Math.abs(spots[id].lng - spots[east[i]].lng) < TIE_DEGREES);
}

function countTrue(flags: readonly boolean[]): number {
  return flags.filter(Boolean).length;
}

/** `ids` moved on until they are not already right, so a row is never won by leaving it alone. */
export function unsorted(ids: readonly string[], spots: Spots): string[] {
  let order = [...ids];
  for (let turn = 1; turn < ids.length && countTrue(inPlace(order, spots)) === ids.length; turn++) {
    order = [...ids.slice(turn), ...ids.slice(0, turn)];
  }
  return order;
}

/** Atlas's order from its own pins, or null when it hasn't guessed every photo of the row. */
export function atlasOrder(ids: readonly string[], spots: Spots): string[] | null {
  if (ids.some((id) => spots[id].atlasLng === null)) return null;
  return sortedBy(ids, (id) => spots[id].atlasLng!);
}

/** How one row came out. */
export interface RowResult {
  /** The row as the player locked it, west to east. */
  order: readonly string[];
  /** The row in its true order. */
  east: readonly string[];
  /** Whether each place of `order` was right. */
  right: readonly boolean[];
  points: number;
  /** Atlas's order and points, or null when it sat the row out. */
  atlas: { order: readonly string[]; points: number } | null;
}

export function judgeRow(order: readonly string[], spots: Spots): RowResult {
  const right = inPlace(order, spots);
  const atlas = atlasOrder(order, spots);
  return {
    order,
    east: eastward(order, spots),
    right,
    points: countTrue(right),
    atlas: atlas && { order: atlas, points: countTrue(inPlace(atlas, spots)) },
  };
}

interface Game {
  rows: readonly (readonly string[])[];
  index: number;
  results: readonly RowResult[];
}

export type LineState =
  | { phase: "idle" }
  /** Nothing to deal. */
  | { phase: "none" }
  /** A row on screen; `spots` is null until its photos have loaded. */
  | (Game & { phase: "placing"; order: readonly string[]; spots: Spots | null })
  | (Game & { phase: "revealed"; order: readonly string[]; spots: Spots; result: RowResult })
  | (Game & { phase: "finished" });

export type LineAction =
  /** `results` picks a game up after the rows already locked (today's game, after a reload). */
  | { type: "start"; rows: readonly (readonly string[])[]; results?: readonly RowResult[] }
  | { type: "ready"; spots: Spots }
  /** Swap the photos at two places. */
  | { type: "swap"; a: number; b: number }
  /** Lift the photo at one place into another, closing the gap. */
  | { type: "move"; from: number; to: number }
  | { type: "lock" }
  | { type: "next" };

export const initialLine: LineState = { phase: "idle" };

function deal(game: Game): LineState {
  return { ...game, phase: "placing", order: game.rows[game.index], spots: null };
}

export function lineReducer(state: LineState, action: LineAction): LineState {
  switch (action.type) {
    case "start": {
      const { rows, results = [] } = action;
      if (rows.length === 0) return { phase: "none" };
      if (results.length >= rows.length) {
        return { rows, results, index: rows.length - 1, phase: "finished" };
      }
      return deal({ rows, index: results.length, results });
    }
    case "ready":
      if (state.phase !== "placing" || state.spots) return state;
      return { ...state, spots: action.spots, order: unsorted(state.order, action.spots) };
    case "swap": {
      if (state.phase !== "placing" || !state.spots) return state;
      const order = [...state.order];
      [order[action.a], order[action.b]] = [order[action.b], order[action.a]];
      return { ...state, order };
    }
    case "move": {
      if (state.phase !== "placing" || !state.spots) return state;
      const order = [...state.order];
      const [lifted] = order.splice(action.from, 1);
      order.splice(action.to, 0, lifted);
      return { ...state, order };
    }
    case "lock": {
      if (state.phase !== "placing" || !state.spots) return state;
      const result = judgeRow(state.order, state.spots);
      return {
        ...state,
        phase: "revealed",
        spots: state.spots,
        result,
        results: [...state.results, result],
      };
    }
    case "next": {
      if (state.phase !== "revealed") return state;
      const game = { rows: state.rows, index: state.index + 1, results: state.results };
      return game.index >= game.rows.length
        ? { ...game, index: state.index, phase: "finished" }
        : deal(game);
    }
  }
}

/** The player's points over `results`. */
export function linePoints(results: readonly RowResult[]): number {
  return results.reduce((sum, r) => sum + r.points, 0);
}

/** Atlas's points, and the rows it played. */
export function atlasLinePoints(results: readonly RowResult[]): { points: number; rows: number } {
  const played = results.flatMap((r) => (r.atlas ? [r.atlas.points] : []));
  return { points: played.reduce((sum, p) => sum + p, 0), rows: played.length };
}

/** "139° E", "74° W", "0°" on the prime meridian. */
export function formatLongitude(lng: number): string {
  const rounded = Math.round(Math.abs(lng));
  return rounded === 0 ? "0°" : `${rounded}° ${lng < 0 ? "W" : "E"}`;
}

/** Of the slots a tile could be dropped on, the one whose centre is nearest to the point. */
export function nearestPlace(
  x: number,
  y: number,
  centres: readonly { x: number; y: number }[],
): number {
  let nearest = 0;
  let distance = Infinity;
  centres.forEach((c, i) => {
    const d = (c.x - x) ** 2 + (c.y - y) ** 2;
    if (d < distance) {
      nearest = i;
      distance = d;
    }
  });
  return nearest;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The best game this browser has kept, or 0 when none is stored or it can't be read. */
export function loadBestLine(): number {
  try {
    const raw = storage()?.getItem(BEST_LINE_KEY);
    if (!raw) return 0;
    const value: unknown = JSON.parse(raw);
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** Keep `points` if it beats the stored best, and return the best after that. */
export function rememberLine(points: number): number {
  const best = loadBestLine();
  if (points <= best) return best;
  try {
    storage()?.setItem(BEST_LINE_KEY, JSON.stringify(points));
  } catch {
    // Private mode or full storage: the game still counts for this visit.
  }
  return points;
}
