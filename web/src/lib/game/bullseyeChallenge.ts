/**
 * Challenge a friend to Bullseye: a link that deals a friend the very same five photos, in the
 * same order, with the sender's ring and how far off their pin landed on each, shown to the
 * friend once they have bet on that photo.
 *
 * The link names the five photos, the sender's ring on each as its key (`1` the tightest, as the
 * keyboard picks it) and each pin's distance from the photo in whole kilometres, rounded up, e.g.
 * `/bullseye?challenge=wm077.wm003.wm104.wh012.wm150_21134_412.88.1730.240.4410`. Rounding up
 * keeps a ring's verdict: a pin 250.4 km off is outside the 250 km ring and so is 251. The points
 * to beat are never carried: each photo's are settled from its ring and distance by the game's
 * own rule (`settleBet`), so a link can't claim points its rings didn't hold. The link names no
 * place and no pin, only distances, so the friend learns how close the sender came but not
 * where they guessed. Nothing is stored: the challenge lives in the address.
 */

import { rowWinner, type HeadToHead } from "@/lib/headToHead";
import { formatDistance, formatPoints, type LngLat } from "@/lib/geo";
import type { Units } from "@/lib/units";

import {
  BULLSEYE_PHOTOS,
  RINGS,
  bullseyeTotal,
  settleBet,
  type Bet,
  type BullseyeRound,
} from "./bullseye";
import { challengeOutcome, type ChallengeOutcome } from "./challenge";

export const BULLSEYE_CHALLENGE_PARAM = "challenge";

/** No two places on Earth are more than half its circumference apart. */
const MAX_KM = 20_050;

export interface BullseyeChallenge {
  /** The game's five photos, in the order the sender was shown them. */
  ids: string[];
  /** The sender's ring on each, an index into `RINGS`. */
  rings: number[];
  /** How far the sender's pin landed from each photo, in whole kilometres. */
  km: number[];
}

export type BullseyeChallengeParse =
  | { ok: true; challenge: BullseyeChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9-]{1,32}$/;
const RING_DIGITS = new RegExp(`^[1-${RINGS.length}]{${BULLSEYE_PHOTOS}}$`);
const KM = /^(0|[1-9][0-9]{0,4})$/;

export function encodeBullseyeChallenge(c: BullseyeChallenge): string {
  return `${c.ids.join(".")}_${c.rings.map((r) => r + 1).join("")}_${c.km.join(".")}`;
}

/**
 * Read a `?challenge=` value: five different photos the deck deals, a ring key for each and a
 * whole number of kilometres for each, no more than half the Earth's circumference.
 */
export function parseBullseyeChallenge(
  value: string,
  dealt: readonly string[],
): BullseyeChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 3) return malformed;
  const [idPart, ringPart, kmPart] = parts;
  const ids = idPart.split(".");
  const kms = kmPart.split(".");
  if (
    ids.length !== BULLSEYE_PHOTOS ||
    !ids.every((id) => ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    !RING_DIGITS.test(ringPart) ||
    kms.length !== BULLSEYE_PHOTOS ||
    !kms.every((k) => KM.test(k) && Number(k) <= MAX_KM)
  ) {
    return malformed;
  }
  const deck = new Set(dealt);
  if (!ids.every((id) => deck.has(id))) return { ok: false, reason: "missing" };
  return {
    ok: true,
    challenge: { ids, rings: [...ringPart].map((d) => Number(d) - 1), km: kms.map(Number) },
  };
}

/**
 * The challenge a whole game makes: its photos, your ring on each and how far off each pin was,
 * rounded up to the kilometre so every ring keeps its verdict.
 */
export function bullseyeChallengeFrom(results: readonly BullseyeRound[]): BullseyeChallenge {
  return {
    ids: results.map((r) => r.id),
    rings: results.map((r) => r.you.ring),
    km: results.map((r) => Math.min(MAX_KM, Math.ceil(r.you.km - 1e-9))),
  };
}

