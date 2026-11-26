/**
 * Challenge a friend to Which fooled Atlas?: a link that deals a friend the very same chain of
 * photos Atlas pinned, pair by pair, with the run the sender made to beat and the pair it ended on.
 *
 * A run is a chain like Further North's, so the link has the same shape
 * (src/lib/game/northChallenge.ts): the photos the sender was shown, up to and including the pair
 * that ended the run, the run's seed and its streak, e.g.
 * `/fooled-atlas?challenge=wm077.wm003.wm104_1z141z3_1`. The friend plays those photos first and,
 * past the sender's miss, the rest of the photos Atlas pinned shuffled by the same seed.
 *
 * The pair that ended the run needs no more in the link: a wrong pick is never a dead heat, so the
 * sender picked the photo Atlas missed by less, and the reveal can show it once the friend has
 * picked. The link carries ids and counts only, never a place or a miss; nothing is stored.
 */

import { runHeadToHead, type HeadToHead } from "@/lib/headToHead";

import { challengeOutcome, type ChallengeOutcome } from "./challenge";
import type { Side } from "./fooledAtlas";
import {
  NORTH_CHALLENGE_PARAM,
  NORTH_CHALLENGE_PHOTOS,
  endsOnMiss,
  isFriendMiss,
  northChallengeFrom,
  northChallengeOrder,
  northChallengeUrl,
  parseNorthChallenge,
  type NorthChallenge,
  type NorthChallengeParse,
} from "./northChallenge";

export const FOOLED_CHALLENGE_PARAM = NORTH_CHALLENGE_PARAM;
/** The most photos a link names, so the address stays one people can send. */
export const FOOLED_CHALLENGE_PHOTOS = NORTH_CHALLENGE_PHOTOS;

/** The photos the sender was shown, the run's seed and its streak. */
export type FooledChallenge = NorthChallenge;
export type FooledChallengeParse = NorthChallengeParse;

/** A finished run, as the link and its message need it. */
export interface FooledRun {
  order: readonly string[];
  /** The pair that ended the run (a miss, or the last pair of a cleared run) starts here. */
  index: number;
  seed: number;
  streak: number;
  /** Pairs Atlas's own pick got right this run, and pairs it played. */
  atlasRight: number;
  atlasPlayed: number;
}

/**
 * Read a `?challenge=` value against the photos Which fooled Atlas? deals: two to
 * `FOOLED_CHALLENGE_PHOTOS` different ones Atlas pinned, a 32-bit seed and a streak they could give.
 */
export function parseFooledChallenge(
  value: string,
  dealable: readonly string[],
): FooledChallengeParse {
  return parseNorthChallenge(value, dealable);
}

/** The friend's chain: the sender's photos as shown, then the rest shuffled by the seed. */
export function fooledChallengeOrder(c: FooledChallenge, dealable: readonly string[]): string[] {
  return northChallengeOrder(c, dealable);
}

/** The challenge a finished run makes: its photos up to the pair at `index`, seed and streak. */
export function fooledChallengeFrom(run: FooledRun): FooledChallenge {
  return northChallengeFrom(run);
}

/** True when the link shows the pair that ended the sender's run. */
export const fooledEndsOnMiss = endsOnMiss;

/** True on the pair (starting at photo `index` of the chain) that ended the friend's run. */
export const isFooledFriendMiss = isFriendMiss;

/**
 * The photo the friend picked on the pair that ended their run: the one Atlas missed by less,
 * since a wrong pick is never a dead heat. `fooled` is the side Atlas really missed by more.
 */
export function friendMissPick(fooled: Side): Side {
  return fooled === "a" ? "b" : "a";
}

/** "1 pair", "4 pairs". */
function pairs(n: number): string {
  return `${n} pair${n === 1 ? "" : "s"}`;
}

/** How a finished run did against the challenge it answered. */
export function fooledChallengeOutcome(streak: number, c: FooledChallenge): ChallengeOutcome {
  return challengeOutcome(streak, c.streak);
}

/**
 * The message that goes with the link: the run beside Atlas's own picks, and when it was itself a
 * challenge, how it went against the friend's. Counts only, so it names no place and no miss.
 */
export function fooledChallengeText(
  run: FooledRun,
  href: string,
  answering?: FooledChallenge,
): string {
  const atlas =
    run.atlasPlayed > 0 ? ` Atlas's own pick: ${run.atlasRight} of ${pairs(run.atlasPlayed)}.` : "";
  const lines = [
    `Whereabout · Which fooled Atlas?: I called ${pairs(run.streak)} in a row.${atlas}`,
  ];
  if (answering) {
    const outcome = fooledChallengeOutcome(run.streak, answering);
    lines.push(
      outcome === "won"
        ? `That beats your ${answering.streak}. Your turn to read Atlas's misses.`
        : outcome === "lost"
          ? `Your ${answering.streak} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same photos, same order: can you tell where Atlas got lost?");
  }
  lines.push(northChallengeUrl(href, fooledChallengeFrom(run)));
  return lines.join("\n");
}

/** "You beat your friend's 3 in a row by 2.", from the finished streak and the challenge. */
export function fooledChallengeLine(streak: number, c: FooledChallenge): string {
  const gap = Math.abs(streak - c.streak);
  const outcome = fooledChallengeOutcome(streak, c);
  if (outcome === "won") return `You beat your friend's ${c.streak} in a row by ${gap}.`;
  if (outcome === "lost") return `Your friend's ${c.streak} in a row wins, by ${gap}.`;
  return `A dead heat: you both called ${pairs(c.streak)}.`;
}

/**
 * The head-to-head of a Which fooled Atlas? challenge: both runs pair by pair, right, wrong or
 * not reached, never a photo, a place or a miss. The longer streak takes it.
 */
export function fooledHeadToHead(run: FooledRun, c: FooledChallenge, url: string): HeadToHead {
  return runHeadToHead(
    "Which fooled Atlas?",
    { one: "Pair", many: "Pairs" },
    // The pair that ended the run starts at `index`: past the streak's pairs when it was a miss.
    { streak: run.streak, missed: run.index === run.streak },
    { streak: c.streak, missed: endsOnMiss(c) },
    url,
  );
}
