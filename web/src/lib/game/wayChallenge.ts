/**
 * Challenge a friend to Which way?: a link that deals a friend the very same journey, stop by
 * stop, with the run the sender made to beat and the compass point they picked on the stop that
 * ended it.
 *
 * A journey is a chain: stop `i` sets off from photo `i` toward photo `i + 1`. Photos dealt
 * again because they made no fair question (one city, or nearly opposite sides of the world) are
 * already out of the chain, so the photos the sender was shown are exactly the chain's first
 * ones. The link names them, up to and including the stop that ended the run, with the run's
 * seed, its streak and, when the run ended on a wrong pick, that pick, e.g.
 * `/which-way?challenge=wm077.wm003.wm104_1z141z3_1_SW`. The friend travels those photos first,
 * and a friend who gets past the sender's miss travels on through the rest of the deck shuffled
 * by the same seed, so a run is never cut short at the number to beat.
 *
 * Unlike Further North, a wrong pick here could be any of six points, so it takes room in the
 * link: two letters at most. The link carries ids, counts and that one point, never a place or a
 * heading, so it spoils nothing until the friend has picked. Nothing is stored; the whole
 * challenge lives in the address.
 *
 * A long run would make a long address, so a link names at most `WAY_CHALLENGE_PHOTOS`; a run
 * past that carries its first photos and the streak, with no miss to show, and the friend plays
 * on from the seed.
 */

import { challengeOutcome, type ChallengeOutcome } from "./challenge";
import { seededShuffle } from "./daily";
import { POINTS, POINT_NAMES, judgeWay, type Point } from "./whichWay";

export const WAY_CHALLENGE_PARAM = "challenge";

/** The most photos a link names, so the address stays one people can send. */
export const WAY_CHALLENGE_PHOTOS = 60;

export interface WayChallenge {
  /** The photos the sender was shown, in order: the stop that ended the run last, if it fits. */
  ids: string[];
  /** The run's seed: it shuffles the rest of the deck for a friend who gets further. */
  seed: number;
  /** The sender's streak: stops called right in a row. */
  streak: number;
  /** The sender's wrong pick on the last stop, when the link ends on a miss. */
  miss: Point | null;
}

export type WayChallengeParse =
  | { ok: true; challenge: WayChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9-]{1,32}$/;
const SEED = /^[0-9a-z]{1,7}$/;
const COUNT = /^\d{1,4}$/;

export function encodeWayChallenge(c: WayChallenge): string {
  const base = `${c.ids.join(".")}_${c.seed.toString(36)}_${c.streak}`;
  return c.miss ? `${base}_${c.miss}` : base;
}

/** True when the streak says the link's last stop ended the sender's run. */
function streakEndsOnMiss(streak: number, photos: number): boolean {
  return streak === photos - 2;
}

/**
 * Read a `?challenge=` value: two to `WAY_CHALLENGE_PHOTOS` different photos Which way? can deal,
 * a seed that fits in 32 bits, a streak those photos could give, and a compass point exactly when
 * the streak says the last stop was a miss. The streak is two short of the photos (the last stop
 * was the miss), one short (the run called every stop) or, from a full link, more.
 */
export function parseWayChallenge(value: string, dealable: readonly string[]): WayChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 3 && parts.length !== 4) return malformed;
  const [idPart, seedPart, streakPart, missPart] = parts;
  const ids = idPart.split(".");
  if (
    ids.length < 2 ||
    ids.length > WAY_CHALLENGE_PHOTOS ||
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
    streakEndsOnMiss(streak, ids.length) ||
    streak === ids.length - 1 ||
    (ids.length === WAY_CHALLENGE_PHOTOS && streak >= ids.length);
  if (seed >= 2 ** 32 || !fits) return malformed;
  // A miss is named exactly when the streak stops short of the last stop.
  const miss = missPart === undefined ? null : POINTS.find((p) => p === missPart);
  if (miss === undefined || (miss !== null) !== streakEndsOnMiss(streak, ids.length)) {
    return malformed;
  }
  const known = new Set(dealable);
  if (!ids.every((id) => known.has(id))) return { ok: false, reason: "missing" };
  return { ok: true, challenge: { ids, seed, streak, miss } };
}

