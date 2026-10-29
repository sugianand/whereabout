/**
 * Continent games: five photos all taken on one continent, for players who want to learn one
 * part of the world (or know it well and want to beat Atlas on home ground).
 *
 * Which continent a photo belongs to comes from its catalog country (`continentOf`, the same
 * seven-continent table the results page groups Atlas's errors by), so every new harvest grows
 * the continents' pools at the next build without anyone sorting photos by hand. A continent is
 * offered only when it has enough playable photos to deal a whole game.
 */

import { CONTINENTS, continentOf, type Continent } from "@/lib/continents";

import type { GameRecord } from "./deck";

/** URL-safe names, `?region=south-america`. */
const SLUGS: Record<Continent, string> = {
  Africa: "africa",
  Asia: "asia",
  Europe: "europe",
  "North America": "north-america",
  "South America": "south-america",
  Oceania: "oceania",
  Antarctica: "antarctica",
};

const BY_SLUG: ReadonlyMap<string, Continent> = new Map(CONTINENTS.map((c) => [SLUGS[c], c]));

export function regionSlug(region: Continent): string {
  return SLUGS[region];
}

/** The continent a `?region=` value names, or null for anything else. */
export function regionFromSlug(slug: string | null | undefined): Continent | null {
  return slug ? (BY_SLUG.get(slug) ?? null) : null;
}

/** Playable photo ids by continent, in catalog order; only continents that can fill a game. */
export type Regions = Partial<Record<Continent, string[]>>;

/** Fewer photos than a game deals and a continent is not offered. */
export const MIN_PER_REGION = 5;

/**
 * Group the playable photos by continent. Photos with a country the table doesn't know join no
 * continent; continents with fewer than `perGame` photos are left out. Keys follow `CONTINENTS`
 * order, so the picker lists them the same way at every build.
 */
export function buildRegions(records: readonly GameRecord[], perGame = MIN_PER_REGION): Regions {
  const ids = new Map<Continent, string[]>();
  for (const r of records) {
    const c = continentOf(r.photo.country);
    if (!c) continue;
    const list = ids.get(c) ?? [];
    list.push(r.photo.id);
    ids.set(c, list);
  }
  const regions: Regions = {};
  for (const c of CONTINENTS) {
    const list = ids.get(c);
    if (list && list.length >= perGame) regions[c] = list;
  }
  return regions;
}

/** The continents a deck offers, in `CONTINENTS` order. */
export function offeredRegions(regions: Regions): Continent[] {
  return CONTINENTS.filter((c) => (regions[c]?.length ?? 0) > 0);
}

/** One short line on what a continent game deals from: "All taken in Europe: N photos". */
export function regionBlurb(region: Continent, regions: Regions): string {
  const n = regions[region]?.length ?? 0;
  return `All taken in ${region}: ${n.toLocaleString("en-US")} photos`;
}

/**
 * The continents Country Streak can deal from: each continent's photos that Country Streak can
 * deal at all (`streakIds`, a country the globe draws), kept in the continent's catalog order.
 * A continent needs as many as a game deals before it is offered, so a run there is never over
 * after one or two photos just because the pool ran out.
 */
export function streakRegions(
  regions: Regions,
  streakIds: readonly string[],
  min = MIN_PER_REGION,
): Regions {
  const tappable = new Set(streakIds);
  const out: Regions = {};
  for (const c of CONTINENTS) {
    const list = regions[c]?.filter((id) => tappable.has(id));
    if (list && list.length >= min) out[c] = list;
  }
  return out;
}
