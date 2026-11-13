/**
 * Challenge a friend to Left or right?: a link that deals a friend the very same photos, in the
 * same order, with the run the sender made to beat and the call that ended it.
 *
 * The link names the photos the sender was shown, up to and including the one that ended the
 * run, with the run's seed and its streak, e.g. `/left-right?challenge=wm077.wm003.wm104_1z141z3_2`.
 * The friend plays those photos first, in that order; a friend who gets past the sender's miss
 * plays on through the photos left, dealt evenly from both sides by the same seed
 * (`leftRightOrder`), so a run is never cut short at the number to beat and calling one side is
 * still a coin flip.
 *
 * The sender's call on the photo that ended the run needs no room in the link: there are only two
 * sides, so a wrong call was the side they don't drive on, which the reveal shows once the friend
 * has called it. The link carries ids and counts only, never a place or a side, so it spoils
 * nothing; nothing is stored, the whole challenge lives in the address.
 *
 * A long run would make a long address, so a link names at most `SIDE_CHALLENGE_PHOTOS`; a run
 * past that carries its first photos and the streak, with no miss to show, and the friend plays
 * on from the seed.
 */

import type { DrivingSide } from "@/lib/drivingSides";
import { runHeadToHead, type HeadToHead } from "@/lib/headToHead";

import { challengeOutcome, type ChallengeOutcome } from "./challenge";
import { leftRightOrder, type SideMap } from "./leftRight";

export const SIDE_CHALLENGE_PARAM = "challenge";

/** The most photos a link names, so the address stays one people can send. */
export const SIDE_CHALLENGE_PHOTOS = 60;

export interface SideChallenge {
  /** The photos the sender was shown, in order: the one that ended the run last, if it fits. */
  ids: string[];
  /** The run's seed: it deals the photos left for a friend who gets further. */
  seed: number;
  /** The sender's streak: photos called right in a row. */
  streak: number;
}

export type SideChallengeParse =
  | { ok: true; challenge: SideChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9-]{1,32}$/;
const SEED = /^[0-9a-z]{1,7}$/;
const COUNT = /^\d{1,4}$/;

export function encodeSideChallenge(c: SideChallenge): string {
  return `${c.ids.join(".")}_${c.seed.toString(36)}_${c.streak}`;
}

/**
 * True when the link shows the photo that ended the sender's run: its last. A run that called
 * every photo it names (every photo the deal had, or a full link it went past) has no miss.
 */
export function endsOnMiss(c: SideChallenge): boolean {
  return c.streak === c.ids.length - 1;
}

/**
 * Read a `?challenge=` value: one to `SIDE_CHALLENGE_PHOTOS` different photos Left or right? can
 * deal, a seed that fits in 32 bits, and a streak those photos could give: one short of them (the
 * last was the miss), all of them (the run called every photo), or, from a full link, more.
 */
export function parseSideChallenge(value: string, sides: SideMap): SideChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 3) return malformed;
  const [idPart, seedPart, streakPart] = parts;
  const ids = idPart.split(".");
  if (
    ids.length < 1 ||
    ids.length > SIDE_CHALLENGE_PHOTOS ||
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
    streak === ids.length - 1 ||
    streak === ids.length ||
    (ids.length === SIDE_CHALLENGE_PHOTOS && streak >= ids.length);
  if (seed >= 2 ** 32 || !fits) return malformed;
  if (!ids.every((id) => Object.hasOwn(sides, id))) return { ok: false, reason: "missing" };
  return { ok: true, challenge: { ids, seed, streak } };
}

/**
 * The friend's run: the sender's photos first, as they were shown, then the photos left, dealt
 * evenly from both sides by the challenge's seed, for a friend who gets further.
 */
export function sideChallengeOrder(c: SideChallenge, sides: SideMap): string[] {
  const named = new Set(c.ids);
  const rest = Object.fromEntries(Object.entries(sides).filter(([id]) => !named.has(id)));
  return [...c.ids, ...leftRightOrder(rest, c.seed)];
}

/** A finished run, as the link needs it. */
export interface SideRun {
  order: readonly string[];
  /** The photo that ended the run (a miss, or the last photo of a cleared run). */
  index: number;
  seed: number;
  streak: number;
}

/** The challenge a finished run makes: the photos it showed up to `index`, its seed, its streak. */
export function sideChallengeFrom(run: SideRun): SideChallenge {
  return {
    ids: run.order.slice(0, Math.min(run.index + 1, SIDE_CHALLENGE_PHOTOS)),
    seed: run.seed,
    streak: run.streak,
  };
}

/** The page's address with only the challenge in its query. */
export function sideChallengeUrl(href: string, c: SideChallenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${SIDE_CHALLENGE_PARAM}=${encodeSideChallenge(c)}`;
}

/** "1 photo", "4 photos". */
function photos(n: number): string {
  return `${n} photo${n === 1 ? "" : "s"}`;
}

/** How a finished run did against the challenge it answered. */
export function sideChallengeOutcome(streak: number, c: SideChallenge): ChallengeOutcome {
  return challengeOutcome(streak, c.streak);
}

/**
 * The message that goes with the link: the run, and when it was itself a challenge, how it went
 * against the friend's. Counts only, so it names no place and no side.
 */
export function sideChallengeText(run: SideRun, href: string, answering?: SideChallenge) {
  const lines = [`Whereabout · Left or right?: I called ${photos(run.streak)} in a row.`];
  if (answering) {
    const outcome = sideChallengeOutcome(run.streak, answering);
    lines.push(
      outcome === "won"
        ? `That beats your ${answering.streak}. Your turn to read the road.`
        : outcome === "lost"
          ? `Your ${answering.streak} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same photos, same order: which side do they drive on?");
  }
  lines.push(sideChallengeUrl(href, sideChallengeFrom(run)));
  return lines.join("\n");
}

/** "You beat your friend's 3 in a row by 2.", from the finished streak and the challenge. */
export function sideChallengeLine(streak: number, c: SideChallenge): string {
  const gap = Math.abs(streak - c.streak);
  const outcome = sideChallengeOutcome(streak, c);
  if (outcome === "won") return `You beat your friend's ${c.streak} in a row by ${gap}.`;
  if (outcome === "lost") return `Your friend's ${c.streak} in a row wins, by ${gap}.`;
  return `A dead heat: you both called ${photos(c.streak)}.`;
}

/** True on the photo that ended the friend's run, at `index` of the order, when the link shows it. */
export function isFriendMiss(index: number, c: SideChallenge): boolean {
  return endsOnMiss(c) && index === c.ids.length - 1;
}

/**
 * The side the friend called on the photo that ended their run: the side they don't drive on
 * there. Null on any other photo.
 */
export function friendMissCall(
  index: number,
  c: SideChallenge,
  truth: DrivingSide,
): DrivingSide | null {
  if (!isFriendMiss(index, c)) return null;
  return truth === "left" ? "right" : "left";
}

/**
 * The head-to-head of a Left or right? challenge: both runs photo by photo, right, wrong or not
 * reached, never a photo or a side. The longer streak takes it, as the end screen says.
 */
export function sideHeadToHead(run: SideRun, c: SideChallenge, url: string): HeadToHead {
  return runHeadToHead(
    "Left or right?",
    { one: "Photo", many: "Photos" },
    // The run ended on the photo at `index`: past the streak's photos when it was a miss.
    { streak: run.streak, missed: run.index === run.streak },
    { streak: c.streak, missed: endsOnMiss(c) },
    url,
  );
}
