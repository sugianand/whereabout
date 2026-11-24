/**
 * Challenge a friend to Trust Atlas?: a link that deals a friend the very same ten photos, in the
 * same order, with the call the sender made on each, shown to the friend once they have made
 * their own.
 *
 * The link names the ten photos and the sender's call on each as a letter, `t` for trust and `d`
 * for doubt, e.g. `/trust-atlas?challenge=wm077.wm003.…_ttdtdddttd`. Whether a call was right is
 * never carried: each is judged on its photo's real country as that photo's record arrives
 * (`trustFriendResult`, the same `trustResult` the game judges the player with), so a link can't
 * claim calls that weren't right. The link names no place and no country, only photo ids and
 * calls, and nothing is stored: the challenge lives in the address.
 */

import { rowWinner, type HeadToHead } from "@/lib/headToHead";

import { challengeOutcome, type ChallengeOutcome } from "./challenge";
import type { GameRecord } from "./deck";
import {
  TRUST_PHOTOS,
  trustResult,
  trustTotals,
  type TrustCall,
  type TrustResult,
} from "./trustAtlas";

export const TRUST_CHALLENGE_PARAM = "challenge";

export interface TrustChallenge {
  /** The game's ten photos, in the order the sender was shown them. */
  ids: string[];
  /** The sender's call on each. */
  calls: TrustCall[];
}

export type TrustChallengeParse =
  | { ok: true; challenge: TrustChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9-]{1,32}$/;
const CALLS = new RegExp(`^[td]{${TRUST_PHOTOS}}$`);

const LETTER: Record<TrustCall, string> = { trust: "t", doubt: "d" };

export function encodeTrustChallenge(c: TrustChallenge): string {
  return `${c.ids.join(".")}_${c.calls.map((call) => LETTER[call]).join("")}`;
}

/** Read a `?challenge=` value: ten different photos Trust Atlas? deals and a call on each. */
export function parseTrustChallenge(value: string, dealt: readonly string[]): TrustChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 2) return malformed;
  const ids = parts[0].split(".");
  if (
    ids.length !== TRUST_PHOTOS ||
    !ids.every((id) => ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    !CALLS.test(parts[1])
  ) {
    return malformed;
  }
  const deck = new Set(dealt);
  if (!ids.every((id) => deck.has(id))) return { ok: false, reason: "missing" };
  const calls = [...parts[1]].map((c): TrustCall => (c === "t" ? "trust" : "doubt"));
  return { ok: true, challenge: { ids, calls } };
}

/** The challenge a whole game makes: its photos and your call on each. */
export function trustChallengeFrom(results: readonly TrustResult[]): TrustChallenge {
  return { ids: results.map((r) => r.id), calls: results.map((r) => r.call) };
}

