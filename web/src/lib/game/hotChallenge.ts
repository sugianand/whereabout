/**
 * Challenge a friend to Hot and cold: a link that deals a friend the very same five photos, with
 * the points the sender made on each and the pin that found its country, to beat.
 *
 * A free game is just its five photos, so the link carries those, the sender's points and the pin
 * each country was found on (0 when three pins missed), e.g.
 * `/hot-cold?challenge=wm077.wm003.wm104.wh012.wm020_5820.3412.0.4980.2210_1.2.0.1.3`. The photos
 * are named, not re-dealt, so a link keeps dealing the same ones as the catalog grows. It carries
 * ids and numbers only, never a place, a country or a pin's position, so it spoils nothing.
 * Nothing is stored: the whole challenge lives in the address. The numbers are whatever the link
 * says (a friendly game, not a leaderboard), but each photo's points must be ones its pin could
 * score: the found pin's bonus plus at most a perfect closest pin.
 */

import { MAX_POINTS, formatPoints } from "@/lib/geo";

import { challengeOutcome, sumScores, type ChallengeOutcome } from "./challenge";
import { HOT_PHOTOS, MAX_PINS, PHOTO_POINTS, PIN_BONUS, hotTotal, type HotRound } from "./hotCold";

export const HOT_CHALLENGE_PARAM = "challenge";

export interface HotChallenge {
  /** The photos to play, in order. */
  ids: string[];
  /** The sender's points on each photo, in the same order. */
  scores: number[];
  /** The pin that found each photo's country, 1 to 3, or 0 when none did. */
  foundOn: number[];
}

export type HotChallengeParse =
  | { ok: true; challenge: HotChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9-]{1,32}$/;
const SCORE = /^\d{1,5}$/;
const PIN = new RegExp(`^[0-${MAX_PINS}]$`);

export function encodeHotChallenge(c: HotChallenge): string {
  return `${c.ids.join(".")}_${c.scores.join(".")}_${c.foundOn.join(".")}`;
}

/** Whether a photo could score `score` with its country found on pin `foundOn` (0: never). */
function couldScore(score: number, foundOn: number): boolean {
  const bonus = foundOn > 0 ? PIN_BONUS[foundOn - 1]! : 0;
  return score >= bonus && score <= MAX_POINTS + bonus;
}

/**
 * Read a `?challenge=` value: five different photos Hot and cold can deal, five whole scores and
 * five found-on pins, each pair a result a photo can give.
 */
export function parseHotChallenge(value: string, dealable: readonly string[]): HotChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 3) return malformed;
  const [idPart, scorePart, pinPart] = parts;
  const ids = idPart.split(".");
  const rawScores = scorePart.split(".");
  const rawPins = pinPart.split(".");
  if (
    ids.length !== HOT_PHOTOS ||
    rawScores.length !== HOT_PHOTOS ||
    rawPins.length !== HOT_PHOTOS ||
    !ids.every((id) => ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    !rawScores.every((s) => SCORE.test(s)) ||
    !rawPins.every((p) => PIN.test(p))
  ) {
    return malformed;
  }
  const scores = rawScores.map(Number);
  const foundOn = rawPins.map(Number);
  if (!scores.every((s, i) => couldScore(s, foundOn[i]!))) return malformed;
  const known = new Set(dealable);
  if (!ids.every((id) => known.has(id))) return { ok: false, reason: "missing" };
  return { ok: true, challenge: { ids, scores, foundOn } };
}

/** The challenge a finished game makes: its photos, and the player's points and pins on each. */
export function hotChallengeFrom(results: readonly HotRound[]): HotChallenge {
  return {
    ids: results.map((r) => r.id),
    scores: results.map((r) => r.score),
    foundOn: results.map((r) => r.foundOn ?? 0),
  };
}

/** The page's address with only the challenge in its query. */
export function hotChallengeUrl(href: string, c: HotChallenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${HOT_CHALLENGE_PARAM}=${encodeHotChallenge(c)}`;
}

/** The friend's total, the score to beat. */
export function hotChallengeTotal(c: HotChallenge): number {
  return sumScores(c.scores);
}

/** How a finished game did against the challenge it answered. */
export function hotChallengeOutcome(
  results: readonly HotRound[],
  c: HotChallenge,
): ChallengeOutcome {
  return challengeOutcome(hotTotal(results), hotChallengeTotal(c));
}

/** How the friend did on one photo: "5,820 points, found on pin 1" or "0 points, not found". */
export function friendPhotoLine(c: HotChallenge, index: number): string {
  const pin = c.foundOn[index]!;
  return `${formatPoints(c.scores[index]!)} points, ${pin > 0 ? `found on pin ${pin}` : "not found"}`;
}

/**
 * The message that goes with the link: the points, how many countries took one pin, and, when the
 * game was itself a challenge, how it went against the friend's. Numbers only, so it names no place.
 */
export function hotChallengeText(
  results: readonly HotRound[],
  href: string,
  answering?: HotChallenge,
): string {
  const you = hotTotal(results);
  const first = results.filter((r) => r.foundOn === 1).length;
  const lines = [
    `Whereabout · Hot and cold: ${formatPoints(you)} of ${formatPoints(results.length * PHOTO_POINTS)} points, ${first} of ${results.length} countries found with the first pin.`,
  ];
  if (answering) {
    const outcome = hotChallengeOutcome(results, answering);
    const theirs = formatPoints(hotChallengeTotal(answering));
    lines.push(
      outcome === "won"
        ? `That beats your ${theirs}. Your turn to beat mine.`
        : outcome === "lost"
          ? `Your ${theirs} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same five photos, three pins each: can you beat me?");
  }
  lines.push(hotChallengeUrl(href, hotChallengeFrom(results)));
  return lines.join("\n");
}

/** "You won the challenge by 1,240 points.", from the finished game and the friend's points. */
export function hotChallengeLine(results: readonly HotRound[], c: HotChallenge): string {
  const gap = Math.abs(hotTotal(results) - hotChallengeTotal(c));
  const by = `${formatPoints(gap)} point${gap === 1 ? "" : "s"}`;
  const outcome = hotChallengeOutcome(results, c);
  if (outcome === "won") return `You won the challenge by ${by}.`;
  if (outcome === "lost") return `Your friend won by ${by}.`;
  return "A dead heat with your friend.";
}
