/**
 * The game's photos, loaded a few at a time.
 *
 * The catalog and Atlas's guesses grow with every Commons harvest, so the home page no longer
 * bundles them. At build time the page gets only the deck, the ids of every playable photo, and
 * each photo is written out as its own static record (the photo and Atlas's guess for it, served
 * by `app/game-data/[version]/[file]/route.ts`). A game fetches just the five records it deals.
 *
 * Record URLs carry a version made from the records' contents, so a page built from one Atlas
 * run never mixes in records from another, even while a CDN still caches the old files.
 */

import { tappableCountries } from "@/lib/countryHit";

import { hashSeed } from "./daily";
import { playablePhotos } from "./playable";
import { buildTiers, type Tiers } from "./tiers";
import type { AtlasData, AtlasGuess, CatalogPhoto } from "./types";

/** Everything the browser needs to play one photo. */
export interface GameRecord {
  photo: CatalogPhoto;
  /** Atlas's precomputed guess, or null when Atlas has not guessed this photo. */
  atlas: AtlasGuess | null;
}

/** What the home page ships: which photos can be dealt, and where their records live. */
export interface Deck {
  version: string;
  /** Playable photo ids in catalog order (the Daily Five shuffles this order). */
  ids: string[];
  /** Easy, Medium and Hard thirds by Atlas's real error, or null with too few guesses. */
  tiers: Tiers | null;
  /**
   * The photos Country Streak can deal: those taken in a country the globe draws, so the answer
   * is always something the player can tap (microstates and small islands are left out).
   */
  streakIds: string[];
}

/** One record per playable photo, in catalog order. */
export function gameRecords(catalog: readonly CatalogPhoto[], atlas: AtlasData): GameRecord[] {
  return playablePhotos(catalog, atlas).map((photo) => ({
    photo,
    atlas: atlas.guesses[photo.id] ?? null,
  }));
}

/** A short content hash: any change to any record gives the deck a new version. */
export function deckVersion(records: readonly GameRecord[]): string {
  return hashSeed(JSON.stringify(records)).toString(16).padStart(8, "0");
}

export function buildDeck(records: readonly GameRecord[]): Deck {
  return {
    version: deckVersion(records),
    ids: records.map((r) => r.photo.id),
    tiers: buildTiers(records),
    streakIds: streakIds(records),
  };
}

/** Ids of the photos whose country can be tapped on the globe, in catalog order. */
export function streakIds(records: readonly GameRecord[]): string[] {
  const tappable = tappableCountries();
  return records.filter((r) => tappable.has(r.photo.country)).map((r) => r.photo.id);
}

/** Where a photo's record is served, e.g. "/whereabout/game-data/1a2b3c4d/wm000.json". */
export function recordUrl(
  version: string,
  id: string,
  basePath: string = process.env.NEXT_PUBLIC_BASE_PATH ?? "",
): string {
  return `${basePath.replace(/\/$/, "")}/game-data/${version}/${encodeURIComponent(id)}.json`;
}

function isRecord(value: unknown, id: string): value is GameRecord {
  if (typeof value !== "object" || value === null) return false;
  const { photo, atlas } = value as Partial<GameRecord>;
  return (
    typeof photo === "object" &&
    photo !== null &&
    photo.id === id &&
    typeof photo.imageUrl === "string" &&
    (atlas === null || typeof atlas === "object")
  );
}

export const LOAD_ERROR = "Couldn't load this game's photos. Check your connection and reload the page.";

/** Fetch the records for `ids`, in that order. Rejects with a player-facing message. */
export async function fetchRecords(
  deck: Deck,
  ids: readonly string[],
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<GameRecord[]> {
  return Promise.all(
    ids.map(async (id) => {
      let body: unknown;
      try {
        const res = await fetchImpl(recordUrl(deck.version, id));
        if (!res.ok) throw new Error(String(res.status));
        body = await res.json();
      } catch {
        throw new Error(LOAD_ERROR);
      }
      if (!isRecord(body, id)) throw new Error(LOAD_ERROR);
      return body;
    }),
  );
}
