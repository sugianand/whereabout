/**
 * Sizing the pin-placing globe so the whole Earth is in view, whatever size its frame is.
 *
 * MapLibre's globe projection draws the globe with a radius of
 * `worldSize / (2π) / cos(centerLat)` pixels, where `worldSize = 512 · 2^zoom`. Solving that for
 * the zoom at which the globe's diameter fills a share of the frame's shorter side gives the
 * "whole globe" zoom used for the opening view and the reset button.
 */

/** Pixels across the world at zoom 0 (MapLibre's tile size). */
const WORLD_SIZE_AT_ZOOM_0 = 512;

/** How much of the frame's shorter side the whole globe fills, leaving a little space around it. */
export const GLOBE_FILL = 0.86;

/** MapLibre's lowest allowed zoom. */
export const MIN_SUPPORTED_ZOOM = -2;

/** How far past the whole-globe view the player may zoom out. */
export const ZOOM_OUT_SLACK = 0.5;

/** The globe's radius in pixels at a zoom and centre latitude. */
export function globeRadiusPx(zoom: number, centerLat: number): number {
  const worldSize = WORLD_SIZE_AT_ZOOM_0 * 2 ** zoom;
  return worldSize / (2 * Math.PI) / Math.cos((centerLat * Math.PI) / 180);
}

/**
 * The zoom at which the whole globe fits a `width` × `height` frame, centred on `centerLat`.
 * Returns null when the frame has no size yet (it is still hidden or being laid out).
 */
export function fitGlobeZoom(width: number, height: number, centerLat: number): number | null {
  const side = Math.min(width, height);
  if (!(side > 0)) return null;
  const diameter = side * GLOBE_FILL;
  const zoom = Math.log2(
    (diameter * Math.PI * Math.cos((centerLat * Math.PI) / 180)) / WORLD_SIZE_AT_ZOOM_0,
  );
  return Math.max(MIN_SUPPORTED_ZOOM, zoom);
}
