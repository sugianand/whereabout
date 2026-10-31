/**
 * Which way?: one photo is where you stand and the other is where you're headed. Pick the
 * compass direction (one of eight points) you'd set off in to get from the first to the second.
 *
 * The direction is the great-circle starting bearing, the heading a plane leaves on along the
 * shortest route, so a hop from Tokyo to New York starts out north-east, not east. A right pick
 * makes the run a journey: where you were headed becomes where you stand, and a new photo is
 * dealt as the next stop. The run ends on the first wrong pick, or when every photo is played.
 *
 * Each point covers 45° of heading. A bearing within `EDGE_DEGREES` of the line between two
 * points is too close to call from a photo, so either neighbour counts. Atlas plays along: its
 * pick is the point nearest the bearing between its own two guesses, judged by the same rule.
 *
 * Two photos closer than `MIN_KM` (one city) or further than `MAX_KM` (nearly opposite sides of
 * the planet, where every heading is almost as short) make no fair question, so the next stop is
 * dealt again (`unfitPair`). The rules are a pure reducer so they can be tested without photos.
 * The best run is kept in this browser only, best effort.
 */

import { haversineKm, type LngLat } from "@/lib/geo";

/** The eight points, clockwise from north. A point's index times 45 is its heading. */
export const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Point = (typeof POINTS)[number];

export const POINT_NAMES: Record<Point, string> = {
  N: "north",
  NE: "north-east",
  E: "east",
  SE: "south-east",
  S: "south",
  SW: "south-west",
  W: "west",
  NW: "north-west",
};

/** Keys on a number pad's layout (8 up, 2 down), which also work on the number row. */
export const POINT_KEYS: Record<Point, string> = {
  N: "8",
  NE: "9",
  E: "6",
  SE: "3",
  S: "2",
  SW: "1",
  W: "4",
  NW: "7",
};

/** Each point's half-width: a heading within this of a point is that point. */
export const HALF_SECTOR = 22.5;
/** A heading this close to the line between two points counts for either. */
export const EDGE_DEGREES = 5;
/** Closer than this, two photos are one place: no fair heading. */
export const MIN_KM = 150;
/** Further than this, the two photos are nearly antipodal and every heading is about as short. */
export const MAX_KM = 19_000;

export const BEST_WAY_KEY = "whereabout:which-way-best";

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** The great-circle starting bearing from `a` to `b`, in degrees clockwise from north, [0, 360). */
export function initialBearing(a: LngLat, b: LngLat): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dLambda = toRad(b.lng - a.lng);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const deg = (toDeg(Math.atan2(y, x)) + 360) % 360;
  // Rounding can land exactly on 360.
  return deg >= 360 ? 0 : deg;
}

/** The heading a point stands for: N is 0°, E is 90°. */
export function pointHeading(point: Point): number {
  return POINTS.indexOf(point) * 45;
}

/** The point nearest a bearing. A bearing exactly between two goes clockwise. */
export function pointOf(bearing: number): Point {
  const b = ((bearing % 360) + 360) % 360;
  return POINTS[Math.floor((b + HALF_SECTOR) / 45) % 8];
}

