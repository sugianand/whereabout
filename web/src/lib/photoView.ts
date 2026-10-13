/**
 * Pure maths for the pan-and-zoom photo viewer. A View is the image's transform inside a
 * frame: `translate(x px, y px) scale(scale)` with the transform origin at the top-left.
 */

export type View = { scale: number; x: number; y: number };
export type Frame = { w: number; h: number };
export type Point = { x: number; y: number };

export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
/** One keyboard or button zoom step. */
export const ZOOM_STEP = 1.5;
/** How far a tap zooms in, so players can read a sign or a number plate. */
export const TAP_ZOOM = 2.5;

export const RESET: View = { scale: 1, x: 0, y: 0 };

function clampTo(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Keeps the scale in range and the scaled image covering the whole frame. */
export function clampView(view: View, frame: Frame): View {
  const scale = clampTo(Number.isFinite(view.scale) ? view.scale : 1, MIN_SCALE, MAX_SCALE);
  const x = clampTo(view.x, Math.min(0, frame.w - frame.w * scale), 0);
  const y = clampTo(view.y, Math.min(0, frame.h - frame.h * scale), 0);
  return { scale, x: x || 0, y: y || 0 };
}

/** Zooms by `factor` about a frame point, so that point stays under the cursor. */
export function zoomAt(view: View, factor: number, point: Point, frame: Frame): View {
  const scale = clampTo(view.scale * factor, MIN_SCALE, MAX_SCALE);
  const ratio = scale / view.scale;
  return clampView(
    { scale, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio },
    frame,
  );
}

/** Moves the image by (dx, dy) pixels, stopping at the edges. */
export function panBy(view: View, dx: number, dy: number, frame: Frame): View {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, frame);
}

export function isZoomed(view: View): boolean {
  return view.scale > MIN_SCALE;
}

export function toTransform(view: View): string {
  return `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}
