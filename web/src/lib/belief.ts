import type { ExpressionSpecification } from "maplibre-gl";

import { numericId } from "./countryIds";

/** Atlas's country distribution as atlas.json carries it: ISO alpha-2 code → probability. */
export type Belief = Record<string, number>;

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