/** The page's address with only the challenge in its query. */
export function bullseyeChallengeUrl(href: string, c: BullseyeChallenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${BULLSEYE_CHALLENGE_PARAM}=${encodeBullseyeChallenge(c)}`;
}

// The link carries no pin; a friend's bet is only ever read for its ring, distance and points.
const NOWHERE: LngLat = { lng: 0, lat: 0 };

/** The sender's bet on the photo at `i`, settled by the game's rule, or null past the end. */
export function bullseyeFriendBet(c: BullseyeChallenge, i: number): Bet | null {
  const ring = c.rings[i];
  const km = c.km[i];
  return ring === undefined || km === undefined ? null : settleBet(NOWHERE, ring, km);
}

const friendBets = (c: BullseyeChallenge): Bet[] => c.ids.map((_, i) => bullseyeFriendBet(c, i)!);

/** The sender's points over the photos before `upTo` (all five by default). */
export function bullseyeChallengeScore(c: BullseyeChallenge, upTo = c.ids.length): number {
  return friendBets(c)
    .slice(0, upTo)
    .reduce((sum, b) => sum + b.score, 0);
}

/** How many of the sender's rings held their photo. */
export function bullseyeChallengeHeld(c: BullseyeChallenge): number {
  return friendBets(c).filter((b) => b.inside).length;
}

/** How a whole game did against the challenge it answered. */
export function bullseyeChallengeOutcome(
  results: readonly BullseyeRound[],
  c: BullseyeChallenge,
): ChallengeOutcome {
  return challengeOutcome(bullseyeTotal(results), bullseyeChallengeScore(c));
}

const held = (results: readonly BullseyeRound[]) => results.filter((r) => r.you.inside).length;

/**
 * The message that goes with the link: the points and rings held, and when the game was itself
 * a challenge, how it went against the friend's. Numbers only, so it names no place.
 */
export function bullseyeChallengeText(
  results: readonly BullseyeRound[],
  href: string,
  answering?: BullseyeChallenge,
): string {
  const you = bullseyeTotal(results);
  const lines = [
    `Whereabout · Bullseye: ${formatPoints(you)} points, ${held(results)} of ${results.length} rings held.`,
  ];
  if (answering) {
    const theirs = formatPoints(bullseyeChallengeScore(answering));
    const outcome = bullseyeChallengeOutcome(results, answering);
    lines.push(
      outcome === "won"
        ? `That beats your ${theirs}. Your turn to bet.`
        : outcome === "lost"
          ? `Your ${theirs} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same five photos: how tight a ring dare you bet?");
  }
  lines.push(bullseyeChallengeUrl(href, bullseyeChallengeFrom(results)));
  return lines.join("\n");
}

/** "You beat your friend's 1,750 by 250.", from the finished game and the challenge. */
export function bullseyeChallengeLine(
  results: readonly BullseyeRound[],
  c: BullseyeChallenge,
): string {
  const you = bullseyeTotal(results);
  const theirs = bullseyeChallengeScore(c);
  const outcome = challengeOutcome(you, theirs);
  if (outcome === "won") {
    return `You beat your friend's ${formatPoints(theirs)} by ${formatPoints(you - theirs)}.`;
  }
  if (outcome === "lost") {
    return `Your friend's ${formatPoints(theirs)} wins, by ${formatPoints(theirs - you)}.`;
  }
  return `A dead heat: you both scored ${formatPoints(you)}.`;
}

/** "500 · 750 km": a row's points and the ring they were bet on, in the player's units. */
function betCell(b: Bet, units: Units): string {
  return `${formatPoints(b.score)} · ${formatDistance(RINGS[b.ring]!.km, units)}`;
}

/**
 * The head-to-head of a Bullseye challenge: each side's points on each photo and the ring they
 * bet, never the photo, its place or a pin. More points take a photo, and the game, as the end
 * screen says.
 */
export function bullseyeHeadToHead(
  results: readonly BullseyeRound[],
  c: BullseyeChallenge,
  url: string,
  units: Units = "km",
): HeadToHead {
  const you = bullseyeTotal(results);
  const theirs = bullseyeChallengeScore(c);
  return {
    game: "Bullseye",
    youTotal: `${formatPoints(you)} pts`,
    friendTotal: `${formatPoints(theirs)} pts`,
    outcome: challengeOutcome(you, theirs),
    rows: results.map((r, i) => {
      const them = bullseyeFriendBet(c, i)!;
      return {
        label: `Photo ${i + 1}`,
        you: betCell(r.you, units),
        friend: betCell(them, units),
        winner: rowWinner(r.you.score, them.score),
      };
    }),
    url,
  };
}
