/**
 * Challenge a friend to Further North: a link that deals a friend the very same chain of photos,
 * pair by pair, with the run the sender made to beat and the pair it ended on.
 *
 * A run is a chain: pair `i` is photos `i` and `i + 1`. The link names the photos the sender was
 * shown, up to and including the pair that ended the run, with the run's seed and its streak,
 * e.g. `/further-north?challenge=wm077.wm003.wm104_1z141z3_1`. The friend plays those photos
 * first, in that order, and a friend who gets past the sender's miss plays on through the rest of
 * the deck shuffled by the same seed, so a run is never cut short at the number to beat.
 *
 * The pair that ended the run needs no more in the link: a wrong pick is never a tie, so the
 * sender picked the photo taken further south, and the reveal can show it once the friend has
 * picked. The link carries ids and counts only, never a place or a latitude, so it spoils
 * nothing; nothing is stored, the whole challenge lives in the address.
 *
 * A long run would make a long address, so a link names at most `NORTH_CHALLENGE_PHOTOS`; a run
 * past that carries its first photos and the streak, with no miss to show, and the friend plays
 * on from the seed.
 */

import { runHeadToHead, type HeadToHead } from "@/lib/headToHead";

import { challengeOutcome, type ChallengeOutcome } from "./challenge";
import { seededShuffle } from "./daily";

export const NORTH_CHALLENGE_PARAM = "challenge";

/** The most photos a link names, so the address stays one people can send. */
export const NORTH_CHALLENGE_PHOTOS = 60;

export interface NorthChallenge {
  /** The photos the sender was shown, in order: the pair that ended the run last, if it fits. */
  ids: string[];
  /** The run's seed: it shuffles the rest of the deck for a friend who gets further. */
  seed: number;
  /** The sender's streak: pairs called right in a row. */
  streak: number;
}

export type NorthChallengeParse =
  | { ok: true; challenge: NorthChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9-]{1,32}$/;
const SEED = /^[0-9a-z]{1,7}$/;
const COUNT = /^\d{1,4}$/;

export function encodeNorthChallenge(c: NorthChallenge): string {
  return `${c.ids.join(".")}_${c.seed.toString(36)}_${c.streak}`;
}

/**
 * True when the link shows the pair that ended the sender's run: its last two photos. A run that
 * called every photo it names (the whole deck, or a full link it went past) has no miss to show.
 */
export function endsOnMiss(c: NorthChallenge): boolean {
  return c.streak === c.ids.length - 2;
}

/**
 * Read a `?challenge=` value: two to `NORTH_CHALLENGE_PHOTOS` different photos Further North can
 * deal, a seed that fits in 32 bits, and a streak those photos could give: two short of them (the
 * last pair was the miss), one short (the run called every pair), or, from a full link, more.
 */
export function parseNorthChallenge(
  value: string,
  dealable: readonly string[],
): NorthChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 3) return malformed;
  const [idPart, seedPart, streakPart] = parts;
  const ids = idPart.split(".");
  if (
    ids.length < 2 ||
    ids.length > NORTH_CHALLENGE_PHOTOS ||
    !ids.every((id) => ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    !SEED.test(seedPart) ||
    !COUNT.test(streakPart)
  ) {
    return malformed;
  }
  const seed = parseInt(seedPart, 36);
  const streak = Number(streakPart);
  const fits =
    streak === ids.length - 2 ||
    streak === ids.length - 1 ||
    (ids.length === NORTH_CHALLENGE_PHOTOS && streak >= ids.length);
  if (seed >= 2 ** 32 || !fits) return malformed;
  const known = new Set(dealable);
  if (!ids.every((id) => known.has(id))) return { ok: false, reason: "missing" };
  return { ok: true, challenge: { ids, seed, streak } };
}

/**
 * The friend's chain: the sender's photos first, as they were shown, then every other dealable
 * photo shuffled by the challenge's seed, for a friend who gets further.
 */
export function northChallengeOrder(c: NorthChallenge, dealable: readonly string[]): string[] {
  const named = new Set(c.ids);
  return [
    ...c.ids,
    ...seededShuffle(
      dealable.filter((id) => !named.has(id)),
      c.seed,
    ),
  ];
}

/** A finished run, as the link needs it. */
export interface NorthRun {
  order: readonly string[];
  /** The pair that ended the run (a miss, or the last pair of a cleared run) starts here. */
  index: number;
  seed: number;
  streak: number;
}

/**
 * The challenge a finished run makes: the photos it showed, up to and including the pair at
 * `index`, its seed and its streak.
 */
export function northChallengeFrom(run: NorthRun): NorthChallenge {
  return {
    ids: run.order.slice(0, Math.min(run.index + 2, NORTH_CHALLENGE_PHOTOS)),
    seed: run.seed,
    streak: run.streak,
  };
}

/** The page's address with only the challenge in its query. */
export function northChallengeUrl(href: string, c: NorthChallenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${NORTH_CHALLENGE_PARAM}=${encodeNorthChallenge(c)}`;
}

/** "1 pair", "4 pairs". */
function pairs(n: number): string {
  return `${n} pair${n === 1 ? "" : "s"}`;
}

/** How a finished run did against the challenge it answered. */
export function northChallengeOutcome(streak: number, c: NorthChallenge): ChallengeOutcome {
  return challengeOutcome(streak, c.streak);
}

/**
 * The message that goes with the link: the run, and when it was itself a challenge, how it went
 * against the friend's. Counts only, so it names no place.
 */
export function northChallengeText(run: NorthRun, href: string, answering?: NorthChallenge) {
  const lines = [`Whereabout · Further North: I called ${pairs(run.streak)} in a row.`];
  if (answering) {
    const outcome = northChallengeOutcome(run.streak, answering);
    lines.push(
      outcome === "won"
        ? `That beats your ${answering.streak}. Your turn to go further.`
        : outcome === "lost"
          ? `Your ${answering.streak} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same photos, same order: can you go further north?");
  }
  lines.push(northChallengeUrl(href, northChallengeFrom(run)));
  return lines.join("\n");
}

/** "You beat your friend's 3 in a row by 2.", from the finished streak and the challenge. */
export function northChallengeLine(streak: number, c: NorthChallenge): string {
  const gap = Math.abs(streak - c.streak);
  const outcome = northChallengeOutcome(streak, c);
  if (outcome === "won") return `You beat your friend's ${c.streak} in a row by ${gap}.`;
  if (outcome === "lost") return `Your friend's ${c.streak} in a row wins, by ${gap}.`;
  return `A dead heat: you both called ${pairs(c.streak)}.`;
}

/**
 * True on the pair that ended the friend's run (it starts at photo `index` of the chain), when
 * the link shows it.
 */
export function isFriendMiss(index: number, c: NorthChallenge): boolean {
  return endsOnMiss(c) && index === c.ids.length - 2;
}

/**
 * The head-to-head of a Further North challenge: both runs pair by pair, right, wrong or not
 * reached, never a photo or a latitude. The longer streak takes it, as the end screen says.
 */
export function northHeadToHead(run: NorthRun, c: NorthChallenge, url: string): HeadToHead {
  return runHeadToHead(
    "Further North",
    { one: "Pair", many: "Pairs" },
    // The pair that ended the run starts at `index`: past the streak's pairs when it was a miss.
    { streak: run.streak, missed: run.index === run.streak },
    { streak: c.streak, missed: endsOnMiss(c) },
    url,
  );
}
