/**
 * Hints for points: up to three clues per round, each lowering the round's maximum score.
 *
 * Broadest first: the continent (from the photo's country), the side of the road traffic drives
 * on, then the climate group (both from data/labels/concept_labels.csv, joined into photos.json
 * by scripts/build-catalog.mjs). A photo without a label offers fewer hints. The API builds the
 * same clues in the same words (api/src/whereabout_api/hints.py); both test suites check against
 * data/fixtures/hint_cases.json.
 */
import { continentOf } from "@/lib/continents";
import { MAX_HINTS } from "@/lib/geo";

export type ClueKind = "continent" | "driving_side" | "climate";

export interface Clue {
  kind: ClueKind;
  text: string;
}

export interface HintSource {
  country?: string | null;
  drivingSide?: string | null;
  climateGroup?: string | null;
}

const DRIVING_SIDES = new Set(["left", "right"]);
const CLIMATE_GROUPS = new Set(["Tropical", "Arid", "Temperate", "Continental", "Polar"]);

/** Every hint a photo offers, in the order they are given (at most MAX_HINTS). */
export function cluesFor({ country, drivingSide, climateGroup }: HintSource): Clue[] {
  const clues: Clue[] = [];
  const continent = continentOf(country);
  if (continent) clues.push({ kind: "continent", text: `It's in ${continent}` });
  if (drivingSide && DRIVING_SIDES.has(drivingSide)) {
    clues.push({ kind: "driving_side", text: `Traffic drives on the ${drivingSide}` });
  }
  if (climateGroup && CLIMATE_GROUPS.has(climateGroup)) {
    clues.push({ kind: "climate", text: `The climate is ${climateGroup.toLowerCase()}` });
  }
  return clues.slice(0, MAX_HINTS);
}
