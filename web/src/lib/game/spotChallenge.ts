/**
 * Challenge a friend to Spot the clue: a link that deals a friend the very same five photos, in
 * the same order, with the square the sender picked on each, shown to the friend on Atlas's map
 * once they have locked in their own.
 *
 * The link names the five photos and the sender's square on each as its index on the photo's
 * grid, counted from the top left along each row, e.g.
 * `/spot-the-clue?challenge=wm077.wm003.wm104.wh012.wm150_24.3.31.17.40`. The points to beat are
 * never carried: each square is scored against its photo's real "where Atlas looked" map as that
 * photo's record arrives (`spotFriendResult`, the same `spotResult` the game scores the player
 * with), so a link can't claim points its squares didn't earn. A square past the photo's grid
 * scores nothing. The link names no place, only photo ids and squares, and nothing is stored: the
 * challenge lives in the address.
 */

import { rowWinner, type HeadToHead } from "@/lib/headToHead";
import { formatPoints } from "@/lib/geo";

import { challengeOutcome, type ChallengeOutcome } from "./challenge";
import type { GameRecord } from "./deck";
import {
  SPOT_PHOTOS,
  playableLooked,
  spotResult,
  spotTotals,
  spotVerdict,
  type SpotResult,
} from "./spotClue";

export const SPOT_CHALLENGE_PARAM = "challenge";

/** The largest square index a link may carry: a 16 × 16 grid, well past the 7 × 7 maps played. */
const MAX_CELL = 16 * 16 - 1;

export interface SpotChallenge {
  /** The game's five photos, in the order the sender was shown them. */
  ids: string[];
  /** The sender's square on each, as an index on that photo's grid. */
  cells: number[];
}

export type SpotChallengeParse =
  | { ok: true; challenge: SpotChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9-]{1,32}$/;
const CELL = /^(0|[1-9][0-9]{0,2})$/;

export function encodeSpotChallenge(c: SpotChallenge): string {
  return `${c.ids.join(".")}_${c.cells.join(".")}`;
}

/** Read a `?challenge=` value: five different photos Spot the clue deals and a square on each. */
export function parseSpotChallenge(value: string, dealt: readonly string[]): SpotChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 2) return malformed;
  const ids = parts[0].split(".");
  const cells = parts[1].split(".");
  if (
    ids.length !== SPOT_PHOTOS ||
    !ids.every((id) => ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    cells.length !== SPOT_PHOTOS ||
    !cells.every((c) => CELL.test(c) && Number(c) <= MAX_CELL)
  ) {
    return malformed;
  }
  const deck = new Set(dealt);
  if (!ids.every((id) => deck.has(id))) return { ok: false, reason: "missing" };
  return { ok: true, challenge: { ids, cells: cells.map(Number) } };
}

/** The challenge a whole game makes: its photos and your square on each. */
export function spotChallengeFrom(results: readonly SpotResult[]): SpotChallenge {
  return { ids: results.map((r) => r.id), cells: results.map((r) => r.cell) };
}

/** The page's address with only the challenge in its query. */
export function spotChallengeUrl(href: string, c: SpotChallenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${SPOT_CHALLENGE_PARAM}=${encodeSpotChallenge(c)}`;
}

/**
 * The sender's square on the photo at `i`, scored against that photo's map, or null when the
 * photo is past the end or its record (and so its map) hasn't arrived yet.
 */
export function spotFriendResult(
  c: SpotChallenge,
  i: number,
  records: ReadonlyMap<string, GameRecord>,
): SpotResult | null {
  const id = c.ids[i];
  const cell = c.cells[i];
  if (id === undefined || cell === undefined) return null;
  const looked = records.get(id)?.atlas?.looked;
  return playableLooked(looked) ? spotResult(id, looked, cell) : null;
}

/**
 * The sender's squares over the photos before `upTo` (all five by default), each scored, or null
 * while any of those photos' maps is still loading.
 */
export function spotFriendResults(
  c: SpotChallenge,
  records: ReadonlyMap<string, GameRecord>,
  upTo = c.ids.length,
): SpotResult[] | null {
  const out: SpotResult[] = [];
  for (let i = 0; i < Math.min(upTo, c.ids.length); i++) {
    const r = spotFriendResult(c, i, records);
    if (!r) return null;
    out.push(r);
  }
  return out;
}

/** The sender's points over the photos before `upTo`, or null while a map is still loading. */
export function spotChallengeScore(
  c: SpotChallenge,
  records: ReadonlyMap<string, GameRecord>,
  upTo = c.ids.length,
): number | null {
  const theirs = spotFriendResults(c, records, upTo);
  return theirs ? spotTotals(theirs).points : null;
}

/** How a whole game did against the friend's squares, once they are scored. */
export function spotChallengeOutcome(
  results: readonly SpotResult[],
  theirs: readonly SpotResult[],
): ChallengeOutcome {
  return challengeOutcome(spotTotals(results).points, spotTotals(theirs).points);
}

/**
 * The message that goes with the link: the points and Atlas's most telling squares found, and
 * when the game was itself a challenge, how it went against the friend's. Numbers only, so it
 * names no place and no square.
 */
export function spotChallengeText(
  results: readonly SpotResult[],
  href: string,
  answering?: readonly SpotResult[],
): string {
  const { points, hottest } = spotTotals(results);
  const lines = [
    `Whereabout · Spot the clue: ${formatPoints(points)} points, Atlas's most telling square found on ${hottest} of ${results.length}.`,
  ];
  if (answering) {
    const theirs = formatPoints(spotTotals(answering).points);
    const outcome = spotChallengeOutcome(results, answering);
    lines.push(
      outcome === "won"
        ? `That beats your ${theirs}. Your turn to read Atlas.`
        : outcome === "lost"
          ? `Your ${theirs} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same five photos: can you tell what Atlas looked at?");
  }
  lines.push(spotChallengeUrl(href, spotChallengeFrom(results)));
  return lines.join("\n");
}

/** "You beat your friend's 2,400 by 310.", from the finished game and the friend's squares. */
export function spotChallengeLine(
  results: readonly SpotResult[],
  theirs: readonly SpotResult[],
): string {
  const you = spotTotals(results).points;
  const them = spotTotals(theirs).points;
  const outcome = challengeOutcome(you, them);
  if (outcome === "won") {
    return `You beat your friend's ${formatPoints(them)} by ${formatPoints(you - them)}.`;
  }
  if (outcome === "lost") {
    return `Your friend's ${formatPoints(them)} wins, by ${formatPoints(them - you)}.`;
  }
  return `A dead heat: you both scored ${formatPoints(you)}.`;
}

/** "750 · Warm": a square's points and the answer card's verdict on it. */
const squareCell = (r: SpotResult) => `${formatPoints(r.points)} · ${spotVerdict(r)}`;

/**
 * The head-to-head of a Spot the clue challenge: each side's points and verdict on each photo,
 * never the photo, its place or a square's position. More points take a photo, and the game.
 */
export function spotHeadToHead(
  results: readonly SpotResult[],
  theirs: readonly SpotResult[],
  url: string,
): HeadToHead {
  const you = spotTotals(results).points;
  const them = spotTotals(theirs).points;
  return {
    game: "Spot the clue",
    youTotal: `${formatPoints(you)} pts`,
    friendTotal: `${formatPoints(them)} pts`,
    outcome: challengeOutcome(you, them),
    rows: results.map((r, i) => {
      const t = theirs[i]!;
      return {
        label: `Photo ${i + 1}`,
        you: squareCell(r),
        friend: squareCell(t),
        winner: rowWinner(r.points, t.points),
      };
    }),
    url,
  };
}
