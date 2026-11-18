/**
 * The World Tour drawn on the globe: a stop on each continent of the route, joined in route order
 * by great-circle arcs. The stops are fixed points near the middle of each continent, chosen for
 * the drawing alone; they are never a photo's location, so the tour page gives nothing away.
 */

import type { Continent } from "@/lib/continents";
import { greatCirclePath, type LngLat } from "@/lib/geo";
import { nextStop, type TourRecord } from "@/lib/tour";

/** Where each continent's stop sits on the globe. */
export const TOUR_STOPS: Readonly<Record<Continent, LngLat>> = {
  Europe: { lng: 15, lat: 50 },
  Africa: { lng: 20, lat: 5 },
  Asia: { lng: 95, lat: 35 },
  Oceania: { lng: 140, lat: -25 },
  "South America": { lng: -60, lat: -15 },
  "North America": { lng: -100, lat: 45 },
  Antarctica: { lng: 0, lat: -80 },
};

/** A stop is cleared, the next one to play, or still ahead. */
export type StopState = "cleared" | "next" | "ahead";

/**
 * An arc is flown once both its ends are cleared, the next one when it leads into the next stop,
 * and ahead otherwise.
 */
export type ArcState = "flown" | "next" | "ahead";

export interface StopFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { continent: Continent; leg: number; state: StopState };
}

export interface ArcFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: [number, number][] };
  properties: { from: Continent; to: Continent; state: ArcState };
}

export interface TourMap {
  stops: { type: "FeatureCollection"; features: StopFeature[] };
  arcs: { type: "FeatureCollection"; features: ArcFeature[] };
  /** Where the globe flies on load: the next stop, or null once the tour is complete. */
  focus: LngLat | null;
}

/** Points along each arc; enough for a smooth curve across an ocean on the whole globe. */
export const ARC_SEGMENTS = 48;

export function stopState(
  continent: Continent,
  record: TourRecord,
  next: Continent | null,
): StopState {
  if (record[continent]?.cleared) return "cleared";
  return continent === next ? "next" : "ahead";
}

/** The route's stops and arcs as GeoJSON, each with its state, for the globe's layers. */
export function tourMap(route: readonly Continent[], record: TourRecord): TourMap {
  const next = nextStop(route, record);
  const stops: StopFeature[] = route.map((continent, i) => {
    const { lng, lat } = TOUR_STOPS[continent];
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { continent, leg: i + 1, state: stopState(continent, record, next) },
    };
  });
  const arcs: ArcFeature[] = route.slice(1).map((to, i) => {
    const from = route[i];
    const bothCleared = Boolean(record[from]?.cleared && record[to]?.cleared);
    const state: ArcState = bothCleared ? "flown" : to === next ? "next" : "ahead";
    return {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: greatCirclePath(TOUR_STOPS[from], TOUR_STOPS[to], ARC_SEGMENTS),
      },
      properties: { from, to, state },
    };
  });
  return {
    stops: { type: "FeatureCollection", features: stops },
    arcs: { type: "FeatureCollection", features: arcs },
    focus: next ? TOUR_STOPS[next] : null,
  };
}
