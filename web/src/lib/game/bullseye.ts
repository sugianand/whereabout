/**
 * Bullseye: pin each photo and bet on how sure you are.
 *
 * With the pin goes a ring around it, one of `RINGS`. If the photo was taken inside the ring the
 * photo scores that ring's points; outside, nothing. A tight ring pays the most and misses the
 * most, so a game rewards knowing how far your own guess can be trusted, not only guessing well.
 * Where inside the ring the pin landed doesn't change the points.
 *
 * Atlas plays every photo it guessed with the same rings. Its pin is its own guess, and it picks
 * its ring from its own confidence in the country it named (`atlasRing`): the surer it is, the
 * tighter the ring. That rule is fixed here, the same for every photo, so the game shows how well
 * Atlas's confidence matches where it lands; it is never fitted to the answers.
 *
 * The rules live here as a pure reducer so they can be tested without a globe. The best game is
 * kept in this browser only, best effort.
 */

import { formatDistance, formatPoints, haversineKm, type LngLat } from "@/lib/geo";
import type { Units } from "@/lib/units";

export const BULLSEYE_PHOTOS = 5;
export const BEST_BULLSEYE_KEY = "whereabout:bullseye-best";
/** The most tight rings held in one whole free game or challenge, for the Bullseye stamps. */
export const BEST_TIGHT_KEY = "whereabout:bullseye-tight-best";

export interface Ring {
  /** The ring's radius around the pin, in kilometres. */
  km: number;
  /** What a photo inside it scores. */
  points: number;
}

/** The rings to bet on, tightest first: each pays less and holds four to ten times the ground. */
export const RINGS: readonly Ring[] = [
  { km: 250, points: 1000 },
  { km: 750, points: 500 },
  { km: 2000, points: 250 },
  { km: 5000, points: 100 },
];

/** The ring picked before the first tap of a photo: the middle bet, not the boldest. */
export const DEFAULT_RING = 1;

/** The most a photo can score. */
export const PHOTO_POINTS = RINGS[0]!.points;

/**
 * The lowest confidence at which Atlas picks each ring, tightest first: at 80% sure of the
 * country or more it bets the 250 km ring, at 50% the 750 km one, at 20% the 2,000 km one, and
 * below that the widest. A fixed rule, not fitted to the answers.
 */
export const ATLAS_RING_FROM = [0.8, 0.5, 0.2, 0] as const;

/** The ring Atlas bets for a guess it was `confidence` sure of (0..1); junk bets the widest. */
export function atlasRing(confidence: number): number {
  if (!Number.isFinite(confidence)) return RINGS.length - 1;
  const i = ATLAS_RING_FROM.findIndex((from) => confidence >= from);
  return i < 0 ? RINGS.length - 1 : i;
}

/** One side's bet on a photo, and how it went. */
export interface Bet {
  at: LngLat;
  /** Index into `RINGS`. */
  ring: number;
  km: number;
  /** True when the photo was taken inside the ring. */
  inside: boolean;
  score: number;
}

/** The bet of a pin at `at` with ring `ring` on a photo `km` away from it. */
export function settleBet(at: LngLat, ring: number, km: number): Bet {
  const r = RINGS[ring];
  if (!r) throw new RangeError(`no ring ${ring}`);
  // A whisker of slack, so a photo on the ring's own line counts as inside.
  const inside = km <= r.km + 1e-9;
  return { at, ring, km, inside, score: inside ? r.points : 0 };
}

/** The bet of a pin at `at` with ring `ring` on a photo at `truth`. */
export function bet(at: LngLat, ring: number, truth: LngLat): Bet {
  return settleBet(at, ring, haversineKm(at, truth));
}

export interface BullseyeRound {
  id: string;
  you: Bet;
  /** Null when Atlas never guessed this photo. */
  atlas: Bet | null;
}

/** Atlas's bet on a photo from its guess and its confidence. */
export function atlasBet(
  guess: LngLat & { confidence: number },
  truth: LngLat,
): Bet {
  return bet({ lng: guess.lng, lat: guess.lat }, atlasRing(guess.confidence), truth);
}

interface Game {
  order: readonly string[];
  index: number;
  results: readonly BullseyeRound[];
}

export type BullseyeState =
  | { phase: "idle" }
  | (Game & {
      /** Pinning photo `index`; `pin` is null until tapped, `ring` the bet picked so far. */
      phase: "guessing";
      pin: LngLat | null;
      ring: number;
    })
  | (Game & {
      /** The photo is over and its answer shown; its result is the last of `results`. */
      phase: "answered";
      round: BullseyeRound;
      /** The ring this photo was bet on, carried on to the next photo as its starting bet. */
      ring: number;
    })
  | { phase: "finished"; order: readonly string[]; results: readonly BullseyeRound[] };

export type BullseyeAction =
  /** `from` picks up a game already under way, at the first photo it hasn't bet on. */
  | { type: "start"; order: readonly string[]; from?: readonly BullseyeRound[] }
  | { type: "pinned"; pin: LngLat }
  | { type: "ring"; ring: number }
  | { type: "bet"; truth: LngLat; atlas: (LngLat & { confidence: number }) | null }
  | { type: "next" };

export const initialBullseye: BullseyeState = { phase: "idle" };

