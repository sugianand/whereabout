import { KM_PER_MILE, type Units } from "./units";

/** A point on the globe in degrees. Longitude first, matching MapLibre and GeoJSON. */
export type LngLat = { lng: number; lat: number };

export type Direction = "north" | "south" | "east" | "west";

/** Wrap a longitude into [-180, 180). */
export function wrapLng(lng: number): number {
  // Leave in-range values untouched so the modulo arithmetic adds no rounding error.
  if (lng >= -180 && lng < 180) return lng === 0 ? 0 : lng;
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
  // -0 reads oddly in coordinates and fails Object.is checks.
  return wrapped === 0 ? 0 : wrapped;
}

/** Clamp a latitude into [-90, 90]. */
export function clampLat(lat: number): number {
  return Math.min(90, Math.max(-90, lat));
}

export function normalize(point: LngLat): LngLat {
  return { lng: wrapLng(point.lng), lat: clampLat(point.lat) };
}

/**
 * Move a pin a fixed number of degrees in one compass direction. Used for keyboard play:
 * east/west wrap around the antimeridian, north/south stop at the poles.
 */
export function nudge(point: LngLat, direction: Direction, stepDegrees: number): LngLat {
  const { lng, lat } = point;
  switch (direction) {
    case "north":
      return normalize({ lng, lat: lat + stepDegrees });
    case "south":
      return normalize({ lng, lat: lat - stepDegrees });
    case "east":
      return normalize({ lng: lng + stepDegrees, lat });
    case "west":
      return normalize({ lng: lng - stepDegrees, lat });
  }
}

/** Human-readable coordinates, e.g. "48.86° N, 2.35° E". */
export function formatLngLat(point: LngLat, decimals = 2): string {
  const { lng, lat } = normalize(point);
  const latText = `${Math.abs(lat).toFixed(decimals)}° ${lat < 0 ? "S" : "N"}`;
  const lngText = `${Math.abs(lng).toFixed(decimals)}° ${lng < 0 ? "W" : "E"}`;
  return `${latText}, ${lngText}`;
}

// Scoring constants. These must match api/src/whereabout_api/geo.py; both test suites check
// against data/fixtures/geo_cases.json so a distance means the same thing in both places.
export const EARTH_RADIUS_KM = 6371.0088;
export const MAX_POINTS = 5000;
export const SCORE_SCALE_KM = 1500;
/** A round's maximum after 0, 1, 2 or 3 hints (data/fixtures/hint_cases.json). */
export const MAX_POINTS_BY_HINTS = [5000, 4000, 3000, 2000] as const;
export const MAX_HINTS = MAX_POINTS_BY_HINTS.length - 1;

/** The most a round can score after `hints` hints. */
export function maxPoints(hints = 0): number {
  if (!Number.isInteger(hints) || hints < 0 || hints > MAX_HINTS) {
    throw new RangeError(`hints must be a whole number from 0 to ${MAX_HINTS}`);
  }
  return MAX_POINTS_BY_HINTS[hints];
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in kilometres (haversine formula). */
export function haversineKm(a: LngLat, b: LngLat): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dPhi = phi2 - phi1;
  const dLambda = toRad(b.lng - a.lng);
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  // Clamp: floating-point drift can push h just past 1 for antipodal points.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

/**
 * Points for a guess `distanceKm` from the truth: 5000 at 0 km, decaying exponentially. Each
 * hint taken scales the whole curve down (`maxPoints`).
 */
export function scoreDistance(distanceKm: number, hints = 0): number {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    throw new RangeError("distance must be a non-negative finite number");
  }
  return roundHalfEven(maxPoints(hints) * Math.exp(-distanceKm / SCORE_SCALE_KM));
}

/** Python's round(): halves go to the even neighbour. Keeps scores identical to the API. */
function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Points along the shortest path between two locations, for drawing the line between a guess
 * and the truth. Longitudes are unwrapped (they may run past ±180) so the line crosses the
 * antimeridian instead of jumping the long way round the map.
 */
