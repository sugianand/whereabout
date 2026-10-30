import { greatCirclePath, haversineKm, type LngLat } from "./geo";

/** Who made a guess. Each actor has one color everywhere (docs/design.md). */
export type Actor = "player" | "atlas";

export interface RevealView {
  truth: LngLat;
  /** Atlas's country distribution (ISO alpha-2 to p) for the heatmap; absent in older data. */
  belief?: Record<string, number>;
  /**
   * `label` marks a guess's pin with a short tag (a seat number in pass and play), so several
   * player pins on one reveal can be told apart; a labelled guess gets its own pin on the globe.
   */
  guesses: { actor: Actor; at: LngLat; label?: string }[];
}

export interface RevealLines {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: { actor: Actor };
    geometry: { type: "LineString"; coordinates: [number, number][] };
  }[];
}

/** How long the arcs take to draw from each guess to the truth. */
export const REVEAL_DRAW_MS = 1100;

/** Ease-out cubic: arcs leave fast and settle onto the truth. */
export function easeOut(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) ** 3;
}

/**
 * The arcs from each guess toward the truth, drawn `progress` of the way (0..1). Every arc
 * shares one clock so they land together, whatever their lengths.
 */
export function revealLines(view: RevealView, progress = 1, segments = 96): RevealLines {
  const p = Math.min(1, Math.max(0, progress));
  return {
    type: "FeatureCollection",
    features: view.guesses.map(({ actor, at }) => {
      const full = greatCirclePath(at, view.truth, segments);
      // At least two points, so MapLibre always has a valid line to draw.
      const count = Math.max(2, Math.round(p * (full.length - 1)) + 1);
      return {
        type: "Feature" as const,
        properties: { actor },
        geometry: { type: "LineString" as const, coordinates: full.slice(0, count) },
      };
    }),
  };
}

/** The frame size, in pixels, that the zoom curve below was tuned for. */
export const REFERENCE_FRAME_PX = 800;

/**
 * Where the camera should settle so the truth and every guess are in view: centred on the
 * middle of the longest arc and zoomed out in proportion to its length. `framePx` is the
 * smaller side of the visible map area; a phone-sized frame zooms out further, since each
 * zoom level halves how much of the planet fits in the same pixels.
 */
export function revealCamera(
  view: RevealView,
  framePx = REFERENCE_FRAME_PX,
): { center: LngLat; zoom: number } {
  let longest = view.guesses[0]?.at ?? view.truth;
  let longestKm = 0;
  for (const { at } of view.guesses) {
    const d = haversineKm(at, view.truth);
    if (d > longestKm) {
      longestKm = d;
      longest = at;
    }
  }
  const path = greatCirclePath(longest, view.truth, 32);
  const [lng, lat] = path[Math.floor(path.length / 2)];
  return {
    center: { lng: ((((lng + 180) % 360) + 360) % 360) - 180, lat },
    zoom: zoomForSpan(longestKm, framePx),
  };
}

/**
 * The zoom that fits a stretch of `km` across a frame `framePx` wide: 20,000 km (half the
 * planet) fits at zoom ~0.6 on the reference frame, and each halving of distance adds ~0.9.
 */
export function zoomForSpan(km: number, framePx = REFERENCE_FRAME_PX): number {
  const fit = Math.log2(Math.max(framePx, 160) / REFERENCE_FRAME_PX);
  const zoom = 0.6 + 0.9 * Math.log2(20000 / Math.max(km, 60)) + fit;
  return Math.min(5.5, Math.max(0, zoom));
}

export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Keep the arcs clear of the result card: on phones the card covers the bottom of the
 * screen, on wider screens it sits bottom-left.
 */
export function revealPadding(width: number, height: number): Padding {
  if (width < 768) {
    // The game header (title, mode button, round and score) takes the top 136 px on phones,
    // and the folded result card stays within the bottom 45%.
    return { top: 136, bottom: Math.round(height * 0.45), left: 16, right: 16 };
  }
  return { top: 72, bottom: 48, left: Math.round(Math.min(500, width * 0.36)), right: 48 };
}

/** The smaller side of the map area left visible after padding. */
export function visibleFrame(width: number, height: number, padding: Padding): number {
  return Math.min(width - padding.left - padding.right, height - padding.top - padding.bottom);
}
