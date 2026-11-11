/**
 * Challenge a friend: a link that carries one finished game's five photos and the score the
 * sender made on each, so a friend plays exactly those photos and sees the score to beat.
 *
 * Nothing is stored anywhere: the whole challenge lives in the address, e.g.
 * `?challenge=wm077.wm003.wm104.wh012.wm020_4210.3100.0.5000.1234`. It carries photo ids and
 * points only, never a place, a country or a coordinate, so the link spoils nothing. The scores
 * are whatever the link says (a friendly game, not a leaderboard), but they are checked to be
 * scores the game could have given.
 *
 * A Blitz game's link adds the seconds the sender had left on each photo's clock, after a `t`:
 * `?challenge=<ids>_<scores>_t12.0.25.3.30`. A friend who opens it plays the same five photos
 * against the same 30-second clock, and sees at each reveal what the sender scored there and
 * with how long to spare (0 means their clock ran out and locked the pin in).
 */
import { MAX_POINTS, formatPoints } from "@/lib/geo";

import { BLITZ_SECONDS } from "./blitz";
import { ROUNDS_PER_GAME, totals, type RoundResult } from "./state";

export const CHALLENGE_PARAM = "challenge";

export interface Challenge {
  /** The photos to play, in order. */
  ids: string[];
  /** The sender's points on each photo, in the same order. */
  scores: number[];
  /**
   * Set for a Blitz challenge: the whole seconds left on the sender's clock as each guess went
   * in, in the same order (0 when time ran out). The friend plays against the same clock.
   */
  secondsLeft?: number[];
}

export type ChallengeParse =
  | { ok: true; challenge: Challenge }
  /** "malformed": not a challenge link at all; "missing": some photos are not in this deck. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9-]{1,32}$/;
const SCORE = /^\d{1,5}$/;
const SECONDS = /^\d{1,2}$/;
/** Marks the part of a Blitz challenge's link that carries the seconds left on each photo. */
const TIMED = "t";

export function encodeChallenge(c: Challenge): string {
  const base = `${c.ids.join(".")}_${c.scores.join(".")}`;
  return c.secondsLeft ? `${base}_${TIMED}${c.secondsLeft.join(".")}` : base;
}

/** True for a Blitz challenge: the friend plays it against the clock. */
export const isTimedChallenge = (c: Challenge): boolean => c.secondsLeft !== undefined;

/** The seconds a Blitz link carries, or null when they aren't five whole seconds on the clock. */
function parseSeconds(part: string): number[] | null {
  if (!part.startsWith(TIMED)) return null;
  const raw = part.slice(TIMED.length).split(".");
  if (raw.length !== ROUNDS_PER_GAME || !raw.every((s) => SECONDS.test(s))) return null;
  const seconds = raw.map(Number);
  return seconds.every((s) => s <= BLITZ_SECONDS) ? seconds : null;
}

/**
 * Read a `?challenge=` value. A link must name five different photos this deck can deal and
 * five whole scores between 0 and the most a round is worth; a Blitz link also five whole
 * seconds between 0 and the clock's 30.
 */
export function parseChallenge(value: string, deckIds: readonly string[]): ChallengeParse {
  const [idPart, scorePart, timedPart, ...rest] = value.split("_");
  if (idPart === undefined || scorePart === undefined || rest.length > 0) {
    return { ok: false, reason: "malformed" };
  }
  const secondsLeft = timedPart === undefined ? undefined : parseSeconds(timedPart);
  if (secondsLeft === null) return { ok: false, reason: "malformed" };
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
  return { ok: true, challenge: { ids, scores, ...(secondsLeft ? { secondsLeft } : {}) } };
}

/**
 * The challenge a finished game makes: its photos and the player's points on each. A Blitz
 * game, whose every round kept the seconds left on its clock, makes a Blitz challenge.
 */
export function challengeFrom(results: readonly RoundResult[]): Challenge {
  const timed = results.length > 0 && results.every((r) => r.secondsLeft !== undefined);
  return {
    ids: results.map((r) => r.round.photo.id),
    scores: results.map((r) => r.reveal.score),
    ...(timed ? { secondsLeft: results.map((r) => r.secondsLeft!) } : {}),
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
  const made = challengeFrom(results);
  const lines = [
    isTimedChallenge(made)
      ? `Whereabout Blitz: I scored ${formatPoints(mine)} on these five photos, ${BLITZ_SECONDS} seconds each.`
      : `Whereabout: I scored ${formatPoints(mine)} on these five photos.`,
  ];
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
  lines.push(challengeUrl(href, made));
  return lines.join("\n");
}

export type ChallengeOutcome = "won" | "lost" | "tied";

/** How the player did against the friend who sent the challenge. */
export function challengeOutcome(player: number, friend: number): ChallengeOutcome {
  return player > friend ? "won" : player < friend ? "lost" : "tied";
}

export const sumScores = (scores: readonly number[]) => scores.reduce((a, b) => a + b, 0);

/**
 * "with 12 seconds left", "with 1 second left" or "as the clock ran out": how long the sender
 * had to spare when a Blitz guess went in.
 */
export function secondsLeftPhrase(seconds: number): string {
  if (seconds <= 0) return "as the clock ran out";
  return `with ${seconds} second${seconds === 1 ? "" : "s"} left`;
}
