import type { AtlasLooked } from "@/lib/game/types";

const ROWS = ["top", "middle", "bottom"] as const;
const COLS = ["left", "centre", "right"] as const;

/** The importance-weighted centre of a map, as fractions (0..1) across and down. */
export function hotspot(looked: AtlasLooked): { x: number; y: number } | null {
  const { grid, cells } = looked;
  let total = 0;
  let sx = 0;
  let sy = 0;
  cells.forEach((v, i) => {
    if (v <= 0) return;
    total += v;
    sx += v * ((i % grid) + 0.5);
    sy += v * (Math.floor(i / grid) + 0.5);
  });
  return total > 0 ? { x: sx / total / grid, y: sy / total / grid } : null;
}

/** "the top left", "the middle", "the bottom centre": where most of the importance sits. */
export function describeHotspot(looked: AtlasLooked): string | null {
  const h = hotspot(looked);
  if (!h) return null;
  const row = ROWS[Math.min(2, Math.floor(h.y * 3))];
  const col = COLS[Math.min(2, Math.floor(h.x * 3))];
  if (row === "middle" && col === "centre") return "the middle";
  if (row === "middle") return `the ${col} side`;
  return col === "centre" ? `the ${row}` : `the ${row} ${col}`;
}

/** True when a map is well-formed: a square grid of values in [0, 1] and a crop inside 0..1. */
export function isValidLooked(looked: AtlasLooked): boolean {
  if (looked.crop.length !== 4) return false;
  const [x, y, w, h] = looked.crop;
  return (
    Number.isInteger(looked.grid) &&
    looked.grid > 0 &&
    looked.cells.length === looked.grid * looked.grid &&
    looked.cells.every((v) => v >= 0 && v <= 1) &&
    w > 0 &&
    h > 0 &&
    x >= 0 &&
    y >= 0 &&
    x + w <= 1.0001 &&
    y + h <= 1.0001
  );
}
