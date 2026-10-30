/**
 * Your closest calls: the rounds on your map where your pin landed nearest the answer, shown as
 * a gallery on `/map` with each photo, your distance, Atlas's on the same photo and a way to
 * play more of that photo's continent.
 *
 * The picks come only from the history the map already keeps (`lib/playedMap.ts`), so nothing
 * new is stored. Atlas's distance and the photo itself come from the photo's game record, which
 * the page fetches for just these few photos (`lib/game/deck.ts`); a photo the site no longer
 * deals has no record, and its card simply goes without them.
 */

import { continentOf } from "@/lib/continents";
import { regionSlug, type Regions } from "@/lib/game/regions";
import type { GameRecord } from "@/lib/game/deck";
import { haversineKm } from "@/lib/geo";
import type { PlayedPhoto } from "@/lib/playedMap";

/** How many closest calls the gallery shows. */
export const CLOSEST_CALLS = 5;

/**
 * The rounds whose pin landed closest, nearest first. A round with no pin (a Blitz clock ran
 * out) is never a close call. Ties go to the higher score (fewer hints taken), then to the
 * round played more recently, so the order is the same on every visit.
 */
export function closestCalls(
  history: readonly PlayedPhoto[],
  n: number = CLOSEST_CALLS,
): PlayedPhoto[] {
  return history
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.km !== null)
    .sort((a, b) => a.p.km! - b.p.km! || b.p.score - a.p.score || b.i - a.i)
    .slice(0, Math.max(0, n))
    .map(({ p }) => p);
}

/**
 * How far Atlas's pin landed from where the photo was taken, or null when there is no record or
 * Atlas sat the photo out. Measured to the answer kept with the round, the same point the
 * player's distance was.
 */
export function atlasKm(call: PlayedPhoto, record: GameRecord | null | undefined): number | null {
  const atlas = record?.atlas;
  if (!atlas || record.photo.id !== call.id) return null;
  return haversineKm(atlas, call);
}

/** Who got closer on a photo: the player, Atlas, or neither. */
export type CallVerdict = "you" | "atlas" | "tie";

export function verdict(yours: number, atlas: number): CallVerdict {
  // Distances that read the same to a tenth of a kilometre are a tie, as on the reveal.
  const a = Math.round(yours * 10);
  const b = Math.round(atlas * 10);
  return a < b ? "you" : a > b ? "atlas" : "tie";
}

/**
 * Where "play this continent" goes for a closest call: the continent game's `?region=` address,
 * or null when the photo's country has no continent or that continent can't fill a game.
 */
export function continentGameHref(call: PlayedPhoto, regions: Regions): string | null {
  const continent = continentOf(call.country);
  if (!continent || !(regions[continent]?.length ?? 0)) return null;
  return `/?region=${regionSlug(continent)}`;
}
