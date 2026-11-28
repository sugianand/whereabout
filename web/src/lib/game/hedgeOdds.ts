/**
 * Your odds: over every Hedge your bets photo, how often a country was the right one given how
 * many chips you put on it, beside the same for Atlas's own chips. A spread of chips is a set of
 * odds (three chips says "about 30%"), so a player whose odds are well read finds that the
 * countries they gave three chips were right about three times in ten, and the ones they went
 * all in on nearly always. This is the reliability check a model's probabilities are judged by.
 *
 * Each country with chips on it is counted in one band of its chips (`ODDS`): 1–2, 3–4, 5–7 or
 * 8–10. A band keeps only counts: how many countries were bet on in it, how many chips they held
 * and how many were the photo's country. From those, `oddsGap` works out the expected calibration
 * error, the gap in points between what the chips said and how often they were right, weighted
 * by how many countries each band holds:
 *
 *     gap = Σ_band |right − chips / 10| / countries bet on × 100
 *
 * Atlas's side is its rounded chips on the same four countries (`HedgeResult.atlasChips`), so both
 * are read on the same photos and the same scale.
 *
 * Each photo is counted once, as its bet is placed (`recordHedgeOdds`): free games, friends'
 * challenges and today's game alike, so a reload adds nothing. Only counts are kept, never a
 * photo or a country. Storage is best effort, as for the bests.
 */

import { CHIPS, type HedgeResult } from "./hedge";

export const HEDGE_ODDS_KEY = "whereabout:hedge-odds";

/** The bands of chips on one country, fewest first, each from `min` to `max` chips. */
export const ODDS = [
  { key: "long", name: "Long shot", min: 1, max: 2, label: "1–2 chips" },
  { key: "maybe", name: "Maybe", min: 3, max: 4, label: "3–4 chips" },
  { key: "likely", name: "Likely", min: 5, max: 7, label: "5–7 chips" },
  { key: "sure", name: "Sure thing", min: 8, max: 10, label: "8–10 chips" },
] as const;

/** One band's countries, for one side. */
export interface OddsBand {
  /** Countries with this many chips on them. */
  bets: number;
  /** The chips they held, added up. */
  chips: number;
  /** Of those countries, how many were the photo's own. */
  right: number;
}

export interface HedgeOdds {
  /** Photos bet on. */
  photos: number;
  /** Your bands, in `ODDS` order. */
  you: OddsBand[];
  /** Atlas's bands on the same photos. */
  atlas: OddsBand[];
}

const emptyBands = (): OddsBand[] => ODDS.map(() => ({ bets: 0, chips: 0, right: 0 }));

export function emptyHedgeOdds(): HedgeOdds {
  return { photos: 0, you: emptyBands(), atlas: emptyBands() };
}

/** The band (an index into `ODDS`) for `chips` on one country, or -1 for none. */
export function oddsBandOf(chips: number): number {
  return ODDS.findIndex((b) => chips >= b.min && chips <= b.max);
}

function addBet(bands: readonly OddsBand[], chips: readonly number[], right: number): OddsBand[] {
  const next = bands.map((b) => ({ ...b }));
  chips.forEach((c, i) => {
    const band = oddsBandOf(c);
    if (band < 0) return;
    next[band]!.bets += 1;
    next[band]!.chips += c;
    if (i === right) next[band]!.right += 1;
  });
  return next;
}

/** `odds` with one photo's bet added, yours and Atlas's. */
export function addHedgeOdds(odds: HedgeOdds, result: HedgeResult): HedgeOdds {
  return {
    photos: odds.photos + 1,
    you: addBet(odds.you, result.chips, result.right),
    atlas: addBet(odds.atlas, result.atlasChips, result.right),
  };
}

