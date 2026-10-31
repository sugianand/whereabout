/**
 * Your bests in one place: each quick mode's best, as kept in this browser by the mode itself,
 * gathered for the results screen's mode cards so a player sees what to beat before opening one.
 *
 * Nothing new is stored here. Each mode keeps its own best under its own key (blitz.ts,
 * streak.ts, survival.ts, furtherNorth.ts, oddOneOut.ts); this only reads them back through the
 * same loaders, so a value a mode would refuse (a negative streak, junk JSON) is refused here too.
 */

import { CONTINENTS, type Continent } from "@/lib/continents";
import { formatPoints } from "@/lib/geo";

import { loadBlitzBest } from "./blitz";
import { loadBestNorth } from "./furtherNorth";
import { loadBestOdd } from "./oddOneOut";
import { regionSlug } from "./regions";
import { loadBestStreak } from "./streak";
import { loadBestSurvival, type SurvivalBest } from "./survival";

/** The quick modes the results screen links to, in the order its cards show them. */
export const QUICK_MODES = ["blitz", "streak", "survival", "further-north", "odd-one-out"] as const;

export type QuickMode = (typeof QUICK_MODES)[number];

/** A Country Streak best: how many in a row, and the continent it was dealt from (null: any). */
export interface StreakBest {
  streak: number;
  region: Continent | null;
}

/** Every quick mode's best in this browser; null where the mode has no best yet. */
export interface QuickBests {
  /** The best Blitz game's points. */
  blitz: number | null;
  /** The longest Country Streak, from any continent's runs or the all-world one. */
  streak: StreakBest | null;
  survival: SurvivalBest | null;
  /** The longest run of right picks. */
  "further-north": number | null;
  /** The longest run of right taps. */
  "odd-one-out": number | null;
}

export const NO_BESTS: QuickBests = {
  blitz: null,
  streak: null,
  survival: null,
  "further-north": null,
  "odd-one-out": null,
};

/**
 * The longest Country Streak kept: the all-world best, unless a continent's runs went longer,
 * so a player who only plays Europe still sees their best. A tie goes to the all-world run,
 * then to the continent listed first.
 */
export function bestStreak(
  load: (region: string | null) => number = loadBestStreak,
): StreakBest | null {
  let best: StreakBest | null = null;
  const consider = (streak: number, region: Continent | null) => {
    if (streak > 0 && (!best || streak > best.streak)) best = { streak, region };
  };
  consider(load(null), null);
  for (const continent of CONTINENTS) consider(load(regionSlug(continent)), continent);
  return best;
}

/** Read every quick mode's best from this browser. Safe on the server: nothing is kept there. */
export function loadQuickBests(): QuickBests {
  const positive = (n: number) => (n > 0 ? n : null);
  return {
    blitz: loadBlitzBest(),
    streak: bestStreak(),
    survival: loadBestSurvival(),
    "further-north": positive(loadBestNorth()),
    "odd-one-out": positive(loadBestOdd()),
  };
}

function inARow(n: number): string {
  return `${n} in a row`;
}

/**
 * The best as the card reads it, "Best: 7 in a row in Europe", or null when the mode has none
 * yet. Survival's photos are the ones survived, as its own end card counts them.
 */
export function bestLine(mode: QuickMode, bests: QuickBests): string | null {
  switch (mode) {
    case "blitz":
      return bests.blitz === null ? null : `Best: ${formatPoints(bests.blitz)} points`;
    case "streak": {
      const s = bests.streak;
      if (!s) return null;
      return `Best: ${inARow(s.streak)}${s.region ? ` in ${s.region}` : ""}`;
    }
    case "survival": {
      const s = bests.survival;
      if (!s) return null;
      return `Best: ${s.survived} ${s.survived === 1 ? "photo" : "photos"}, ${formatPoints(s.total)} points`;
    }
    case "further-north":
    case "odd-one-out": {
      const n = bests[mode];
      return n === null ? null : `Best: ${inARow(n)}`;
    }
  }
}