/**
 * The friend's journey: the sender's photos first, as they were shown, then every other dealable
 * photo shuffled by the challenge's seed, for a friend who gets further.
 */
export function wayChallengeOrder(c: WayChallenge, dealable: readonly string[]): string[] {
  const named = new Set(c.ids);
  return [
    ...c.ids,
    ...seededShuffle(
      dealable.filter((id) => !named.has(id)),
      c.seed,
    ),
  ];
}

/** A run as the link needs it. */
export interface WayRun {
  /** The journey's photos, with any dealt again already out of it. */
  order: readonly string[];
  /** The stop that ended the run (a miss, or the last stop of a cleared run) sets off here. */
  index: number;
  seed: number;
  streak: number;
  /** The wrong pick that ended the run, or null when it ended by travelling every photo. */
  miss: Point | null;
}

/**
 * The challenge a finished run makes: the photos it showed, up to and including the stop at
 * `index`, its seed, its streak, and the wrong pick when the link reaches it.
 */
export function wayChallengeFrom(run: WayRun): WayChallenge {
  const ids = run.order.slice(0, Math.min(run.index + 2, WAY_CHALLENGE_PHOTOS));
  return {
    ids,
    seed: run.seed,
    streak: run.streak,
    miss: run.miss && streakEndsOnMiss(run.streak, ids.length) ? run.miss : null,
  };
}

/** The page's address with only the challenge in its query. */
export function wayChallengeUrl(href: string, c: WayChallenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${WAY_CHALLENGE_PARAM}=${encodeWayChallenge(c)}`;
}

/** "1 stop", "4 stops". */
function stops(n: number): string {
  return `${n} stop${n === 1 ? "" : "s"}`;
}

/** How a finished run did against the challenge it answered. */
export function wayChallengeOutcome(streak: number, c: WayChallenge): ChallengeOutcome {
  return challengeOutcome(streak, c.streak);
}

/**
 * The message that goes with the link: the run, and when it was itself a challenge, how it went
 * against the friend's. Counts only, so it names no place and no heading.
 */
export function wayChallengeText(run: WayRun, href: string, answering?: WayChallenge): string {
  const lines = [`Whereabout · Which way?: I travelled ${stops(run.streak)} in a row.`];
  if (answering) {
    const outcome = wayChallengeOutcome(run.streak, answering);
    lines.push(
      outcome === "won"
        ? `That beats your ${answering.streak}. Your turn to travel further.`
        : outcome === "lost"
          ? `Your ${answering.streak} wins this time. Try the journey again?`
          : "We tied. Travel it again to break it?",
    );
  } else {
    lines.push("Same photos, same journey: can you find your way further?");
  }
  lines.push(wayChallengeUrl(href, wayChallengeFrom(run)));
  return lines.join("\n");
}

/** "You beat your friend's 3 in a row by 2.", from the finished streak and the challenge. */
export function wayChallengeLine(streak: number, c: WayChallenge): string {
  const gap = Math.abs(streak - c.streak);
  const outcome = wayChallengeOutcome(streak, c);
  if (outcome === "won") return `You beat your friend's ${c.streak} in a row by ${gap}.`;
  if (outcome === "lost") return `Your friend's ${c.streak} in a row wins, by ${gap}.`;
  return `A dead heat: you both travelled ${stops(c.streak)}.`;
}

/**
 * The friend's wrong pick, on the stop that ended their run (setting off from `order[index]`),
 * or null on any other stop. A pick the true `bearing` would count as right can't have ended a
 * run, so a link edited by hand shows nothing rather than a pick that makes no sense.
 */
export function friendMissPick(
  order: readonly string[],
  index: number,
  c: WayChallenge,
  bearing: number,
): Point | null {
  if (!c.miss) return null;
  const n = c.ids.length;
  if (order[index] !== c.ids[n - 2] || order[index + 1] !== c.ids[n - 1]) return null;
  return judgeWay(c.miss, bearing).correct ? null : c.miss;
}

/** "Your friend's run ended here: they set off north-west." */
export function friendMissWords(pick: Point): string {
  return `Your friend's run ended here: they set off ${POINT_NAMES[pick]}.`;
}
