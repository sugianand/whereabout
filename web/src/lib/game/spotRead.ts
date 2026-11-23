/**
 * Your read of Atlas: over every Spot the clue square locked in, how often it was warm or better
 * (the answer card's "Spot on" or "Warm"), how many squares it landed from the nearest of Atlas's
 * hottest on average, and where on the photo you tend to look beside where Atlas does, each
 * counted on a 3 × 3 of the photo (top left to bottom right).
 *
 * Each square is counted once, as it is locked in (`recordSpotRead`), from the photo's real map:
 * free games, friends' challenges and today's game alike. Today's kept days hold only the squares,
 * not the maps, so they are never read back here and nothing is counted twice. Your third of the
 * photo is the square's own; Atlas's is where most of its map's importance sits (`hotspot`), the
 * same place the answer card's "Atlas's clue sits mostly toward…" names. "Squares away" counts
 * diagonal steps as one, so a neighbouring square is always 1 away.
 *
 * It also counts how many squares were one of Atlas's hottest, for the Spot the clue stamps; a read
 * kept before that was counted reads back with none found.
 *
 * Only counts are kept, never a photo or a square. Storage is best effort, as for the bests.
 */

import { hotspot } from "@/lib/looked";

import { hottestCells, spotPoints } from "./spotClue";
import type { AtlasLooked } from "./types";

export const SPOT_READ_KEY = "whereabout:spot-the-clue-read";

/** The 3 × 3 of the photo, row by row from the top left. */
export const THIRDS = 9;
/** The points from which a square reads "Warm" on the answer card (`spotVerdict`). */
export const WARM_POINTS = 500;
/** The farthest one square can be from another on any grid a map is measured on. */
const MAX_AWAY = 31;

export interface SpotRead {
  /** Squares locked in. */
  picked: number;
  /** Of those, how many were warm or better. */
  warm: number;
  /** Of those, how many were one of Atlas's hottest (the answer card's "Spot on"). */
  hottest: number;
  /** Squares from the nearest hottest, added over every square picked. */
  away: number;
  /** Squares picked in each third of the photo. */
  you: number[];
  /** Photos whose map's importance sits mostly in each third. */
  atlas: number[];
}

export function emptyRead(): SpotRead {
  return {
    picked: 0,
    warm: 0,
    hottest: 0,
    away: 0,
    you: Array(THIRDS).fill(0),
    atlas: Array(THIRDS).fill(0),
  };
}

/** The third of the photo (0..8) a point given as fractions across and down falls in. */
export function thirdAt(x: number, y: number): number {
  const third = (v: number) => Math.min(2, Math.max(0, Math.floor(v * 3)));
  return third(y) * 3 + third(x);
}

/** The third of the photo a square of a `grid` × `grid` map sits in, by its centre. */
export function cellThird(grid: number, cell: number): number {
  return thirdAt(((cell % grid) + 0.5) / grid, (Math.floor(cell / grid) + 0.5) / grid);
}

/** Squares from `cell` to the nearest of Atlas's hottest, diagonal steps counted as one. */
export function squaresAway(looked: AtlasLooked, cell: number): number {
  const { grid } = looked;
  const row = Math.floor(cell / grid);
  const col = cell % grid;
  const steps = hottestCells(looked).map((h) =>
    Math.max(Math.abs(Math.floor(h / grid) - row), Math.abs((h % grid) - col)),
  );
  return steps.length ? Math.min(...steps) : 0;
}

/** `read` with one square added: `cell` picked on a photo whose map is `looked`. */
export function addSquare(read: SpotRead, looked: AtlasLooked, cell: number): SpotRead {
  const spot = hotspot(looked);
  const atlasThird = spot ? thirdAt(spot.x, spot.y) : null;
  const youThird = cellThird(looked.grid, cell);
  return {
    picked: read.picked + 1,
    warm: read.warm + (spotPoints(looked, cell) >= WARM_POINTS ? 1 : 0),
    hottest: read.hottest + (hottestCells(looked).includes(cell) ? 1 : 0),
    away: read.away + squaresAway(looked, cell),
    you: read.you.map((n, i) => (i === youThird ? n + 1 : n)),
    atlas: read.atlas.map((n, i) => (i === atlasThird ? n + 1 : n)),
  };
}

