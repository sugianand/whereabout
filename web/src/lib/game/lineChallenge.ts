/**
 * Challenge a friend to Line them up: a link that deals a friend the very same rows, each with its
 * four photos in the very same starting order, and how many the sender had in place on each.
 *
 * A row's photos are carried as they were dealt, not as the sender locked them, so the friend's
 * row opens exactly as the sender's did (`unsorted` turns a dealt row the same way every time) and
 * the link gives nothing of the answer away. Rows are separated by `-` and photos by `.`, then the
 * points per row, e.g. `/line-up?challenge=wm077.wm003.wm104.wh012-…_3.2.4.1.0`. Ids and points
 * only, never a place or a longitude. Nothing is stored: the whole challenge lives in the address.
 * The points are whatever the link says (a friendly game, not a leaderboard), but each must be one
 * a row can score.
 */

import { challengeOutcome, sumScores, type ChallengeOutcome } from "./challenge";
import { ROW, ROWS, linePoints, type RowResult } from "./lineUp";

export const LINE_CHALLENGE_PARAM = "challenge";

export interface LineChallenge {
  /** The rows to play, in order, each with its photos in the order they were dealt. */
  rows: string[][];
  /** The sender's photos in place on each row, in the same order. */
  points: number[];
}

export type LineChallengeParse =
  | { ok: true; challenge: LineChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

// No "-" in an id here: it separates the rows. Catalog ids are letters and digits.
const ID = /^[A-Za-z0-9]{1,32}$/;
const POINT = /^\d$/;

export function encodeLineChallenge(c: LineChallenge): string {
  return `${c.rows.map((row) => row.join(".")).join("-")}_${c.points.join(".")}`;
}

/**
 * Read a `?challenge=` value: one to five rows of four photos Line them up can deal, no photo
 * twice across the game, and for each row a count of photos in place from 0 to 4.
 */
export function parseLineChallenge(
  value: string,
  dealable: readonly string[],
): LineChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 2) return malformed;
  const [rowPart, pointPart] = parts;
  const rows = rowPart.split("-").map((row) => row.split("."));
  const rawPoints = pointPart.split(".");
  const ids = rows.flat();
  if (
    rows.length < 1 ||
    rows.length > ROWS ||
    rawPoints.length !== rows.length ||
    !rows.every((row) => row.length === ROW) ||
    !ids.every((id) => ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    !rawPoints.every((p) => POINT.test(p))
  ) {
    return malformed;
  }
  const points = rawPoints.map(Number);
  if (points.some((p) => p > ROW)) return malformed;
  const known = new Set(dealable);
  if (!ids.every((id) => known.has(id))) return { ok: false, reason: "missing" };
  return { ok: true, challenge: { rows, points } };
}

/** The challenge a finished game makes: its rows as dealt, and the player's points on each. */
export function lineChallengeFrom(
  rows: readonly (readonly string[])[],
  results: readonly RowResult[],
): LineChallenge {
  return {
    rows: rows.slice(0, results.length).map((row) => [...row]),
    points: results.map((r) => r.points),
  };
}

/** The page's address with only the challenge in its query. */
export function lineChallengeUrl(href: string, c: LineChallenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${LINE_CHALLENGE_PARAM}=${encodeLineChallenge(c)}`;
}

/** The friend's total, the score to beat. */
export function lineChallengeTotal(c: LineChallenge): number {
  return sumScores(c.points);
}

/** How a finished game did against the challenge it answered. */
export function lineChallengeOutcome(
  results: readonly RowResult[],
  c: LineChallenge,
): ChallengeOutcome {
  return challengeOutcome(linePoints(results), lineChallengeTotal(c));
}

/**
 * The message that goes with the link: the photos in place, and when the game was itself a
 * challenge, how it went against the friend's. Counts only, so it names no place.
 */
export function lineChallengeText(
  rows: readonly (readonly string[])[],
  results: readonly RowResult[],
  href: string,
  answering?: LineChallenge,
): string {
  const mine = linePoints(results);
  const lines = [
    `Whereabout · Line them up: I put ${mine} of ${results.length * ROW} photos in place, west to east.`,
  ];
  if (answering) {
    const outcome = lineChallengeOutcome(results, answering);
    lines.push(
      outcome === "won"
        ? `That beats your ${lineChallengeTotal(answering)}. Your turn to beat mine.`
        : outcome === "lost"
          ? `Your ${lineChallengeTotal(answering)} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same rows, same start: can you beat me?");
  }
  lines.push(lineChallengeUrl(href, lineChallengeFrom(rows, results)));
  return lines.join("\n");
}

/** "You won the challenge by 2 in place.", from the finished game and the friend's points. */
export function lineChallengeLine(results: readonly RowResult[], c: LineChallenge): string {
  const gap = Math.abs(linePoints(results) - lineChallengeTotal(c));
  const by = `${gap} in place`;
  const outcome = lineChallengeOutcome(results, c);
  if (outcome === "won") return `You won the challenge by ${by}.`;
  if (outcome === "lost") return `Your friend won by ${by}.`;
  return "A dead heat with your friend.";
}
