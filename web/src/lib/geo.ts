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