const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function parseThirds(value: unknown): number[] | null {
  return Array.isArray(value) && value.length === THIRDS && value.every(count) ? [...value] : null;
}

const sum = (xs: readonly number[]) => xs.reduce((s, n) => s + n, 0);

/** A stored read taken back only in the shape `recordSpotRead` writes, else null. */
export function parseSpotRead(value: unknown): SpotRead | null {
  if (typeof value !== "object" || value === null) return null;
  const {
    picked,
    warm,
    hottest = 0,
    away,
    you: rawYou,
    atlas: rawAtlas,
  } = value as Record<string, unknown>;
  if (!count(picked) || !count(warm) || !count(away) || warm > picked) return null;
  // A read kept before the hottest were counted has none; the hottest is always warm too.
  if (!count(hottest) || hottest > warm) return null;
  if (away > picked * MAX_AWAY) return null;
  const you = parseThirds(rawYou);
  const atlas = parseThirds(rawAtlas);
  if (!you || !atlas) return null;
  // Every square sits in one third; Atlas's map has one place only when it mattered somewhere.
  if (sum(you) !== picked || sum(atlas) > picked) return null;
  return { picked, warm, hottest, away, you, atlas };
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Every square counted in this browser; empty when none can be read. */
export function loadSpotRead(): SpotRead {
  try {
    const raw = storage()?.getItem(SPOT_READ_KEY);
    if (!raw) return emptyRead();
    return parseSpotRead(JSON.parse(raw)) ?? emptyRead();
  } catch {
    return emptyRead();
  }
}

/** Count one square locked in on a photo whose map is `looked`; returns the read after it. */
export function recordSpotRead(looked: AtlasLooked, cell: number): SpotRead {
  const next = addSquare(loadSpotRead(), looked, cell);
  try {
    storage()?.setItem(SPOT_READ_KEY, JSON.stringify(next));
  } catch {
    // Private mode or full storage: the square still counted on screen.
  }
  return next;
}

/** The share of squares warm or better, 0..1, or null before any. */
export function warmRate(read: SpotRead): number | null {
  return read.picked === 0 ? null : read.warm / read.picked;
}

/** The average squares from Atlas's hottest, or null before any. */
export function averageAway(read: SpotRead): number | null {
  return read.picked === 0 ? null : read.away / read.picked;
}

/**
 * The headline: "12 of 20 squares warm or better (60%), on average 1.4 squares from Atlas's
 * most telling."
 */
export function spotReadLine(read: SpotRead): string {
  const squares = read.picked === 1 ? "square" : "squares";
  const rate = Math.round((warmRate(read) ?? 0) * 100);
  const away = averageAway(read) ?? 0;
  const awayText = away === 0 ? "every one on" : `on average ${away.toFixed(1)} squares from`;
  return `${read.warm} of ${read.picked} ${squares} warm or better (${rate}%), ${awayText} Atlas's most telling.`;
}

const THIRD_NAMES = [
  "top left",
  "top",
  "top right",
  "left side",
  "middle",
  "right side",
  "bottom left",
  "bottom",
  "bottom right",
] as const;

/** A third's name in words: "the top left", "the middle". */
export function thirdName(i: number): string {
  return `the ${THIRD_NAMES[i] ?? "middle"}`;
}

/** The third counted most, the first in reading order on a tie, or null when none is counted. */
export function favouriteThird(counts: readonly number[]): number | null {
  const top = Math.max(...counts);
  return top > 0 ? counts.indexOf(top) : null;
}

/** Where you and Atlas look most, in words, once both have a third counted. */
export function lookLine(read: SpotRead): string | null {
  const you = favouriteThird(read.you);
  const atlas = favouriteThird(read.atlas);
  if (you === null || atlas === null) return null;
  return you === atlas
    ? `You and Atlas both look most at ${thirdName(you)} of the photo.`
    : `You look most at ${thirdName(you)} of the photo; Atlas at ${thirdName(atlas)}.`;
}