export function greatCirclePath(a: LngLat, b: LngLat, segments = 64): [number, number][] {
  const phi1 = toRad(a.lat);
  const lambda1 = toRad(a.lng);
  const phi2 = toRad(b.lat);
  const lambda2 = toRad(b.lng);
  const delta = haversineKm(a, b) / EARTH_RADIUS_KM;
  if (delta < 1e-9)
    return [
      [a.lng, a.lat],
      [b.lng, b.lat],
    ];

  const points: [number, number][] = [];
  let previousLng: number | null = null;
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    // Spherical linear interpolation between the two unit vectors.
    const s1 = Math.sin((1 - f) * delta) / Math.sin(delta);
    const s2 = Math.sin(f * delta) / Math.sin(delta);
    const x = s1 * Math.cos(phi1) * Math.cos(lambda1) + s2 * Math.cos(phi2) * Math.cos(lambda2);
    const y = s1 * Math.cos(phi1) * Math.sin(lambda1) + s2 * Math.cos(phi2) * Math.sin(lambda2);
    const z = s1 * Math.sin(phi1) + s2 * Math.sin(phi2);
    const lat = toDeg(Math.atan2(z, Math.hypot(x, y)));
    let lng = toDeg(Math.atan2(y, x));
    if (previousLng !== null) {
      while (lng - previousLng > 180) lng -= 360;
      while (lng - previousLng < -180) lng += 360;
    }
    previousLng = lng;
    points.push([lng, lat]);
  }
  return points;
}

/** How far off a guess was, for people: "1,234 km", "7.5 km", "450 m"; in miles "767 mi", "4.7 mi", "820 ft". */
export function formatDistance(km: number, units: Units = "km"): string {
  if (units === "km") {
    if (km < 1) return `${Math.round(km * 1000)} m`;
    if (km < 10) return `${km.toFixed(1)} km`;
    return `${Math.round(km).toLocaleString("en-US")} km`;
  }
  const mi = km / KM_PER_MILE;
  // Under a tenth of a mile reads better in feet, as on road signs.
  if (mi < 0.1) return `${Math.round(mi * 5280).toLocaleString("en-US")} ft`;
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi).toLocaleString("en-US")} mi`;
}

type LineFeature = {
  type: "Feature";
  properties: { kind: "meridian" | "parallel"; degrees: number };
  geometry: { type: "LineString"; coordinates: [number, number][] };
};

export type Graticule = { type: "FeatureCollection"; features: LineFeature[] };

/**
 * Meridians and parallels every `stepDegrees`, as GeoJSON lines. Parallels are densified so
 * they stay curved on the globe instead of being drawn as straight chords.
 */
export function graticule(stepDegrees = 30, densifyDegrees = 5): Graticule {
  if (!(stepDegrees > 0) || 180 % stepDegrees !== 0) {
    throw new RangeError("stepDegrees must divide 180 evenly");
  }
  const features: LineFeature[] = [];

  for (let lng = -180; lng < 180; lng += stepDegrees) {
    const coordinates: [number, number][] = [];
    for (let lat = -90; lat <= 90; lat += densifyDegrees) coordinates.push([lng, lat]);
    features.push({
      type: "Feature",
      properties: { kind: "meridian", degrees: lng },
      geometry: { type: "LineString", coordinates },
    });
  }

  for (let lat = -90 + stepDegrees; lat < 90; lat += stepDegrees) {
    const coordinates: [number, number][] = [];
    for (let lng = -180; lng <= 180; lng += densifyDegrees) coordinates.push([lng, lat]);
    features.push({
      type: "Feature",
      properties: { kind: "parallel", degrees: lat },
      geometry: { type: "LineString", coordinates },
    });
  }

  return { type: "FeatureCollection", features };
}

/** "14,220" — points with thousands separators. */
export function formatPoints(points: number): string {
  return Math.round(points).toLocaleString("en-US");
}
