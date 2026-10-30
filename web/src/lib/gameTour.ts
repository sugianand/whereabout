/**
 * The game in one picture: the summary's globe flies from round to round, drawing each round's
 * arcs as it lands, then pulls back to show all five at once. Everything here is pure (the
 * stops, the camera for the whole game, the arcs drawn so far and the tour's state machine), so
 * `GameTour` only paints what these functions decide.
 */
import type { RoundResult } from "./game/state";
import { haversineKm, type LngLat } from "./geo";
import { revealCamera, revealLines, zoomForSpan, type Actor, type RevealView } from "./reveal";

/** How long the camera takes to fly to the next round. Its arcs draw during the flight. */
export const TOUR_FLY_MS = 1600;
/** How long the globe holds on a round before flying on. */
export const TOUR_HOLD_MS = 1400;
/** How long the pull-back to the whole game takes. */
export const TOUR_FINALE_MS = 1800;
/** The tour never zooms in closer than this, so a bullseye still shows its country. */
export const TOUR_MAX_ZOOM = 4;

export interface TourStop {
  /** The round, from 0. */
  index: number;
  place: string;
  truth: LngLat;
  /** The player's and Atlas's guesses for this photo; a round with no pin has no player guess. */
  view: RevealView;
  /** How far the player's pin was, or null when there was none. */
  playerKm: number | null;
  /** How far Atlas's pin was, or null when Atlas sat the photo out. */
  atlasKm: number | null;
}

/** One stop per round, in the order they were played. */
export function tourStops(results: readonly RoundResult[]): TourStop[] {
  return results.map((r, index) => {
    const truth = { lng: r.reveal.answer.lng, lat: r.reveal.answer.lat };
    const guesses: RevealView["guesses"] = [];
    if (r.pin) guesses.push({ actor: "player", at: { lng: r.pin.lng, lat: r.pin.lat } });
    if (r.atlas) guesses.push({ actor: "atlas", at: { lng: r.atlas.lng, lat: r.atlas.lat } });
    return {
      index,
      place: r.reveal.answer.place,
      truth,
      view: { truth, guesses },
      playerKm: r.reveal.distanceKm,
      atlasKm: r.atlas ? r.atlas.distanceKm : null,
    };
  });
}

/** Where the camera settles on one round: both arcs and the answer in view. */
export function stopCamera(stop: TourStop, framePx: number): { center: LngLat; zoom: number } {
  const camera = revealCamera(stop.view, framePx);
  return { center: camera.center, zoom: Math.min(TOUR_MAX_ZOOM, camera.zoom) };
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/**
 * The camera that shows every answer and pin of the game at once: centred on their mean
 * direction on the sphere (so a game spanning the antimeridian centres on the Pacific, not on
 * Greenwich) and zoomed out to fit the furthest point from that centre, on the same curve as
 * the reveal's camera. Points spread around the whole planet fall back to the whole world.
 */
export function gameCamera(
  stops: readonly TourStop[],
  framePx: number,
): { center: LngLat; zoom: number } {
  const points = stops.flatMap((s) => [s.truth, ...s.view.guesses.map((g) => g.at)]);
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    const phi = toRad(p.lat);
    const lambda = toRad(p.lng);
    x += Math.cos(phi) * Math.cos(lambda);
    y += Math.cos(phi) * Math.sin(lambda);
    z += Math.sin(phi);
  }
  const length = Math.hypot(x, y, z);
  // No points, or points that cancel out (spread evenly round the globe): the whole world.
  if (points.length === 0 || length < 1e-6 * points.length) {
    return { center: { lng: 10, lat: 20 }, zoom: 0 };
  }
  const center = { lng: toDeg(Math.atan2(y, x)), lat: toDeg(Math.asin(z / length)) };
  const radiusKm = Math.max(...points.map((p) => haversineKm(center, p)));
  // Framed like a reveal arc as long as the game's diameter.
  const zoom = zoomForSpan(Math.min(radiusKm * 2, 20000), framePx);
  return { center, zoom: Math.min(TOUR_MAX_ZOOM, zoom) };
}

export interface TourLines {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: { actor: Actor; round: number };
    geometry: { type: "LineString"; coordinates: [number, number][] };
  }[];
}

/**
 * The arcs drawn so far: every round before `visited` in full, except `drawing`, the round
 * the camera is flying to, which is `progress` of the way to its answer.
 */
export function tourLines(
  stops: readonly TourStop[],
  visited: number,
  drawing: number | null = null,
  progress = 1,
): TourLines {
  return {
    type: "FeatureCollection",
    features: stops.slice(0, visited).flatMap((stop) =>
      revealLines(stop.view, stop.index === drawing ? progress : 1).features.map((f) => ({
        ...f,
        properties: { ...f.properties, round: stop.index },
      })),
    ),
  };
}

/** Where the tour is: a round (from 0) or the whole game, how many rounds are drawn, and whether it is moving on by itself. */
export interface TourState {
  at: number | "all";
  visited: number;
  playing: boolean;
}

export type TourAction =
  /** The hold on a round is over: fly to the next, or pull back to the whole game after the last. */
  | { type: "advance" }
  /** The player picked a round, or the whole game: go there and stop the tour. */
  | { type: "show"; at: number | "all" }
  /** Fly through the game again from round one. */
  | { type: "replay" };

/** A tour that starts on round one, or (no autoplay: reduced motion, or back from a replay) on the whole game. */
export function initialTour(rounds: number, autoplay: boolean): TourState {
  return autoplay && rounds > 0
    ? { at: 0, visited: 1, playing: true }
    : { at: "all", visited: rounds, playing: false };
}

export function tourReducer(rounds: number) {
  return (state: TourState, action: TourAction): TourState => {
    switch (action.type) {
      case "advance": {
        if (!state.playing || state.at === "all") return state;
        const next = state.at + 1;
        if (next < rounds)
          return { at: next, visited: Math.max(state.visited, next + 1), playing: true };
        return { at: "all", visited: rounds, playing: false };
      }
      case "show":
        if (action.at !== "all" && (action.at < 0 || action.at >= rounds)) return state;
        // Picking a round shows every arc, so the rest of the game stays in view around it.
        return { at: action.at, visited: rounds, playing: false };
      case "replay":
        return initialTour(rounds, true);
    }
  };
}
