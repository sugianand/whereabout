/**
 * The catalog and Atlas's guesses as built into the site. Server-only: the home page passes the
 * deck (just ids) to the browser and the records are written out as static files, so these
 * JSON files never reach a client bundle (see ./deck.ts).
 */

import atlasData from "@/data/atlas.json";
import catalog from "@/data/photos.json";

import { buildDeck, gameRecords } from "./deck";
import type { AtlasData, CatalogPhoto } from "./types";

export const bundledRecords = gameRecords(catalog as CatalogPhoto[], atlasData as AtlasData);
export const bundledDeck = buildDeck(bundledRecords);
export const bundledById = new Map(bundledRecords.map((r) => [r.photo.id, r]));
