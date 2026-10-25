/**
 * Difficulty tiers, measured on Atlas rather than guessed by hand.
 *
 * Every playable photo Atlas has guessed is ranked by how far Atlas v0's precomputed guess
 * (src/data/atlas.json) landed from the true location, and the ranking is cut into thirds:
 * Easy is the third Atlas got closest, Hard the third it missed by most. The tiers are rebuilt
 * from the data at every build, so they follow each new Atlas run and catalog harvest without
 * anyone relabelling photos. Photos Atlas sat out have no measured difficulty and join no tier.
 *
 * "Hard for Atlas" is not the same as "hard for people" (a famous skyline can fool CLIP), which
 * is why the game labels the tiers "how hard it was for Atlas".
 */

import { haversineKm } from "@/lib/geo";

import type { GameRecord } from "./deck";

export const TIERS = ["easy", "medium", "hard"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_NAMES: Record<Tier, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };

export interface TierPhotos {
  /** Photo ids, ordered from Atlas's smallest miss to its largest. */
  ids: string[];
  /** Atlas's smallest and largest miss in this tier, in km. */
  minKm: number;
  maxKm: number;
}

export type Tiers = Record<Tier, TierPhotos>;

/** How far Atlas's guess landed from the photo, or null when Atlas sat the photo out. */
export function atlasErrorKm(record: GameRecord): number | null {
  return record.atlas ? haversineKm(record.atlas, record.photo) : null;
}

/** Fewer measured photos than this per tier and a tier could not deal a whole game. */
export const MIN_PER_TIER = 5;

/**
 * Cut the measured photos into thirds by Atlas's error. Ties are broken by photo id, so the same
 * data always gives the same tiers. Returns null when there are too few measured photos for
 * every tier to fill a game of `perGame` photos.
 */
export function buildTiers(records: readonly GameRecord[], perGame = MIN_PER_TIER): Tiers | null {
  const measured = records
    .map((r) => ({ id: r.photo.id, km: atlasErrorKm(r) }))
    .filter((m): m is { id: string; km: number } => m.km !== null && Number.isFinite(m.km))
    .sort((a, b) => a.km - b.km || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const n = measured.length;
  if (n < perGame * TIERS.length) return null;
  const cuts = [0, Math.round(n / 3), Math.round((2 * n) / 3), n];
  const tiers = {} as Tiers;
  TIERS.forEach((tier, i) => {
    const slice = measured.slice(cuts[i], cuts[i + 1]);
    tiers[tier] = {
      ids: slice.map((m) => m.id),
      minKm: slice[0].km,
      maxKm: slice[slice.length - 1].km,
    };
  });
  return tiers;
}

/** Round to two significant figures for a label: 359.9 -> 360, 2,340.8 -> 2,300. */
function roundKm(km: number): string {
  if (km < 10) return `${Math.max(1, Math.round(km))} km`;
  const step = 10 ** (Math.floor(Math.log10(km)) - 1);
  return `${(Math.round(km / step) * step).toLocaleString("en-US")} km`;
}

/** One line on what a tier means, from the real errors: "Atlas missed these by under 360 km". */
export function tierBlurb(tier: Tier, tiers: Tiers): string {
  if (tier === "easy") return `Atlas missed these by under ${roundKm(tiers.medium.minKm)}`;
  if (tier === "hard") return `Atlas missed these by ${roundKm(tiers.hard.minKm)} or more`;
  return `Atlas missed these by ${roundKm(tiers.medium.minKm)} to ${roundKm(tiers.hard.minKm)}`;
}

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}