/** The page's address with only the challenge in its query. */
export function trustChallengeUrl(href: string, c: TrustChallenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${TRUST_CHALLENGE_PARAM}=${encodeTrustChallenge(c)}`;
}

/**
 * The sender's call on the photo at `i`, judged on that photo's real country, or null when the
 * photo is past the end or its record hasn't arrived yet.
 */
export function trustFriendResult(
  c: TrustChallenge,
  i: number,
  records: ReadonlyMap<string, GameRecord>,
): TrustResult | null {
  const id = c.ids[i];
  const call = c.calls[i];
  if (id === undefined || call === undefined) return null;
  const record = records.get(id);
  return record ? trustResult(record, call) : null;
}

/**
 * The sender's calls over the photos before `upTo` (all ten by default), each judged, or null
 * while any of those photos' records is still loading.
 */
export function trustFriendResults(
  c: TrustChallenge,
  records: ReadonlyMap<string, GameRecord>,
  upTo = c.ids.length,
): TrustResult[] | null {
  const out: TrustResult[] = [];
  for (let i = 0; i < Math.min(upTo, c.ids.length); i++) {
    const r = trustFriendResult(c, i, records);
    if (!r) return null;
    out.push(r);
  }
  return out;
}

/** The sender's calls right over the photos before `upTo`, or null while a record is loading. */
export function trustChallengeScore(
  c: TrustChallenge,
  records: ReadonlyMap<string, GameRecord>,
  upTo = c.ids.length,
): number | null {
  const theirs = trustFriendResults(c, records, upTo);
  return theirs ? trustTotals(theirs).correct : null;
}

/** How a whole game did against the friend's calls, once they are judged. */
export function trustChallengeOutcome(
  results: readonly TrustResult[],
  theirs: readonly TrustResult[],
): ChallengeOutcome {
  return challengeOutcome(trustTotals(results).correct, trustTotals(theirs).correct);
}

/**
 * The message that goes with the link: the calls right beside Atlas's own sureness, and when the
 * game was itself a challenge, how it went against the friend's. Numbers only, so it names no
 * place, no country and no call.
 */
export function trustChallengeText(
  results: readonly TrustResult[],
  href: string,
  answering?: readonly TrustResult[],
): string {
  const { correct, atlasCorrect } = trustTotals(results);
  const n = results.length;
  const lines = [
    `Whereabout · Trust Atlas?: ${correct} of ${n} called right. Atlas's own sureness: ${atlasCorrect} of ${n}.`,
  ];
  if (answering) {
    const theirs = trustTotals(answering).correct;
    const outcome = trustChallengeOutcome(results, answering);
    lines.push(
      outcome === "won"
        ? `That beats your ${theirs}. Your turn to read Atlas.`
        : outcome === "lost"
          ? `Your ${theirs} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same ten photos: can you tell when Atlas is right?");
  }
  lines.push(trustChallengeUrl(href, trustChallengeFrom(results)));
  return lines.join("\n");
}

/** "You beat your friend's 6 of 10 by 2.", from the finished game and the friend's calls. */
export function trustChallengeLine(
  results: readonly TrustResult[],
  theirs: readonly TrustResult[],
): string {
  const you = trustTotals(results).correct;
  const them = trustTotals(theirs).correct;
  const of = `of ${theirs.length}`;
  const outcome = challengeOutcome(you, them);
  if (outcome === "won") return `You beat your friend's ${them} ${of} by ${you - them}.`;
  if (outcome === "lost") return `Your friend's ${them} ${of} wins, by ${them - you}.`;
  return `A dead heat: you both called ${you} ${of} right.`;
}

/** The answer card's line on the friend's call: "Your friend doubted it too: right." */
export function trustFriendLine(yours: TrustResult, theirs: TrustResult): string {
  const verb = theirs.call === "trust" ? "trusted" : "doubted";
  const same = yours.call === theirs.call ? " too" : "";
  return `Your friend ${verb} it${same}: ${theirs.correct ? "called it" : "missed it"}.`;
}

/** "Trusted · right": a call and whether it was right, never the photo's country. */
const callCell = (r: TrustResult) =>
  `${r.call === "trust" ? "Trusted" : "Doubted"} · ${r.correct ? "right" : "wrong"}`;

/**
 * The head-to-head of a Trust Atlas? challenge: each side's call on each photo and whether it was
 * right, never the photo, its place or a country. A right call takes a photo over a wrong one;
 * more calls right take the game.
 */
export function trustHeadToHead(
  results: readonly TrustResult[],
  theirs: readonly TrustResult[],
  url: string,
): HeadToHead {
  const you = trustTotals(results).correct;
  const them = trustTotals(theirs).correct;
  return {
    game: "Trust Atlas?",
    youTotal: `${you} of ${results.length}`,
    friendTotal: `${them} of ${theirs.length}`,
    outcome: challengeOutcome(you, them),
    rows: results.map((r, i) => {
      const t = theirs[i]!;
      return {
        label: `Photo ${i + 1}`,
        you: callCell(r),
        friend: callCell(t),
        winner: rowWinner(Number(r.correct), Number(t.correct)),
      };
    }),
    url,
  };
}