export function bullseyeReducer(state: BullseyeState, action: BullseyeAction): BullseyeState {
  switch (action.type) {
    case "start": {
      const { order } = action;
      const results = action.from ?? [];
      if (results.length >= order.length) return { phase: "finished", order, results };
      // A game picked back up starts on the ring its last photo was bet on, as if never left.
      const ring = results.at(-1)?.you.ring ?? DEFAULT_RING;
      return { phase: "guessing", order, index: results.length, results, pin: null, ring };
    }
    case "pinned":
      return state.phase === "guessing" ? { ...state, pin: action.pin } : state;
    case "ring":
      if (state.phase !== "guessing" || !Number.isInteger(action.ring) || !RINGS[action.ring]) {
        return state;
      }
      return { ...state, ring: action.ring };
    case "bet": {
      if (state.phase !== "guessing" || !state.pin) return state;
      const round: BullseyeRound = {
        id: state.order[state.index]!,
        you: bet(state.pin, state.ring, action.truth),
        atlas: action.atlas ? atlasBet(action.atlas, action.truth) : null,
      };
      const { order, index, ring } = state;
      return { phase: "answered", order, index, results: [...state.results, round], round, ring };
    }
    case "next": {
      if (state.phase !== "answered") return state;
      const { order, results, ring } = state;
      const index = state.index + 1;
      return index >= order.length
        ? { phase: "finished", order, results }
        : { phase: "guessing", order, index, results, pin: null, ring };
    }
  }
}

export function bullseyeTotal(results: readonly BullseyeRound[]): number {
  return results.reduce((sum, r) => sum + r.you.score, 0);
}

/** How many of your rings held their photo. */
export function ringsHeld(results: readonly BullseyeRound[]): number {
  return results.filter((r) => r.you.inside).length;
}

/** How many photos you bet the tightest ring on and it held: five in a game is a perfect one. */
export function tightRingsHeld(results: readonly BullseyeRound[]): number {
  return results.filter((r) => r.you.ring === 0 && r.you.inside).length;
}

/** Atlas's total over the photos it played, and how many that was. */
export function atlasBullseyeTotal(results: readonly BullseyeRound[]): {
  total: number;
  played: number;
  held: number;
} {
  let total = 0;
  let played = 0;
  let held = 0;
  for (const r of results) {
    if (!r.atlas) continue;
    total += r.atlas.score;
    played += 1;
    if (r.atlas.inside) held += 1;
  }
  return { total, played, held };
}

/** "the 250 km ring", in the player's units. */
export function ringName(ring: number, units: Units): string {
  return `the ${formatDistance(RINGS[ring]!.km, units)} ring`;
}

/** The answer card's line for one side's bet: "Inside the 750 km ring, 420 km off: 500 points." */
export function betLine(b: Bet, units: Units): string {
  const off = formatDistance(b.km, units);
  const ring = ringName(b.ring, units);
  return b.inside
    ? `Inside ${ring}, ${off} off: ${formatPoints(b.score)} points.`
    : `Outside ${ring}, ${off} off: no points.`;
}

/**
 * The end screen's line about Atlas, or null if it played none of the photos. Who won is only
 * called over a whole game: on fewer photos its total isn't a score to set against yours.
 */
export function bullseyeAtlasLine(results: readonly BullseyeRound[]): string | null {
  const { total, played, held } = atlasBullseyeTotal(results);
  if (played === 0) return null;
  const rings = `${held} of ${played} ring${played === 1 ? "" : "s"}`;
  if (played < results.length) {
    return `Atlas scored ${formatPoints(total)} on the ${played} of ${results.length} photos it played, holding ${rings}.`;
  }
  const you = bullseyeTotal(results);
  const atlas = `Atlas scored ${formatPoints(total)}, holding ${rings}`;
  if (you === total) return `${atlas}: level with you.`;
  const by = formatPoints(Math.abs(you - total));
  return you > total ? `${atlas}. You beat it by ${by}.` : `${atlas}, ${by} ahead of you.`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The best game's points in this browser, 0 when none is stored or it can't be read. */
export function loadBestBullseye(): number {
  try {
    const value = Number(storage()?.getItem(BEST_BULLSEYE_KEY));
    return Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** Keep `total` if it beats the stored best, and return the best after that. */
export function rememberBullseye(total: number): number {
  const best = loadBestBullseye();
  if (total <= best) return best;
  try {
    storage()?.setItem(BEST_BULLSEYE_KEY, String(total));
  } catch {
    // Private mode or full storage: the game still counts for this visit.
  }
  return total;
}

/**
 * The most tight rings held in one whole game in this browser, 0 when none is kept. A free game
 * kept before this was recorded still counts if its best is perfect: only five tight rings held
 * score every photo's points.
 */
export function loadBestTight(): number {
  let kept = 0;
  try {
    const value = Number(storage()?.getItem(BEST_TIGHT_KEY));
    if (Number.isInteger(value) && value > 0) kept = Math.min(value, BULLSEYE_PHOTOS);
  } catch {
    // Unreadable storage keeps nothing.
  }
  const perfect = loadBestBullseye() >= BULLSEYE_PHOTOS * PHOTO_POINTS ? BULLSEYE_PHOTOS : 0;
  return Math.max(kept, perfect);
}

/** Keep a whole game's tight rings held if it beats the stored most, and return the most. */
export function rememberTight(held: number): number {
  const best = loadBestTight();
  if (!Number.isInteger(held) || held <= best) return best;
  const next = Math.min(held, BULLSEYE_PHOTOS);
  try {
    storage()?.setItem(BEST_TIGHT_KEY, String(next));
  } catch {
    // Private mode or full storage: the game still counted on screen.
  }
  return next;
}
