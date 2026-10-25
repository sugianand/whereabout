/**
 * Which country is under a point on the globe, using the same Natural Earth 1:110m shapes the
 * globe draws (world-atlas, see basemap.ts), so a tap lands in the country the player sees.
 *
 * Point in polygon is an even-odd ray cast in lng/lat, holes included (Lesotho is a hole in
 * South Africa). Two kinds of ring need care first. Some cross the antimeridian with a jump from
 * 180° to -180° (mainland Russia, Fiji): those are unwrapped into one continuous ring, which may
 * run past ±180°, and the point is also tested one turn east and west. Antarctica's coast circles
 * the pole and never closes, so its ring is closed along the South Pole.
 */

import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import countries110m from "world-atlas/countries-110m.json";

import { ALPHA2_TO_NUMERIC } from "./countryIds";
import type { LngLat } from "./geo";

type Ring = number[][];
type Shape = {
  /** ISO alpha-2 code. */
  code: string;
  /** Each polygon as its unwrapped rings; the first ring is the outline, the rest are holes. */
  polygons: Ring[][];
  /** Bounds of the unwrapped outlines; longitudes may run past ±180. */
  bbox: [minLng: number, minLat: number, maxLng: number, maxLat: number];
};

/**
 * One continuous ring: every step of more than 180° in longitude is the antimeridian seam, so
 * the rest of the ring is shifted a turn to remove it. A ring that still ends a turn away from
 * where it began goes round a pole, and is closed along that pole.
 */
export function unwrapRing(ring: Ring): Ring {
  const out: Ring = [];
  let shift = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lng, lat] = ring[i];
    if (i > 0) {
      const step = lng + shift - out[i - 1][0];
      if (step > 180) shift -= 360;
      else if (step < -180) shift += 360;
    }
    out.push([lng + shift, lat]);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first && Math.abs(last[0] - first[0]) >= 180) {
    const pole = out.reduce((sum, [, lat]) => sum + lat, 0) < 0 ? -90 : 90;
    out.push([last[0], pole], [first[0], pole], first);
  }
  return out;
}

let shapes: Shape[] | null = null;

const NUMERIC_TO_ALPHA2: ReadonlyMap<string, string> = new Map(
  Object.entries(ALPHA2_TO_NUMERIC).map(([alpha2, numeric]) => [numeric, alpha2]),
);

/** The alpha-2 code for a topology id ("250" → "FR"), or undefined. */
export function alpha2ForNumeric(numeric: string): string | undefined {
  return NUMERIC_TO_ALPHA2.get(numeric);
}

function loadShapes(): Shape[] {
  if (shapes) return shapes;
  const topology = countries110m as unknown as Topology<{ countries: GeometryCollection }>;
  shapes = feature(topology, topology.objects.countries).features.flatMap((f) => {
    // A few disputed areas carry no id and so no code: they can't be the answer to a photo.
    const code = f.id === undefined ? undefined : alpha2ForNumeric(String(f.id));
    const g = f.geometry;
    if (!code || !g) return [];
    const raw =
      g.type === "Polygon"
        ? [g.coordinates as Ring[]]
        : g.type === "MultiPolygon"
          ? (g.coordinates as Ring[][])
          : [];
    const polygons = raw.map((rings) => rings.map(unwrapRing));
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    for (const polygon of polygons) {
      for (const [lng, lat] of polygon[0]) {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      }
    }
    return [{ code, polygons, bbox: [minLng, minLat, maxLng, maxLat] }];
  });
  return shapes;
}

/** Even-odd test over all of a polygon's rings, so a point inside a hole is outside. */
function inPolygon(lng: number, lat: number, rings: Ring[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** The ISO alpha-2 code of the country drawn at `at`, or null over the sea. */
export function countryAt(at: LngLat): string | null {
  const { lat } = at;
  const lng = ((((at.lng + 180) % 360) + 360) % 360) - 180;
  for (const shape of loadShapes()) {
    const [minLng, minLat, maxLng, maxLat] = shape.bbox;
    if (lat < minLat || lat > maxLat) continue;
    for (const x of [lng, lng - 360, lng + 360]) {
      if (x < minLng || x > maxLng) continue;
      if (shape.polygons.some((rings) => inPolygon(x, lat, rings))) return shape.code;
    }
  }
  return null;
}

/** Every country the globe draws and a tap can pick, as alpha-2 codes. */
export function tappableCountries(): ReadonlySet<string> {
  return new Set(loadShapes().map((s) => s.code));
}
