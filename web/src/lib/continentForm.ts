/**
 * Your continents: how far off your pins land on each continent, read from Your map's history
 * (`lib/playedMap.ts`), so a player can see where they read photos well and where they don't,
 * and practise the continent they read worst.
 *
 * Each continent's figure is the median distance of its pinned rounds: one wild miss doesn't
 * swamp it the way it would an average. A round with no pin (a Blitz clock that ran out) says
 * nothing about where the player thought the photo was, so it is counted but not ranked.
 * Continents are only ranked once they have `MIN_FORM_ROUNDS` pinned rounds, and there is no weak
 * spot or strong suit until two ranked continents differ.
 */

import { CONTINENTS, continentOf, type Continent } from "@/lib/continents";
import { CLOSENESS_KM } from "@/lib/feel";
import { regionSlug, type Regions } from "@/lib/game/regions";
import type { PlayedPhoto } from "@/lib/playedMap";

/** Pinned rounds a continent needs before it is ranked; fewer says little. */
export const MIN_FORM_ROUNDS = 5;

/** Rounds in each half of the "lately" comparison: the newest ones against the ones before. */
export const LATELY_ROUNDS = 5;

export type Trend = "better" | "worse" | "same";

export interface ContinentForm {
  continent: Continent;
  /** Rounds played on the continent, pinned or not. */
  rounds: number;
  /** Rounds with a pin, the ones the median is taken over. */
  pinned: number;
  /** Median distance off over the pinned rounds, or null with none. */
  medianKm: number | null;
  /** Pinned rounds within the "close" band (500 km), as on the map's legend. */
  close: number;
  /** Whether the continent has enough pinned rounds to be ranked. */
  ranked: boolean;
  /**
   * The newest `LATELY_ROUNDS` pinned rounds against the `LATELY_ROUNDS` before them, by median,
   * or null until there are twice that many. Within 10% either way is "same".
   */
  lately: { trend: Trend; beforeKm: number; nowKm: number } | null;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function trendOf(beforeKm: number, nowKm: number): Trend {
  // A tenth either way (or under a kilometre between them) is noise, not a change of form.
  if (Math.abs(nowKm - beforeKm) <= Math.max(1, beforeKm * 0.1)) return "same";
  return nowKm < beforeKm ? "better" : "worse";
}

/**
 * Every continent with a round on it, in `CONTINENTS` order. The history is oldest first, as
 * Your map keeps it, so "lately" reads the newest end.
 */
export function continentForms(
  history: readonly PlayedPhoto[],
  minRounds = MIN_FORM_ROUNDS,
): ContinentForm[] {
  const byContinent = new Map<Continent, PlayedPhoto[]>();
  for (const p of history) {
    const c = continentOf(p.country);
    if (!c) continue;
    const list = byContinent.get(c) ?? [];
    list.push(p);
    byContinent.set(c, list);
  }
  const out: ContinentForm[] = [];
  for (const continent of CONTINENTS) {
    const rounds = byContinent.get(continent);
    if (!rounds) continue;
    const kms = rounds.flatMap((p) => (p.km === null ? [] : [p.km]));
    let lately: ContinentForm["lately"] = null;
    if (kms.length >= 2 * LATELY_ROUNDS) {
      const beforeKm = median(kms.slice(-2 * LATELY_ROUNDS, -LATELY_ROUNDS))!;
      const nowKm = median(kms.slice(-LATELY_ROUNDS))!;
      lately = { trend: trendOf(beforeKm, nowKm), beforeKm, nowKm };
    }
    out.push({
      continent,
      rounds: rounds.length,
      pinned: kms.length,
      medianKm: median(kms),
      close: kms.filter((km) => km <= CLOSENESS_KM.close).length,
      ranked: kms.length >= minRounds,
      lately,
    });
  }
  return out;
}

/**
 * The ranked continents your pins land furthest from (weak) and nearest to (strong), by median.
 * Ties go to the continent with more pinned rounds (the steadier figure), then `CONTINENTS`
 * order. Null until two ranked continents have different medians.
 */
export function formExtremes(
  forms: readonly ContinentForm[],
): { weak: ContinentForm; strong: ContinentForm } | null {
  const ranked = forms.filter((f) => f.ranked && f.medianKm !== null);
  if (ranked.length < 2) return null;
  const steadier = (a: ContinentForm, b: ContinentForm) => b.pinned - a.pinned;
  const weak = [...ranked].sort((a, b) => b.medianKm! - a.medianKm! || steadier(a, b))[0];
  const strong = [...ranked].sort((a, b) => a.medianKm! - b.medianKm! || steadier(a, b))[0];
  return weak.medianKm === strong.medianKm ? null : { weak, strong };
}

/** A five-photo game on the continent, when the deck can deal one there. */
export function practiceHref(continent: Continent, regions: Regions): string | null {
  return (regions[continent]?.length ?? 0) > 0 ? `/?region=${regionSlug(continent)}` : null;
}

/**
 * A bar's width, 0 to 1, for a median distance: on a log scale from 10 km to 20,000 km (half the
 * world round), so a 50 km and a 500 km continent look different, and far worse ones don't all
 * fill the bar. Longer is further off.
 */
export function formBar(km: number): number {
  const lo = Math.log(10);
  const hi = Math.log(20_000);
  const v = (Math.log(Math.max(km, 10)) - lo) / (hi - lo);
  return Math.min(1, Math.max(0.03, v));
}
