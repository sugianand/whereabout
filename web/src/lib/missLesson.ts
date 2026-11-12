/**
 * Learn from a miss: when a pin lands in another country far from the photo, one line on a clue
 * that would have told the two places apart.
 *
 * Only clues the game already knows are used, never a made-up fact. The photo's side comes from
 * the reveal's own real clues (`trueClues.ts`, the side labelled for the photo's country); the
 * pinned country's from the same driving-side table (`drivingSides.ts`). Driving side is tried
 * first, since a player can check it in a photo; then continent (`continents.ts`). When the two
 * countries share every clue there is nothing true to teach, so there is no line.
 */
import { countryName } from "@/lib/countries";
import { countryAt } from "@/lib/countryHit";
import { continentOf } from "@/lib/continents";
import { drivingSideOf, type DrivingSide } from "@/lib/drivingSides";
import type { RoundResult } from "@/lib/game/state";

/** A miss must be further than this from the photo before the reveal offers a lesson. */
export const MISS_LESSON_MIN_KM = 2000;

export type MissLessonKind = "driving_side" | "continent";

export interface MissLesson {
  kind: MissLessonKind;
  /** The line itself, e.g. "In Japan they drive on the left; in Brazil, where your pin landed, on the right." */
  text: string;
}

export interface MissFacts {
  /** The photo's country (ISO alpha-2), if the reveal names one. */
  truthCountry: string | null | undefined;
  /** The country under the player's pin, or null for the sea or no pin. */
  pinnedCountry: string | null | undefined;
  /** How far the pin was from the photo, or null when there was no pin. */
  distanceKm: number | null;
  /** The photo's driving side from the reveal's real clues, when the maps give one. */
  truthSide?: DrivingSide | null;
}

/** Countries whose English name takes "the" in a sentence, beyond the plural and union names. */
const THE_COUNTRIES = new Set(["BS", "GM", "KM", "MV", "NL", "PH", "SC"]);

/** A country's name as it reads mid-sentence: "the United States", "the Faroe Islands", "Japan". */
export function countryInSentence(code: string): string {
  const name = countryName(code);
  const takesThe =
    THE_COUNTRIES.has(code.toUpperCase()) ||
    /\b(Islands|Republic|Kingdom|States|Emirates)\b/.test(name);
  return takesThe ? `the ${name}` : name;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The clue that tells the photo's country from the one pinned, or null if there is none to give. */
export function missLesson({
  truthCountry,
  pinnedCountry,
  distanceKm,
  truthSide,
}: MissFacts): MissLesson | null {
  if (distanceKm === null || !(distanceKm > MISS_LESSON_MIN_KM)) return null;
  const truth = truthCountry?.toUpperCase();
  const pinned = pinnedCountry?.toUpperCase();
  if (!truth || !pinned || truth === pinned) return null;
  // An unknown code reads back as itself: no name, so nothing to say about it.
  if (countryName(truth) === truth || countryName(pinned) === pinned) return null;
  const there = countryInSentence(truth);
  const here = countryInSentence(pinned);

  const pinnedSide = drivingSideOf(pinned);
  if (truthSide && pinnedSide && truthSide !== pinnedSide) {
    return {
      kind: "driving_side",
      text: `In ${there} they drive on the ${truthSide}; in ${here}, where your pin landed, on the ${pinnedSide}.`,
    };
  }

  const truthContinent = continentOf(truth);
  const pinnedContinent = continentOf(pinned);
  if (truthContinent && pinnedContinent && truthContinent !== pinnedContinent) {
    // Antarctica is its own continent: "Antarctica … is in Antarctica" says nothing.
    const landed =
      here === pinnedContinent
        ? `your pin landed in ${here}`
        : `${here}, where your pin landed, is in ${pinnedContinent}`;
    return { kind: "continent", text: `${capitalised(there)} is in ${truthContinent}; ${landed}.` };
  }
  return null;
}

/** The lesson for a revealed round: the country under its pin against the photo's own. */
export function missLessonFor(result: RoundResult): MissLesson | null {
  const { pin, reveal } = result;
  if (!pin || reveal.distanceKm === null || reveal.distanceKm <= MISS_LESSON_MIN_KM) return null;
  const side = reveal.answer.clues?.drivingSide;
  return missLesson({
    truthCountry: reveal.answer.country,
    pinnedCountry: countryAt(pin),
    distanceKm: reveal.distanceKm,
    truthSide: side === "left" || side === "right" ? side : null,
  });
}
