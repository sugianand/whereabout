/**
 * The catalog and Atlas's guesses as built into the site. Server-only: the home page passes the
 * deck (just ids) to the browser and the records are written out as static files, so these
 * JSON files never reach a client bundle (see ./deck.ts).
 */

import atlasData from "@/data/atlas.json";
import catalog from "@/data/photos.json";

import { continentMap } from "./clueMix";
import { buildDeck, gameRecords } from "./deck";
import { nameIds } from "./nameCountry";
import type { AtlasData, CatalogPhoto } from "./types";
import { climateMap } from "./whichClimate";

export const bundledRecords = gameRecords(catalog as CatalogPhoto[], atlasData as AtlasData);
export const bundledDeck = buildDeck(bundledRecords);
export const bundledById = new Map(bundledRecords.map((r) => [r.photo.id, r]));

/**
 * Each photo Name the country can deal, by its country: what a practice run of your mix-ups needs
 * to pick photos in the browser (`nameMixUps.ts`), a few bytes a photo.
 */
export const bundledPhotoCountries: Record<string, string> = Object.fromEntries(
  nameIds(bundledDeck.streakIds, bundledDeck.regions).map((id) => [
    id,
    bundledById.get(id)!.photo.country,
  ]),
);

/**
 * Each photo Left or right? can deal, by its country's driving side: what the browser needs to
 * deal an even run of left and right photos without fetching every record (`leftRight.ts`).
 */
export const bundledDrivingSides: Record<string, "left" | "right"> = Object.fromEntries(
  bundledRecords.flatMap((r) => (r.photo.drivingSide ? [[r.photo.id, r.photo.drivingSide]] : [])),
);

/**
 * Each photo Which climate? can deal, by its Köppen group: what the browser needs to deal an even
 * game across the five groups without fetching every record (`whichClimate.ts`).
 */
export const bundledClimateGroups = climateMap(bundledRecords.map((r) => r.photo));

/**
 * Each playable photo's continent, from its catalog country: with the driving sides and climate
 * groups above, what Clue mix needs to deal every clue evenly in the browser (`clueMix.ts`).
 */
export const bundledContinents = continentMap(bundledRecords.map((r) => r.photo));
