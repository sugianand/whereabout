/**
 * A shape for each closeness band, so a band never rests on colour alone: a circle for the
 * closest, then a diamond, a triangle and a cross for the furthest (or no pin). Your map's
 * globe dots, its legend and its rounds, the share picture's tiles and legend and the share card
 * on the results screen all draw the same four shapes from here.
 *
 * Each shape is plain geometry on a box from -1 to 1 (`markGeometry`), so the same shape can be
 * drawn as SVG, painted on the share picture's canvas, or rasterised into the pixels a MapLibre
 * symbol layer takes (`markImage`), with no canvas needed to build it.
 */

export type MarkShape = "circle" | "diamond" | "triangle" | "cross";

/** One shape per band, closest first: the order of `DISTANCE_BANDS` and of Your map's bands. */
export const MARK_SHAPES: readonly MarkShape[] = ["circle", "diamond", "triangle", "cross"];

export type Point = readonly [number, number];

export type MarkGeometry =
  { kind: "circle"; cx: number; cy: number; r: number } | { kind: "polygon"; points: Point[] };

/** The shape at band `index` (0 is closest); anything past the last band is the last shape. */
export function markShapeAt(index: number): MarkShape {
  return MARK_SHAPES[Math.min(Math.max(0, Math.floor(index)), MARK_SHAPES.length - 1)];
}

// The unit shapes, sized so each looks about as heavy as the others at the same box.
const CIRCLE_R = 0.82;
const DIAMOND: Point[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const TRIANGLE: Point[] = [
  [0, -0.95],
  [1, 0.8],
  [-1, 0.8],
];
// A plus with arms 0.32 wide either side and 1.05 long, turned 45° into a cross.
const CROSS: Point[] = (() => {
  const w = 0.32;
  const l = 1.05;
  const plus: Point[] = [
    [-w, -l],
    [w, -l],
    [w, -w],
    [l, -w],
    [l, w],
    [w, w],
    [w, l],
    [-w, l],
    [-w, w],
    [-l, w],
    [-l, -w],
    [-w, -w],
  ];
  const c = Math.SQRT1_2;
  return plus.map(([x, y]) => [c * (x - y), c * (x + y)] as Point);
})();

const UNIT: Record<Exclude<MarkShape, "circle">, Point[]> = {
  diamond: DIAMOND,
  triangle: TRIANGLE,
  cross: CROSS,
};

/** The shape centred on (cx, cy), fitting a box `radius` from the centre on every side. */
export function markGeometry(
  shape: MarkShape,
  cx: number,
  cy: number,
  radius: number,
): MarkGeometry {
  if (shape === "circle") return { kind: "circle", cx, cy, r: radius * CIRCLE_R };
  return {
    kind: "polygon",
    points: UNIT[shape].map(([x, y]) => [cx + x * radius, cy + y * radius] as Point),
  };
}

/** A polygon's points as an SVG `points` attribute. */
export function svgPoints(points: readonly Point[]): string {
  return points.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function segmentDistance([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function inside([px, py]: Point, points: readonly Point[]): boolean {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Signed distance from `p` to the shape's edge: negative inside, positive outside. */
export function signedDistance(geometry: MarkGeometry, p: Point): number {
  if (geometry.kind === "circle") {
    return Math.hypot(p[0] - geometry.cx, p[1] - geometry.cy) - geometry.r;
  }
  const pts = geometry.points;
  let d = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    d = Math.min(d, segmentDistance(p, pts[j], pts[i]));
  }
  return inside(p, pts) ? -d : d;
}

export interface MarkPixels {
  width: number;
  height: number;
  /** RGBA, row by row, not premultiplied: what MapLibre's `addImage` takes. */
  data: Uint8Array;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * The shape as a square of pixels `size` wide: filled with `fill`, edged with `outline` `edge`
 * pixels thick so it stands off the globe, with its edges smoothed over one pixel.
 */
export function markImage(
  shape: MarkShape,
  fill: string,
  outline: string,
  size: number,
  edge: number,
): MarkPixels {
  const half = size / 2;
  const geometry = markGeometry(shape, half, half, half - edge - 0.5);
  const inner = rgb(fill);
  const outer = rgb(outline);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = signedDistance(geometry, [x + 0.5, y + 0.5]);
      const alpha = Math.min(1, Math.max(0, 0.5 - (d - edge)));
      if (alpha === 0) continue;
      const t = Math.min(1, Math.max(0, 0.5 - d));
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = Math.round(outer[c] + (inner[c] - outer[c]) * t);
      data[o + 3] = Math.round(alpha * 255);
    }
  }
  return { width: size, height: size, data };
}
