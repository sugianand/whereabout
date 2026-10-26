import type { ExpressionSpecification } from "maplibre-gl";

import { numericId } from "./countryIds";

/** Atlas's country distribution as atlas.json carries it: ISO alpha-2 code → probability. */
export type Belief = Record<string, number>;

/** The heatmap keeps every country at or above this probability (`BELIEF_MIN_P` in Python). */
export const BELIEF_MIN_P = 0.005;

/**
 * Compact country distribution for the heatmap, `{code: p}` largest first, ties in input order:
 * countries below BELIEF_MIN_P dropped, the rest rounded to 3 decimals. A port of
 * `belief_from_probabilities` in ml/src/whereabout_ml/belief.py, so a heatmap Pocket Atlas
 * computes in the browser keeps the same countries as the game's precomputed ones.
 */
export function beliefFromProbabilities(
  codes: readonly string[],
  probabilities: readonly number[],
): Belief {
  if (codes.length !== probabilities.length) throw new Error("one probability per country");
  const kept = codes
    .map((code, i) => [code, probabilities[i], i] as const)
    .filter(([, p]) => p >= BELIEF_MIN_P)
    .sort((a, b) => b[1] - a[1] || a[2] - b[2]);
  const out: Belief = {};
  for (const [code, p] of kept) out[code] = Math.round(p * 1000) / 1000;
  return out;
}

/** The most opaque a country is ever painted, so borders, arcs and pins stay readable. */
export const BELIEF_MAX_OPACITY = 0.55;

/**
 * Fill opacity for a country Atlas gave probability `p`. The square root keeps a 2% country
 * visible next to a 90% one, while the area still ranks them in order.
 */
export function beliefOpacity(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return 0;
  return BELIEF_MAX_OPACITY * Math.sqrt(Math.min(1, p));
}

/** Opacity by topology id ("250" for France) for every country that has both an id and a p > 0. */
export function beliefByNumericId(belief: Belief): Map<string, number> {
  const out = new Map<string, number>();
  for (const [code, p] of Object.entries(belief)) {
    const id = numericId(code);
    const opacity = beliefOpacity(p);
    if (id && opacity > 0) out.set(id, Math.max(opacity, out.get(id) ?? 0));
  }
  return out;
}

/** The map's feature property that holds a country's numeric id (see basemap.ts). */
export const COUNTRY_ID_PROPERTY = "n";

/**
 * A `fill-opacity` paint value that shades each country by Atlas's belief, and nothing else.
 * No belief (or none that maps to a drawn country) is plain 0.
 */
export function beliefFillOpacity(belief: Belief | null | undefined): ExpressionSpecification | 0 {
  const byId = belief ? beliefByNumericId(belief) : new Map<string, number>();
  if (byId.size === 0) return 0;
  const stops: (string | number)[] = [];
  for (const [id, opacity] of [...byId].sort(([a], [b]) => a.localeCompare(b))) {
    stops.push(id, Number(opacity.toFixed(3)));
  }
  return ["match", ["get", COUNTRY_ID_PROPERTY], ...stops, 0] as unknown as ExpressionSpecification;
}