const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function parseBands(value: unknown, photos: number): OddsBand[] | null {
  if (!Array.isArray(value) || value.length !== ODDS.length) return null;
  const bands: OddsBand[] = [];
  let right = 0;
  let chips = 0;
  for (const [i, b] of value.entries()) {
    if (typeof b !== "object" || b === null) return null;
    const { bets, chips: held, right: hits } = b as Record<string, unknown>;
    if (!count(bets) || !count(held) || !count(hits) || hits > bets) return null;
    const { min, max } = ODDS[i]!;
    if (held < bets * min || held > bets * max) return null;
    right += hits;
    chips += held;
    bands.push({ bets, chips: held, right: hits });
  }
  // Every photo puts all ten chips down and has exactly one right country, which may hold none.
  if (chips !== photos * CHIPS || right > photos) return null;
  return bands;
}

/** A stored read taken back only in the shape `recordHedgeOdds` writes, else null. */
export function parseHedgeOdds(value: unknown): HedgeOdds | null {
  if (typeof value !== "object" || value === null) return null;
  const { photos, you, atlas } = value as Record<string, unknown>;
  if (!count(photos)) return null;
  const mine = parseBands(you, photos);
  const theirs = parseBands(atlas, photos);
  return mine && theirs ? { photos, you: mine, atlas: theirs } : null;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Every bet kept in this browser; empty when none can be read. */
export function loadHedgeOdds(): HedgeOdds {
  try {
    const raw = storage()?.getItem(HEDGE_ODDS_KEY);
    if (!raw) return emptyHedgeOdds();
    return parseHedgeOdds(JSON.parse(raw)) ?? emptyHedgeOdds();
  } catch {
    return emptyHedgeOdds();
  }
}

/** Add one photo's bet to the kept read; returns it. */
export function recordHedgeOdds(result: HedgeResult): HedgeOdds {
  const next = addHedgeOdds(loadHedgeOdds(), result);
  try {
    storage()?.setItem(HEDGE_ODDS_KEY, JSON.stringify(next));
  } catch {
    // Private mode or full storage: the bet still counted on screen.
  }
  return next;
}

/** How often a band's countries were right, 0 to 100, or null with none bet on. */
export function hitRate(b: OddsBand): number | null {
  return b.bets === 0 ? null : Math.round((b.right / b.bets) * 100);
}

/** What a band's chips said on average, 0 to 100, or null with none bet on. */
export function saidRate(b: OddsBand): number | null {
  return b.bets === 0 ? null : Math.round((b.chips / b.bets / CHIPS) * 100);
}

/**
 * The gap, in points out of 100, between what one side's chips said and how often they were
 * right, over every country it bet on: 0 is perfectly read odds. Null before any bet.
 */
export function oddsGap(bands: readonly OddsBand[]): number | null {
  const bets = bands.reduce((a, b) => a + b.bets, 0);
  if (bets === 0) return null;
  const off = bands.reduce((a, b) => a + Math.abs(b.right - b.chips / CHIPS), 0);
  return Math.round((off / bets) * 100);
}

/** "point", "points". */
const points = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;

/** The headline: "Over 12 photos, your chips were 9 points off the real odds; Atlas's, 6." */
export function hedgeOddsLine(odds: HedgeOdds): string {
  const you = oddsGap(odds.you);
  const atlas = oddsGap(odds.atlas);
  if (odds.photos === 0 || you === null || atlas === null) return "No bets yet.";
  const noun = odds.photos === 1 ? "photo" : "photos";
  return `Over ${odds.photos} ${noun}, your chips were ${points(you)} off the real odds; Atlas's, ${atlas}.`;
}

/** Who read the odds closer, or null before any bet. */
export function hedgeOddsLeader(odds: HedgeOdds): "you" | "atlas" | "level" | null {
  const you = oddsGap(odds.you);
  const atlas = oddsGap(odds.atlas);
  if (odds.photos === 0 || you === null || atlas === null) return null;
  return you === atlas ? "level" : you < atlas ? "you" : "atlas";
}

/** One side's line on a band: "Right 3 of 10 · 30%, chips said 34%." */
export function oddsBandText(b: OddsBand): string {
  if (b.bets === 0) return "None bet yet";
  return `Right ${b.right} of ${b.bets} · ${hitRate(b)}%, chips said ${saidRate(b)}%`;
}
