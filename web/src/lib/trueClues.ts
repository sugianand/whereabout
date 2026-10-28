/**
 * The reveal's "real clues": what the maps say about where the photo was taken, next to what
 * Atlas read, so players learn which clues to look for.
 *
 * The truth comes from data/labels/concept_labels.csv (joined into photos.json by
 * scripts/build-catalog.mjs): the driving side of the photo's country, its Köppen-Geiger climate
 * group (Beck et al. 2023) and the ESA WorldCover 2021 land cover around it. Atlas's side comes
 * only from what it actually said:
 *
 * - Driving side: its "Drives on the …" clue when the clue head wrote one, otherwise the side of
 *   the country it picked (the same baseline `clue_heads.py` scores the probe against).
 * - Climate: its climate clue, read as a Köppen group the way `ZERO_SHOT_CLIMATE` in
 *   `clue_heads.py` does. No climate clue means Atlas didn't say.
 * - Land cover: Atlas has no land-cover clue, but some of its scene clues claim the place is or
 *   isn't built up. Only those are judged, and only against map classes that settle the question:
 *   "Built-up" against vegetation, bare ground or snow. Water and wetland classes are left
 *   unjudged (a harbour city is mostly water within the map's ~150 m window), and so are "Village"
 *   and "Countryside" (a village can sit among fields that out-number its roofs).
 */
import { countryName } from "@/lib/countries";
import { drivingSideOf, type DrivingSide } from "@/lib/drivingSides";
import type { AtlasClue } from "@/lib/game/types";

/** What the maps say about a photo's spot (any of them may be missing). */
export interface PhotoClues {
  drivingSide?: DrivingSide;
  climateGroup?: string;
  landCover?: string;
}

export type TrueClueKind = "driving_side" | "climate" | "land_cover";

export interface TrueClue {
  kind: TrueClueKind;
  /** The real clue in words, e.g. "Drives on the left". */
  truth: string;
  /** What Atlas read for it, e.g. "drives on the right (its pick, France)", or null if nothing. */
  atlas: string | null;
  /** Whether Atlas's read matches the truth; null when Atlas said nothing that can be judged. */
  right: boolean | null;
}

export interface AtlasRead {
  clues: readonly AtlasClue[];
  topCountries: readonly { country: string; p: number }[];
}

export const CLIMATE_GROUPS = ["Tropical", "Arid", "Temperate", "Continental", "Polar"] as const;

/** Zero-shot climate options as Köppen groups (`ZERO_SHOT_CLIMATE` in clue_heads.py). */
const ZERO_SHOT_CLIMATE: Record<string, string> = {
  Tropical: "Tropical",
  Desert: "Arid",
  Temperate: "Temperate",
  Mediterranean: "Temperate",
  "Snow and ice": "Continental",
  Arctic: "Polar",
};

/** ESA WorldCover 2021 classes as the reveal names them. */
const LAND_COVER_WORDS: Record<string, string> = {
  "Tree cover": "trees",
  Shrubland: "shrubland",
  Grassland: "grassland",
  Cropland: "farmland",
  "Built-up": "buildings",
  "Bare / sparse vegetation": "bare ground",
  "Snow and ice": "snow and ice",
  "Permanent water bodies": "water",
  "Herbaceous wetland": "wetland",
  Mangroves: "mangroves",
  "Moss and lichen": "moss and lichen",
};

/** WorldCover classes that say the spot is not built up (water and wetlands say neither). */
const UNBUILT_COVER = new Set([
  "Tree cover",
  "Shrubland",
  "Grassland",
  "Cropland",
  "Bare / sparse vegetation",
  "Snow and ice",
  "Moss and lichen",
]);

/** Atlas's scene clues that claim buildings, and the one that claims none. */
const BUILT_CLUES = new Set(["City", "Modern skyline", "European old town"]);
const UNBUILT_CLUES = new Set(["No buildings"]);

export function isLandCover(value: string): boolean {
  return value in LAND_COVER_WORDS;
}

/** The Köppen group a clue label names ("Arid climate" or zero-shot "Desert"), or null. */
export function climateGroupOf(label: string): string | null {
  const m = /^(\w+) climate$/.exec(label);
  if (m && (CLIMATE_GROUPS as readonly string[]).includes(m[1])) return m[1];
  return ZERO_SHOT_CLIMATE[label] ?? null;
}

function drivingClue(truth: DrivingSide, atlas: AtlasRead | null): TrueClue {
  const clue = { kind: "driving_side" as const, truth: `Drives on the ${truth}` };
  if (!atlas) return { ...clue, atlas: null, right: null };
  for (const c of atlas.clues) {
    const m = /^Drives on the (left|right)$/.exec(c.label);
    if (m) return { ...clue, atlas: `drives on the ${m[1]}`, right: m[1] === truth };
  }
  const pick = [...atlas.topCountries].sort((a, b) => b.p - a.p)[0]?.country;
  const side = drivingSideOf(pick);
  if (!pick || !side) return { ...clue, atlas: null, right: null };
  return {
    ...clue,
    atlas: `drives on the ${side} (its pick, ${countryName(pick)})`,
    right: side === truth,
  };
}

function climateClue(truth: string, atlas: AtlasRead | null): TrueClue {
  const clue = { kind: "climate" as const, truth: `${truth} climate` };
  for (const c of atlas?.clues ?? []) {
    const group = climateGroupOf(c.label);
    if (group) return { ...clue, atlas: `${group.toLowerCase()} climate`, right: group === truth };
  }
  return { ...clue, atlas: null, right: null };
}

function landClue(truth: string, atlas: AtlasRead | null): TrueClue {
  const clue = {
    kind: "land_cover" as const,
    truth: `Mostly ${LAND_COVER_WORDS[truth]} around it`,
  };
  const built = truth === "Built-up" ? true : UNBUILT_COVER.has(truth) ? false : null;
  if (built === null) return { ...clue, atlas: null, right: null };
  for (const c of atlas?.clues ?? []) {
    const says = BUILT_CLUES.has(c.label) ? true : UNBUILT_CLUES.has(c.label) ? false : null;
    if (says !== null) return { ...clue, atlas: c.label.toLowerCase(), right: says === built };
  }
  return { ...clue, atlas: null, right: null };
}

/**
 * The real clues for a photo, in the order a player can check them: road, climate, ground.
 * `atlas` is null when Atlas sat the photo out; each clue then has no Atlas read.
 */
export function trueClues(
  photo: PhotoClues | null | undefined,
  atlas: AtlasRead | null,
): TrueClue[] {
  if (!photo) return [];
  const out: TrueClue[] = [];
  if (photo.drivingSide === "left" || photo.drivingSide === "right") {
    out.push(drivingClue(photo.drivingSide, atlas));
  }
  if (photo.climateGroup && (CLIMATE_GROUPS as readonly string[]).includes(photo.climateGroup)) {
    out.push(climateClue(photo.climateGroup, atlas));
  }
  if (photo.landCover && isLandCover(photo.landCover)) out.push(landClue(photo.landCover, atlas));
  return out;
}
