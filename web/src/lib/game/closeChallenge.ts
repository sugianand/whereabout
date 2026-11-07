/**
 * Challenge a friend to a Close-up: a link that deals a friend the very same five photos, with the
 * same four names on each, and the points the sender made on every photo to beat.
 *
 * A game is its five photos and its seed (the seed settles each photo's names through
 * `nameSeed`), so the link carries exactly those and the sender's points, e.g.
 * `/close-up?challenge=wm077.wm003.wm104.wh012.wm020_1z141z3_3.2.0.1.3`. The photos are named, not
 * re-dealt from the seed, so a link keeps dealing the same photos as the catalog grows. It carries
 * ids and points only, never a place or a country, so it spoils nothing. Nothing is stored: the
 * whole challenge lives in the address. The points are whatever the link says (a friendly game,
 * not a leaderboard), but each must be one a photo can score.
 */

import { challengeOutcome, sumScores, type ChallengeOutcome } from "./challenge";
import { CLOSE_PHOTOS, CLOSE_POINTS, closeTotals, type CloseResult } from "./closeUp";

export const CLOSE_CHALLENGE_PARAM = "challenge";

export interface CloseChallenge {
  /** The photos to play, in order. */
  ids: string[];
  /** The game's seed: with a photo's id, it settles that photo's four names. */
  seed: number;
  /** The sender's points on each photo, in the same order. */
  points: number[];
}

export type CloseChallengeParse =
  | { ok: true; challenge: CloseChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9-]{1,32}$/;
const SEED = /^[0-9a-z]{1,7}$/;
const POINT = /^\d$/;

export function encodeCloseChallenge(c: CloseChallenge): string {
  return `${c.ids.join(".")}_${c.seed.toString(36)}_${c.points.join(".")}`;
}

/**
 * Read a `?challenge=` value: five different photos Close-up can deal, a seed that fits in 32 bits,
 * and five points a photo can score.
 */
export function parseCloseChallenge(
  value: string,
  dealable: readonly string[],
): CloseChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 3) return malformed;
  const [idPart, seedPart, pointPart] = parts;
  const ids = idPart.split(".");
  const rawPoints = pointPart.split(".");
  if (
    ids.length !== CLOSE_PHOTOS ||
    rawPoints.length !== CLOSE_PHOTOS ||
    !ids.every((id) => ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    !SEED.test(seedPart) ||
    !rawPoints.every((p) => POINT.test(p))
  ) {
    return malformed;
  }
  const seed = parseInt(seedPart, 36);
  const points = rawPoints.map(Number);
  if (seed >= 2 ** 32 || points.some((p) => p > CLOSE_POINTS[0])) return malformed;
  const known = new Set(dealable);
  if (!ids.every((id) => known.has(id))) return { ok: false, reason: "missing" };
  return { ok: true, challenge: { ids, seed, points } };
}

/** The challenge a finished game makes: its photos, its seed and the player's points on each. */
export function closeChallengeFrom(results: readonly CloseResult[], seed: number): CloseChallenge {
  return { ids: results.map((r) => r.id), seed, points: results.map((r) => r.points) };
}

/** The page's address with only the challenge in its query. */
export function closeChallengeUrl(href: string, c: CloseChallenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${CLOSE_CHALLENGE_PARAM}=${encodeCloseChallenge(c)}`;
}

/** The friend's total, the score to beat. */
export function challengeTotal(c: CloseChallenge): number {
  return sumScores(c.points);
}

/** How a finished game did against the challenge it answered. */
export function closeChallengeOutcome(
  results: readonly CloseResult[],
  c: CloseChallenge,
): ChallengeOutcome {
  return challengeOutcome(closeTotals(results).you, challengeTotal(c));
}

/**
 * The message that goes with the link: the points, and when the game was itself a challenge, how
 * it went against the friend's. Points only, so it names no place.
 */
export function closeChallengeText(
  results: readonly CloseResult[],
  seed: number,
  href: string,
  answering?: CloseChallenge,
): string {
  const { you } = closeTotals(results);
  const lines = [
    `Whereabout · Close-up: I named these five crops for ${you} of ${results.length * CLOSE_POINTS[0]} points.`,
  ];
  if (answering) {
    const outcome = closeChallengeOutcome(results, answering);
    lines.push(
      outcome === "won"
        ? `That beats your ${challengeTotal(answering)}. Your turn to beat mine.`
        : outcome === "lost"
          ? `Your ${challengeTotal(answering)} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same photos, same names: can you beat me?");
  }
  lines.push(closeChallengeUrl(href, closeChallengeFrom(results, seed)));
  return lines.join("\n");
}

/** "You won the challenge by 2 points.", from the finished game and the friend's points. */
export function closeChallengeLine(results: readonly CloseResult[], c: CloseChallenge): string {
  const gap = Math.abs(closeTotals(results).you - challengeTotal(c));
  const by = `${gap} point${gap === 1 ? "" : "s"}`;
  const outcome = closeChallengeOutcome(results, c);
  if (outcome === "won") return `You won the challenge by ${by}.`;
  if (outcome === "lost") return `Your friend won by ${by}.`;
  return "A dead heat with your friend.";
}
