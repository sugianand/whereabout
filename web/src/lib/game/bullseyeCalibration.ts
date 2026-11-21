/**
 * Your Bullseye calibration: for each ring, how many photos you bet it on and how many of those
 * it held, beside the same for Atlas's rings on the photos it bet. A well-judged ring holds most
 * of the photos it is bet on; a ring that rarely holds was bet too boldly. Atlas's rings come from
 * its own confidence by a fixed rule (`atlasRing`), so its row shows how well that confidence
 * matches where it lands.
 *
 * Two sources are added up, as the quick games' record does (./quickRecord.ts):
 * - free games and friends' challenges, tallied bet by bet as each is placed
 *   (`recordBullseyeRound`), under `BULLSEYE_CALIBRATION_KEY`, so leaving mid-game still counts;
 * - today's games, read back from the days ./bullseyeDaily.ts already keeps, so nothing is
 *   counted twice: the daily game never calls `recordBullseyeRound`.
 *
 * Only counts are kept, never a photo or a pin. Storage is best effort, as for the bests.
 */

import { RINGS, type Bet, type BullseyeRound } from "./bullseye";
import { loadBullseyeDays, type BullseyeDay } from "./bullseyeDaily";

export const BULLSEYE_CALIBRATION_KEY = "whereabout:bullseye-calibration";

/** One ring's bets: how many photos it was bet on, and how many of them it held. */
export interface RingTally {
  bet: number;
  held: number;
}

/** Each side's tallies, one per ring in `RINGS` order (tightest first). */
export interface Calibration {
  you: RingTally[];
  atlas: RingTally[];
}

const emptySide = (): RingTally[] => RINGS.map(() => ({ bet: 0, held: 0 }));

export function emptyCalibration(): Calibration {
  return { you: emptySide(), atlas: emptySide() };
}

const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

function parseSide(value: unknown): RingTally[] | null {
  if (!Array.isArray(value) || value.length !== RINGS.length) return null;
  const side: RingTally[] = [];
  for (const t of value) {
    if (typeof t !== "object" || t === null) return null;
    const { bet, held } = t as Record<string, unknown>;
    if (!count(bet) || !count(held) || held > bet) return null;
    side.push({ bet, held });
  }
  return side;
}

/** A stored calibration read back only in the shape `recordBullseyeRound` writes, else null. */
export function parseCalibration(value: unknown): Calibration | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const you = parseSide(v.you);
  const atlas = parseSide(v.atlas);
  if (!you || !atlas) return null;
  // Atlas only bets on photos you bet on too, so it can't have bet more than you.
  if (totals(atlas).bet > totals(you).bet) return null;
  return { you, atlas };
}

function addBet(side: readonly RingTally[], b: Bet): RingTally[] {
  return side.map((t, i) => (i === b.ring ? { bet: t.bet + 1, held: t.held + (b.inside ? 1 : 0) } : t));
}

/** `cal` with one photo's bets added: yours, and Atlas's when it bet. */
export function addRound(cal: Calibration, round: BullseyeRound): Calibration {
  return {
    you: addBet(cal.you, round.you),
    atlas: round.atlas ? addBet(cal.atlas, round.atlas) : cal.atlas,
  };
}

export function addCalibrations(a: Calibration, b: Calibration): Calibration {
  const sum = (x: readonly RingTally[], y: readonly RingTally[]) =>
    x.map((t, i) => ({ bet: t.bet + y[i]!.bet, held: t.held + y[i]!.held }));
  return { you: sum(a.you, b.you), atlas: sum(a.atlas, b.atlas) };
}

/** Every photo bet on today's games kept in this browser, as a calibration. */
export function calibrationFromDays(days: Readonly<Record<string, BullseyeDay>>): Calibration {
  let cal = emptyCalibration();
  for (const day of Object.values(days)) {
    for (const round of day.results) cal = addRound(cal, round);
  }
  return cal;
}

/** One side's bets over every ring. */
export function totals(side: readonly RingTally[]): RingTally {
  return side.reduce((t, r) => ({ bet: t.bet + r.bet, held: t.held + r.held }), { bet: 0, held: 0 });
}

/** The share of a tally's bets that held, 0..1, or null when nothing was bet. */
export function heldRate(t: RingTally): number | null {
  return t.bet === 0 ? null : t.held / t.bet;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The free games' and challenges' tallies kept in this browser; empty when none can be read. */
export function loadFreeCalibration(): Calibration {
  try {
    const raw = storage()?.getItem(BULLSEYE_CALIBRATION_KEY);
    if (!raw) return emptyCalibration();
    return parseCalibration(JSON.parse(raw)) ?? emptyCalibration();
  } catch {
    return emptyCalibration();
  }
}

/** Add one photo's bets from a free game or a challenge to the kept tallies; returns them. */
export function recordBullseyeRound(round: BullseyeRound): Calibration {
  const next = addRound(loadFreeCalibration(), round);
  try {
    storage()?.setItem(BULLSEYE_CALIBRATION_KEY, JSON.stringify(next));
  } catch {
    // Private mode or full storage: the bet still counted on screen.
  }
  return next;
}

/** Every Bullseye bet in this browser: free games, challenges and today's games. */
export function loadCalibration(): Calibration {
  return addCalibrations(loadFreeCalibration(), calibrationFromDays(loadBullseyeDays()));
}

const pct = (rate: number) => `${Math.round(rate * 100)}%`;

/**
 * The headline: "Your rings held 12 of 20 photos (60%); Atlas's held 9 of 18 (50%)." Atlas's
 * half is left out until it has bet on a photo.
 */
export function calibrationLine(cal: Calibration): string {
  const you = totals(cal.you);
  const atlas = totals(cal.atlas);
  const photos = you.bet === 1 ? "photo" : "photos";
  const mine = `Your rings held ${you.held} of ${you.bet} ${photos} (${pct(heldRate(you) ?? 0)})`;
  if (atlas.bet === 0) return `${mine}.`;
  return `${mine}; Atlas's held ${atlas.held} of ${atlas.bet} (${pct(heldRate(atlas) ?? 0)}).`;
}

/** Who holds their rings more often, over every ring, or null until both have bet. */
export function calibrationLeader(cal: Calibration): "you" | "atlas" | "level" | null {
  const a = totals(cal.you);
  const b = totals(cal.atlas);
  if (a.bet === 0 || b.bet === 0) return null;
  // Compared as fractions crossed over, so equal rates on different counts read exactly level.
  const diff = a.held * b.bet - b.held * a.bet;
  return diff === 0 ? "level" : diff > 0 ? "you" : "atlas";
}
