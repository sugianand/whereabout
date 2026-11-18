/**
 * Challenge a friend to What's on the ground?: a link that deals a friend the very same five
 * photos, in the same order, with the sender's call on each, shown to the friend once they have
 * made theirs.
 *
 * The link names the five photos and the sender's five calls as one letter a cover, the same
 * letters a Clue mix link writes for the ground (`b` built-up, `t` trees, `g` grassland, `w`
 * water, `s` bare ground), e.g. `/on-the-ground?challenge=wm077.wm003.wm104.wh012.wm150_btgws`.
 * The score to beat is never carried: it is worked out from those calls against each photo's own
 * WorldCover label, so a link can't claim a score its calls didn't earn. The link names no place;
 * it does carry the sender's calls, which is what lets the friend see them photo by photo, so a
 * friend who decodes the letters learns only what the sender guessed. Nothing is stored: the
 * challenge lives in the address.
 */

import { rowWinner, type HeadToHead } from "@/lib/headToHead";
import { GROUND_COVERS, type GroundCover } from "@/lib/trueClues";

import { challengeOutcome, type ChallengeOutcome } from "./challenge";
import { GROUND_PHOTOS, type GroundMap, type GroundResult } from "./onTheGround";

export const GROUND_CHALLENGE_PARAM = "challenge";

/** Each cover's letter in a link, shared with Clue mix's links for the ground. */
export const GROUND_LETTER = {
  "Built-up": "b",
  "Tree cover": "t",
  Grassland: "g",
  "Permanent water bodies": "w",
  "Bare / sparse vegetation": "s",
} as const satisfies Record<GroundCover, string>;

const LETTER_COVER: Record<string, GroundCover> = Object.fromEntries(
  GROUND_COVERS.map((cover) => [GROUND_LETTER[cover], cover]),
);

export interface GroundChallenge {
  /** The game's five photos, in the order the sender was shown them. */
  ids: string[];
  /** The sender's call on each, in the same order. */
  calls: GroundCover[];
}

export type GroundChallengeParse =
  | { ok: true; challenge: GroundChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9-]{1,32}$/;
const CALLS = new RegExp(
  `^[${GROUND_COVERS.map((c) => GROUND_LETTER[c]).join("")}]{${GROUND_PHOTOS}}$`,
);

export function encodeGroundChallenge(c: GroundChallenge): string {
  return `${c.ids.join(".")}_${c.calls.map((cover) => GROUND_LETTER[cover]).join("")}`;
}

/**
 * Read a `?challenge=` value: five different photos What's on the ground? can deal (an own key of
 * the bundled covers) and a cover's letter for each.
 */
export function parseGroundChallenge(value: string, covers: GroundMap): GroundChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 2) return malformed;
  const [idPart, callPart] = parts;
  const ids = idPart.split(".");
  if (
    ids.length !== GROUND_PHOTOS ||
    !ids.every((id) => ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    !CALLS.test(callPart)
  ) {
    return malformed;
  }
  if (!ids.every((id) => Object.hasOwn(covers, id))) return { ok: false, reason: "missing" };
  return { ok: true, challenge: { ids, calls: [...callPart].map((l) => LETTER_COVER[l]) } };
}

/** The challenge a whole game makes: its photos and your call on each. */
export function groundChallengeFrom(results: readonly GroundResult[]): GroundChallenge {
  return { ids: results.map((r) => r.id), calls: results.map((r) => r.picked) };
}

/** The page's address with only the challenge in its query. */
export function groundChallengeUrl(href: string, c: GroundChallenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${GROUND_CHALLENGE_PARAM}=${encodeGroundChallenge(c)}`;
}

/** Whether the sender's call on the photo at `i` was right, by the photo's own label. */
export function groundFriendRight(c: GroundChallenge, i: number, covers: GroundMap): boolean {
  return covers[c.ids[i]] === c.calls[i];
}

/** The sender's score: their calls that match the photos' own labels. */
export function groundChallengeScore(c: GroundChallenge, covers: GroundMap): number {
  return c.ids.filter((_, i) => groundFriendRight(c, i, covers)).length;
}

/** The sender's call on the photo at `i`, or null past the end. */
export function groundFriendCall(c: GroundChallenge, i: number): GroundCover | null {
  return c.calls[i] ?? null;
}

/** How a whole game did against the challenge it answered. */
export function groundChallengeOutcome(
  right: number,
  c: GroundChallenge,
  covers: GroundMap,
): ChallengeOutcome {
  return challengeOutcome(right, groundChallengeScore(c, covers));
}

const tally = (results: readonly GroundResult[]) => results.filter((r) => r.correct).length;

/**
 * The message that goes with the link: the score, and when the game was itself a challenge, how
 * it went against the friend's. A score only, so it names no place and no cover.
 */
export function groundChallengeText(
  results: readonly GroundResult[],
  href: string,
  covers: GroundMap,
  answering?: GroundChallenge,
): string {
  const right = tally(results);
  const lines = [
    `Whereabout · What's on the ground?: I named ${right} of ${results.length} covers right.`,
  ];
  if (answering) {
    const theirs = groundChallengeScore(answering, covers);
    const outcome = groundChallengeOutcome(right, answering, covers);
    lines.push(
      outcome === "won"
        ? `That beats your ${theirs}. Your turn to read the ground.`
        : outcome === "lost"
          ? `Your ${theirs} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same five photos: built-up, trees, grassland, water or bare ground?");
  }
  lines.push(groundChallengeUrl(href, groundChallengeFrom(results)));
  return lines.join("\n");
}

/** "You beat your friend's 3 of 5 by 1.", from the finished score and the challenge. */
export function groundChallengeLine(right: number, c: GroundChallenge, covers: GroundMap): string {
  const theirs = groundChallengeScore(c, covers);
  const of = `${theirs} of ${c.ids.length}`;
  const outcome = groundChallengeOutcome(right, c, covers);
  if (outcome === "won") return `You beat your friend's ${of} by ${right - theirs}.`;
  if (outcome === "lost") return `Your friend's ${of} wins, by ${theirs - right}.`;
  return `A dead heat: you both named ${of}.`;
}

/**
 * The head-to-head of a What's on the ground? challenge: right or wrong on each photo for both of
 * you, never the photo, its place or either call. More right takes the game, as the end screen
 * says.
 */
export function groundHeadToHead(
  results: readonly GroundResult[],
  c: GroundChallenge,
  covers: GroundMap,
  url: string,
): HeadToHead {
  const right = tally(results);
  const theirs = groundChallengeScore(c, covers);
  const word = (ok: boolean) => (ok ? "Right" : "Wrong");
  return {
    game: "What's on the ground?",
    youTotal: `${right} of ${results.length}`,
    friendTotal: `${theirs} of ${c.ids.length}`,
    outcome: challengeOutcome(right, theirs),
    rows: results.map((r, i) => {
      const them = groundFriendRight(c, i, covers);
      return {
        label: `Photo ${i + 1}`,
        you: word(r.correct),
        friend: word(them),
        winner: r.correct === them ? (r.correct ? "none" : "tie") : rowWinner(+r.correct, +them),
      };
    }),
    url,
  };
}
