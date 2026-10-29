/**
 * Challenge a friend: a link that carries one finished game's five photos and the score the
 * sender made on each, so a friend plays exactly those photos and sees the score to beat.
 *
 * Nothing is stored anywhere: the whole challenge lives in the address, e.g.
 * `?challenge=wm077.wm003.wm104.wh012.wm020_4210.3100.0.5000.1234`. It carries photo ids and
 * points only, never a place, a country or a coordinate, so the link spoils nothing. The scores
 * are whatever the link says (a friendly game, not a leaderboard), but they are checked to be
 * scores the game could have given.
 */
import { MAX_POINTS, formatPoints } from "@/lib/geo";

import { ROUNDS_PER_GAME, totals, type RoundResult } from "./state";

export const CHALLENGE_PARAM = "challenge";

export interface Challenge {
  /** The photos to play, in order. */
  ids: string[];
  /** The sender's points on each photo, in the same order. */
  scores: number[];
}

export type ChallengeParse =
  | { ok: true; challenge: Challenge }
  /** "malformed": not a challenge link at all; "missing": some photos are not in this deck. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9-]{1,32}$/;
const SCORE = /^\d{1,5}$/;

export function encodeChallenge(c: Challenge): string {
  return `${c.ids.join(".")}_${c.scores.join(".")}`;
}

/**
 * Read a `?challenge=` value. A link must name five different photos this deck can deal and
 * five whole scores between 0 and the most a round is worth.
 */
export function parseChallenge(value: string, deckIds: readonly string[]): ChallengeParse {
  const [idPart, scorePart, ...rest] = value.split("_");
  if (idPart === undefined || scorePart === undefined || rest.length > 0) {
    return { ok: false, reason: "malformed" };
  }
  const ids = idPart.split(".");
  const rawScores = scorePart.split(".");
  if (
    ids.length !== ROUNDS_PER_GAME ||
    rawScores.length !== ROUNDS_PER_GAME ||
    !ids.every((id) => ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    !rawScores.every((s) => SCORE.test(s))
  ) {
    return { ok: false, reason: "malformed" };
  }
  const scores = rawScores.map(Number);
  if (scores.some((s) => s > MAX_POINTS)) return { ok: false, reason: "malformed" };
  const known = new Set(deckIds);
  if (!ids.every((id) => known.has(id))) return { ok: false, reason: "missing" };
  return { ok: true, challenge: { ids, scores } };
}

/** The challenge a finished game makes: its photos and the player's points on each. */
export function challengeFrom(results: readonly RoundResult[]): Challenge {
  return {
    ids: results.map((r) => r.round.photo.id),
    scores: results.map((r) => r.reveal.score),
  };
}

/** The game page's address with only the challenge in its query. */
export function challengeUrl(href: string, c: Challenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${CHALLENGE_PARAM}=${encodeChallenge(c)}`;
}

/**
 * The message that goes with the link. When the game was itself a challenge, it answers it:
 * the friend gets told whether they were beaten.
 */
export function challengeText(
  results: readonly RoundResult[],
  href: string,
  answering?: Challenge,
): string {
  const mine = totals(results).player;
  const lines = [`Whereabout: I scored ${formatPoints(mine)} on these five photos.`];
  if (answering) {
    const outcome = challengeOutcome(mine, sumScores(answering.scores));
    lines.push(
      outcome === "won"
        ? "I beat your score. Your turn to beat mine."
        : outcome === "lost"
          ? "You beat me this time. Try again?"
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Can you beat me?");
  }
  lines.push(challengeUrl(href, challengeFrom(results)));
  return lines.join("\n");
}

export type ChallengeOutcome = "won" | "lost" | "tied";

/** How the player did against the friend who sent the challenge. */
export function challengeOutcome(player: number, friend: number): ChallengeOutcome {
  return player > friend ? "won" : player < friend ? "lost" : "tied";
}

export const sumScores = (scores: readonly number[]) => scores.reduce((a, b) => a + b, 0);