/** How many degrees apart two headings are, the short way round: 0 to 180. */
export function headingGap(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** True when two photos make no fair question: one place, or nearly opposite sides of the world. */
export function unfitPair(a: LngLat, b: LngLat): boolean {
  const km = haversineKm(a, b);
  return km < MIN_KM || km > MAX_KM;
}

/** How one stop came out. */
export interface WayVerdict {
  picked: Point;
  /** The point nearest the true bearing. */
  truth: Point;
  /** The great-circle starting bearing from the first photo to the second. */
  bearing: number;
  /** True when the pick is a neighbour of the truth but the bearing is within `EDGE_DEGREES` of their line. */
  edge: boolean;
  correct: boolean;
}

/** Judges `picked` against the true `bearing`. */
export function judgeWay(picked: Point, bearing: number): WayVerdict {
  const truth = pointOf(bearing);
  const gap = headingGap(bearing, pointHeading(picked));
  const correct = gap <= HALF_SECTOR + EDGE_DEGREES;
  return { picked, truth, bearing, edge: correct && picked !== truth, correct };
}

/** "47°", always a whole number of degrees from 0° to 359°. */
export function formatBearing(bearing: number): string {
  return `${Math.round(bearing) % 360}°`;
}

interface Run {
  order: readonly string[];
  /** You stand at `order[index]`, headed for `order[index + 1]`. */
  index: number;
  /** Right picks in a row this run. */
  streak: number;
  /** Stops Atlas would have got right, and stops it played (both photos guessed apart). */
  atlasRight: number;
  atlasPlayed: number;
}

export type WayState =
  | { phase: "idle" }
  | (Run & { phase: "picking" })
  | (Run & {
      /** The stop's route is shown. A wrong pick ends the run; a right one travels on. */
      phase: "answered";
      verdict: WayVerdict;
      /** Distance from the first photo to the second, in kilometres. */
      km: number;
      /** Atlas's verdict on the same stop, or null when it has no fair pair of guesses. */
      atlas: WayVerdict | null;
    })
  | (Run & {
      /** Every photo played without a wrong pick. */
      phase: "cleared";
    });

export type WayAction =
  | { type: "start"; order: readonly string[] }
  | {
      type: "picked";
      point: Point;
      /** The two photos' true places: where you stand, and where you're headed. */
      from: LngLat;
      to: LngLat;
      /** Atlas's guesses for the two photos, or null where it has none. */
      atlasFrom: LngLat | null;
      atlasTo: LngLat | null;
    }
  /** The stop dealt (`id`) makes no fair question with where you stand: deal another. */
  | { type: "redeal"; id: string }
  | { type: "next" };

export const initialWay: WayState = { phase: "idle" };

const blankRun = (order: readonly string[]): Run => ({
  order,
  index: 0,
  streak: 0,
  atlasRight: 0,
  atlasPlayed: 0,
});

/** Atlas's pick: the point nearest the bearing between its guesses, or null when they're one place. */
export function atlasPoint(from: LngLat | null, to: LngLat | null): Point | null {
  if (!from || !to || haversineKm(from, to) < 1) return null;
  return pointOf(initialBearing(from, to));
}

export function wayReducer(state: WayState, action: WayAction): WayState {
  switch (action.type) {
    case "start": {
      const run = blankRun(action.order);
      return action.order.length < 2 ? { phase: "cleared", ...run } : { phase: "picking", ...run };
    }
    case "redeal": {
      if (state.phase !== "picking" || state.order[state.index + 1] !== action.id) return state;
      const order = state.order.filter((_, i) => i !== state.index + 1);
      return state.index + 1 >= order.length
        ? { ...state, order, phase: "cleared" }
        : { ...state, order };
    }
    case "picked": {
      if (state.phase !== "picking") return state;
      const bearing = initialBearing(action.from, action.to);
      const verdict = judgeWay(action.point, bearing);
      const atlasPick = atlasPoint(action.atlasFrom, action.atlasTo);
      const atlas = atlasPick === null ? null : judgeWay(atlasPick, bearing);
      return {
        ...state,
        phase: "answered",
        streak: state.streak + (verdict.correct ? 1 : 0),
        atlasRight: state.atlasRight + (atlas?.correct ? 1 : 0),
        atlasPlayed: state.atlasPlayed + (atlas ? 1 : 0),
        verdict,
        km: haversineKm(action.from, action.to),
        atlas,
      };
    }
    case "next": {
      // A wrong pick ends the run; only a new "start" plays on.
      if (state.phase !== "answered" || !state.verdict.correct) return state;
      const { order, streak, atlasRight, atlasPlayed } = state;
      const index = state.index + 1;
      const run = { order, index, streak, atlasRight, atlasPlayed };
      return index + 1 >= order.length
        ? { phase: "cleared", ...run }
        : { phase: "picking", ...run };
    }
  }
}

/** True once the run has ended, by a wrong pick or by playing every photo. */
export function wayOver(state: WayState): boolean {
  return state.phase === "cleared" || (state.phase === "answered" && !state.verdict.correct);
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The best run this browser has kept, or 0 when none is stored or it can't be read. */
export function loadBestWay(): number {
  try {
    const raw = storage()?.getItem(BEST_WAY_KEY);
    if (!raw) return 0;
    const value: unknown = JSON.parse(raw);
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** Keep `streak` if it beats the stored best, and return the best after that. */
export function rememberWay(streak: number): number {
  const best = loadBestWay();
  if (streak <= best) return best;
  try {
    storage()?.setItem(BEST_WAY_KEY, JSON.stringify(streak));
  } catch {
    // Private mode or full storage: the run still counts for this visit.
  }
  return streak;
}

/**
 * The heading of the straight line between the two photos on a flat world map (longitude
 * across, latitude up, the short way round in longitude). Where its point differs from the
 * great-circle one, the reveal says so: that gap is what the round teaches.
 */
export function flatBearing(a: LngLat, b: LngLat): number {
  let dLng = b.lng - a.lng;
  if (dLng > 180) dLng -= 360;
  if (dLng < -180) dLng += 360;
  const deg = (toDeg(Math.atan2(dLng, b.lat - a.lat)) + 360) % 360;
  return deg >= 360 ? 0 : deg;
}
