/**
 * Challenge a friend to Which climate?: a link that deals a friend the very same five photos, in
 * the same order, with the sender's call on each, shown to the friend once they have made theirs.
 *
 * The link names the five photos and the sender's five calls as Köppen's own letters (A tropical,
 * B arid, C temperate, D continental, E polar), e.g.
 * `/which-climate?challenge=wm077.wm003.wm104.wh012.wm150_CDACB`. The score to beat is never
 * carried: it is worked out from those calls against each photo's own climate label, so a link
 * can't claim a score its calls didn't earn. The link names no place; it does carry the sender's
 * calls, which is what lets the friend see them photo by photo, so a friend who decodes the
 * letters learns only what the sender guessed. Nothing is stored: the challenge lives in the
 * address.
 */

import { rowWinner, type HeadToHead } from "@/lib/headToHead";
import { CLIMATE_GROUPS, type ClimateGroup } from "@/lib/trueClues";

import { challengeOutcome, type ChallengeOutcome } from "./challenge";
import { CLIMATE_PHOTOS, type ClimateMap, type ClimateResult } from "./whichClimate";

export const CLIMATE_CHALLENGE_PARAM = "challenge";

/** Köppen's letter for each group, in `CLIMATE_GROUPS` order: A to E. */
export const KOPPEN_LETTER: Record<ClimateGroup, string> = Object.fromEntries(
  CLIMATE_GROUPS.map((group, i) => [group, "ABCDE"[i]]),
) as Record<ClimateGroup, string>;

const LETTER_GROUP: Record<string, ClimateGroup> = Object.fromEntries(
  CLIMATE_GROUPS.map((group) => [KOPPEN_LETTER[group], group]),
);

export interface ClimateChallenge {
  /** The game's five photos, in the order the sender was shown them. */
  ids: string[];
  /** The sender's call on each, in the same order. */
  calls: ClimateGroup[];
}

export type ClimateChallengeParse =
  | { ok: true; challenge: ClimateChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9-]{1,32}$/;
const CALLS = new RegExp(`^[A-E]{${CLIMATE_PHOTOS}}$`);

export function encodeClimateChallenge(c: ClimateChallenge): string {
  return `${c.ids.join(".")}_${c.calls.map((g) => KOPPEN_LETTER[g]).join("")}`;
}

/**
 * Read a `?challenge=` value: five different photos Which climate? can deal (an own key of the
 * bundled groups) and a call from A to E on each.
 */
export function parseClimateChallenge(value: string, groups: ClimateMap): ClimateChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 2) return malformed;
  const [idPart, callPart] = parts;
  const ids = idPart.split(".");
  if (
    ids.length !== CLIMATE_PHOTOS ||
    !ids.every((id) => ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    !CALLS.test(callPart)
  ) {
    return malformed;
  }
  if (!ids.every((id) => Object.hasOwn(groups, id))) return { ok: false, reason: "missing" };
  return { ok: true, challenge: { ids, calls: [...callPart].map((l) => LETTER_GROUP[l]) } };
}

/** The challenge a whole game makes: its photos and your call on each. */
export function climateChallengeFrom(results: readonly ClimateResult[]): ClimateChallenge {
  return { ids: results.map((r) => r.id), calls: results.map((r) => r.picked) };
}

/** The page's address with only the challenge in its query. */
export function climateChallengeUrl(href: string, c: ClimateChallenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${CLIMATE_CHALLENGE_PARAM}=${encodeClimateChallenge(c)}`;
}

/** Whether the sender's call on the photo at `i` was right, by the photo's own label. */
export function friendRight(c: ClimateChallenge, i: number, groups: ClimateMap): boolean {
  return groups[c.ids[i]] === c.calls[i];
}

/** The sender's score: their calls that match the photos' own labels. */
export function climateChallengeScore(c: ClimateChallenge, groups: ClimateMap): number {
  return c.ids.filter((_, i) => friendRight(c, i, groups)).length;
}

/** The friend's call on the photo at `i`, once the player has called it too. */
export function friendCall(c: ClimateChallenge, i: number): ClimateGroup | null {
  return c.calls[i] ?? null;
}

/** How a whole game did against the challenge it answered. */
export function climateChallengeOutcome(
  right: number,
  c: ClimateChallenge,
  groups: ClimateMap,
): ChallengeOutcome {
  return challengeOutcome(right, climateChallengeScore(c, groups));
}

const tally = (results: readonly ClimateResult[]) => results.filter((r) => r.correct).length;

/**
 * The message that goes with the link: the score, and when the game was itself a challenge, how
 * it went against the friend's. A score only, so it names no place and no climate.
 */
export function climateChallengeText(
  results: readonly ClimateResult[],
  href: string,
  groups: ClimateMap,
  answering?: ClimateChallenge,
): string {
  const right = tally(results);
  const lines = [
    `Whereabout · Which climate?: I named ${right} of ${results.length} climates right.`,
  ];
  if (answering) {
    const theirs = climateChallengeScore(answering, groups);
    const outcome = climateChallengeOutcome(right, answering, groups);
    lines.push(
      outcome === "won"
        ? `That beats your ${theirs}. Your turn to read the weather.`
        : outcome === "lost"
          ? `Your ${theirs} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same five photos: tropical, arid, temperate, continental or polar?");
  }
  lines.push(climateChallengeUrl(href, climateChallengeFrom(results)));
  return lines.join("\n");
}

/** "You beat your friend's 3 of 5 by 1.", from the finished score and the challenge. */
export function climateChallengeLine(
  right: number,
  c: ClimateChallenge,
  groups: ClimateMap,
): string {
  const theirs = climateChallengeScore(c, groups);
  const of = `${theirs} of ${c.ids.length}`;
  const outcome = climateChallengeOutcome(right, c, groups);
  if (outcome === "won") return `You beat your friend's ${of} by ${right - theirs}.`;
  if (outcome === "lost") return `Your friend's ${of} wins, by ${theirs - right}.`;
  return `A dead heat: you both named ${of}.`;
}

/**
 * The head-to-head of a Which climate? challenge: right or wrong on each photo for both of you,
 * never the photo, its place or either call. More right takes the game, as the end screen says.
 */
export function climateHeadToHead(
  results: readonly ClimateResult[],
  c: ClimateChallenge,
  groups: ClimateMap,
  url: string,
): HeadToHead {
  const right = tally(results);
  const theirs = climateChallengeScore(c, groups);
  const word = (ok: boolean) => (ok ? "Right" : "Wrong");
  return {
    game: "Which climate?",
    youTotal: `${right} of ${results.length}`,
    friendTotal: `${theirs} of ${c.ids.length}`,
    outcome: challengeOutcome(right, theirs),
    rows: results.map((r, i) => {
      const them = friendRight(c, i, groups);
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
