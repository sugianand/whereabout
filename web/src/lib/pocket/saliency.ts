import type { AtlasLooked } from "../game/types";

/**
 * "Where Atlas looked" on your own photo: occlusion saliency, in the browser.
 *
 * A port of ml/src/whereabout_ml/saliency.py, the method behind the game's own maps. CLIP sees a
 * square crop of the photo; split it into a grid, grey out one cell at a time (0 in CLIP's
 * normalised pixels is the dataset's mean colour, a neutral grey) and re-score:
 *
 *     importance(cell) = log p(country | photo) − log p(country | photo with the cell greyed)
 *
 * Then the deletion test checks the map instead of trusting it: hide the 5 cells Atlas relied on
 * most and, separately, 5 random cells. A faithful map hurts the guess much more the first way.
 *
 * Both halves are pinned to Python by data/fixtures/saliency_cases.json.
 */

export const DEFAULT_GRID = 7;
export const DELETION_K = 5;
export const DELETION_RANDOM_TRIALS = 3;

/** Normalised CLIP pixels, channel-first: dims are [channels, height, width]. */
export interface Pixels {
  data: Float32Array;
  dims: readonly [number, number, number];
}

/** log p(country) for one image. Called once per occluded copy, so it may be slow and async. */
export type LogProb = (pixels: Pixels) => Promise<number>;

export interface PocketLooked extends AtlasLooked {
  /** Deletion test: relative drop in p(country) after hiding the top-k cells... */
  topKDrop: number;
  /** ...and after hiding k random cells (mean over the trials). */
  randomKDrop: number;
}

/** Python's round(): halves go to the even neighbour (numpy's linspace(...).round()). */
export function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;

/** Split [0, size) into `grid` contiguous spans that differ in length by at most 1. */
export function cellBounds(size: number, grid: number): [number, number][] {
  if (!Number.isInteger(grid) || grid < 1 || grid > size) {
    throw new Error(`grid must be between 1 and ${size}, got ${grid}`);
  }
  const edges = Array.from({ length: grid + 1 }, (_, i) => roundHalfEven((size * i) / grid));
  return edges.slice(0, -1).map((a, i) => [a, edges[i + 1]]);
}

/** A copy of `pixels` with the given row-major cells set to `fill` (0: CLIP's mean grey). */
export function occlude(pixels: Pixels, cells: readonly number[], grid: number, fill = 0): Pixels {
  const [channels, h, w] = pixels.dims;
  const rows = cellBounds(h, grid);
  const cols = cellBounds(w, grid);
  const out = Float32Array.from(pixels.data);
  for (const cell of cells) {
    if (!Number.isInteger(cell) || cell < 0 || cell >= grid * grid) {
      throw new Error(`cell ${cell} outside a ${grid}×${grid} grid`);
    }
    const [r0, r1] = rows[Math.floor(cell / grid)];
    const [c0, c1] = cols[cell % grid];
    for (let c = 0; c < channels; c++) {
      for (let y = r0; y < r1; y++) out.fill(fill, (c * h + y) * w + c0, (c * h + y) * w + c1);
    }
  }
  return { data: out, dims: pixels.dims };
}

/** Called after each forward pass with how many are done out of how many in all. */
export type Progress = (done: number, total: number) => void;

/** Raw importances, row-major grid × grid: how much log p falls when each cell is hidden. */
export async function occlusionMap(
  pixels: Pixels,
  logProb: LogProb,
  grid = DEFAULT_GRID,
  onPass: () => void = () => {},
): Promise<number[]> {
  const base = await logProb(pixels);
  onPass();
  const raw: number[] = [];
  // One at a time, as the base pass was: a batch can change how a quantised model rounds
  // activations, and phones only need to hold one copy at a time.
  for (let cell = 0; cell < grid * grid; cell++) {
    raw.push(base - (await logProb(occlude(pixels, [cell], grid))));
    onPass();
  }
  return raw;
}

/** Keep the cells that supported the guess (positive drops), scaled so the top one is 1. */
export function normaliseMap(raw: readonly number[]): number[] {
  const pos = raw.map((v) => Math.max(v, 0));
  const peak = Math.max(0, ...pos);
  return peak > 0 ? pos.map((v) => v / peak) : pos.map(() => 0);
}

/** The k cells whose hiding hurt most; ties go to the earlier cell, as numpy's stable argsort. */
export function topCells(raw: readonly number[], k = DELETION_K): number[] {
  return raw
    .map((v, i) => [v, i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .slice(0, k)
    .map(([, i]) => i);
}

/** `trials` sets of k distinct cells, each sorted (a partial Fisher–Yates shuffle). */
export function randomCells(
  nCells: number,
  k = DELETION_K,
  trials = DELETION_RANDOM_TRIALS,
  random: () => number = Math.random,
): number[][] {
  return Array.from({ length: trials }, () => {
    const pool = Array.from({ length: nCells }, (_, i) => i);
    for (let i = 0; i < k; i++) {
      const j = i + Math.floor(random() * (nCells - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, k).sort((a, b) => a - b);
  });
}

/** Relative drop in p(country) after hiding the top-k cells, and after each random set (mean). */
export async function deletionDrops(
  pixels: Pixels,
  raw: readonly number[],
  logProb: LogProb,
  randoms: readonly number[][],
  k = DELETION_K,
  onPass: () => void = () => {},
): Promise<[number, number]> {
  const grid = Math.round(Math.sqrt(raw.length));
  const images = [pixels, occlude(pixels, topCells(raw, k), grid)];
  for (const r of randoms) images.push(occlude(pixels, r, grid));
  const p: number[] = [];
  for (const image of images) {
    p.push(Math.exp(await logProb(image)));
    onPass();
  }
  const base = Math.max(p[0], 1e-12);
  const drops = p.slice(1).map((x) => (base - x) / base);
  const rest = drops.slice(1);
  return [drops[0], rest.reduce((a, b) => a + b, 0) / rest.length];
}

/** The square that "resize the short side, then centre-crop" keeps, as fractions. */
export function centreCropBox(width: number, height: number): [number, number, number, number] {
  if (!(width > 0 && height > 0)) throw new Error("image size must be positive");
  const side = Math.min(width, height);
  return [(width - side) / 2 / width, (height - side) / 2 / height, side / width, side / height];
}

export interface ExplainOptions {
  grid?: number;
  /** Draws the deletion test's random cells; tests pass Python's draws. */
  draw?: (nCells: number) => number[][];
  onProgress?: Progress;
}

/** Saliency map and deletion test for one photo, rounded as Python's `explain` rounds them. */
export async function explain(
  pixels: Pixels,
  crop: readonly [number, number, number, number],
  logProb: LogProb,
  { grid = DEFAULT_GRID, draw = (n) => randomCells(n), onProgress = () => {} }: ExplainOptions = {},
): Promise<PocketLooked> {
  const randoms = draw(grid * grid);
  const total = 1 + grid * grid + 2 + randoms.length;
  let done = 0;
  const tick = () => onProgress(++done, total);
  const raw = await occlusionMap(pixels, logProb, grid, tick);
  const [top, rand] = await deletionDrops(pixels, raw, logProb, randoms, DELETION_K, tick);
  return {
    grid,
    cells: normaliseMap(raw).map((v) => round(v, 3)),
    crop: crop.map((v) => round(v, 4)),
    topKDrop: round(top, 4),
    randomKDrop: round(rand, 4),
  };
}
