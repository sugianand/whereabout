/**
 * Challenge a friend to Hedge your bets: a link that deals a friend the very same five photos and
 * the same four countries on each, in the same order, with the chips the sender put on each
 * country, shown to the friend once they have placed their own.
 *
 * The four countries a photo offers come from the game's seed and the photo
 * (`hedgeOptions`), so the link carries the seed instead of any country: the seed in base 36,
 * the five photos, and the sender's chips on each photo's options as one character a country
 * (`0` to `9`, `a` for all ten), e.g. `/hedge?challenge=1z141z3_wm077.wm003…_a000.3331.…`.
 *
 * Nothing the bets earned is carried. Each bet is scored again with the game's own `hedgeResult`
 * on its photo's real country as that photo's record arrives (`hedgeFriendResult`), so a link
 * can't claim points its chips didn't win, and a bet that no longer fits the countries the photo
 * now offers marks the challenge stale rather than scoring against the wrong ones. The link names
 * no place and no country, and nothing is stored: the challenge lives in the address.
 */

import { rowWinner, type HeadToHead } from "@/lib/headToHead";
import { formatPoints } from "@/lib/geo";

import { challengeOutcome, type ChallengeOutcome } from "./challenge";
import type { GameRecord } from "./deck";
import {
  CHIPS,
  HEDGE_PHOTOS,
  OPTIONS,
  chipWord,
  hedgeOptions,
  hedgeResult,
  hedgeTotals,
  type HedgeResult,
} from "./hedge";

export const HEDGE_CHALLENGE_PARAM = "challenge";

export interface HedgeChallenge {
  /** The seed that ordered each photo's countries. */
  seed: number;
  /** The game's five photos, in the order the sender was shown them. */
  ids: string[];
  /** The sender's chips on each photo's options, in the order the options were shown. */
  bets: number[][];
}

export type HedgeChallengeParse =
  | { ok: true; challenge: HedgeChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9-]{1,32}$/;
const SEED = /^[0-9a-z]{1,7}$/;
const BET = new RegExp(`^[0-9a]{2,${OPTIONS}}$`);
const DIGITS = "0123456789a";

export function encodeHedgeChallenge(c: HedgeChallenge): string {
  const bets = c.bets.map((chips) => chips.map((n) => DIGITS[n] ?? "0").join(""));
  return `${(c.seed >>> 0).toString(36)}_${c.ids.join(".")}_${bets.join(".")}`;
}

/**
 * Read a `?challenge=` value: a 32-bit seed, five different photos Hedge your bets deals, and a
 * whole bet of ten chips on each.
 */
export function parseHedgeChallenge(value: string, dealt: readonly string[]): HedgeChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 3) return malformed;
  const [seedText, idText, betText] = parts as [string, string, string];
  if (!SEED.test(seedText)) return malformed;
  const seed = parseInt(seedText, 36);
  if (seed > 0xffffffff) return malformed;
  const ids = idText.split(".");
  const rawBets = betText.split(".");
  if (
    ids.length !== HEDGE_PHOTOS ||
    !ids.every((id) => ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    rawBets.length !== ids.length ||
    !rawBets.every((b) => BET.test(b))
  ) {
    return malformed;
  }
  const bets = rawBets.map((b) => [...b].map((ch) => DIGITS.indexOf(ch)));
  if (!bets.every((chips) => chips.reduce((a, n) => a + n, 0) === CHIPS)) return malformed;
  const deck = new Set(dealt);
  if (!ids.every((id) => deck.has(id))) return { ok: false, reason: "missing" };
  return { ok: true, challenge: { seed, ids, bets } };
}

/** The challenge a whole game makes: its seed, its photos and your chips on each. */
export function hedgeChallengeFrom(seed: number, results: readonly HedgeResult[]): HedgeChallenge {
  return {
    seed: seed >>> 0,
    ids: results.map((r) => r.id),
    bets: results.map((r) => [...r.chips]),
  };
}

/** The page's address with only the challenge in its query. */
export function hedgeChallengeUrl(href: string, c: HedgeChallenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${HEDGE_CHALLENGE_PARAM}=${encodeHedgeChallenge(c)}`;
}

/**
 * The sender's bet on the photo at `i`, scored on that photo's real country over the countries it
 * offers for the challenge's seed. Undefined while the record hasn't arrived (or past the end);
 * null when the bet doesn't fit the countries the photo now offers.
 */
export function hedgeFriendResult(
  c: HedgeChallenge,
  i: number,
  records: ReadonlyMap<string, GameRecord>,
): HedgeResult | null | undefined {
  const id = c.ids[i];
  const chips = c.bets[i];
  if (id === undefined || chips === undefined) return undefined;
  const record = records.get(id);
  if (!record) return undefined;
  return hedgeResult(record, hedgeOptions(record, c.seed), chips);
}

/**
 * The sender's bets over the photos before `upTo` (all five by default), each scored; undefined
 * while any of those records is still loading, null once one of them doesn't fit.
 */
export function hedgeFriendResults(
  c: HedgeChallenge,
  records: ReadonlyMap<string, GameRecord>,
  upTo = c.ids.length,
): HedgeResult[] | null | undefined {
  const out: HedgeResult[] = [];
  let loading = false;
  for (let i = 0; i < Math.min(upTo, c.ids.length); i++) {
    const r = hedgeFriendResult(c, i, records);
    if (r === null) return null;
    if (r === undefined) loading = true;
    else out.push(r);
  }
  return loading ? undefined : out;
}

/** The sender's points over the photos before `upTo`; undefined while loading, null if stale. */
export function hedgeChallengeScore(
  c: HedgeChallenge,
  records: ReadonlyMap<string, GameRecord>,
  upTo = c.ids.length,
): number | null | undefined {
  const theirs = hedgeFriendResults(c, records, upTo);
  return theirs ? hedgeTotals(theirs).total : theirs;
}

/** How a whole game did against the friend's bets, once they are scored. */
export function hedgeChallengeOutcome(
  results: readonly HedgeResult[],
  theirs: readonly HedgeResult[],
): ChallengeOutcome {
  return challengeOutcome(hedgeTotals(results).total, hedgeTotals(theirs).total);
}

/**
 * The message that goes with the link: the points beside Atlas's probabilities, and when the game
 * was itself a challenge, how it went against the friend's. Numbers only, so it names no place
 * and no country.
 */
export function hedgeChallengeText(
  seed: number,
  results: readonly HedgeResult[],
  href: string,
  answering?: readonly HedgeResult[],
): string {
  const { total, atlas } = hedgeTotals(results);
  const lines = [
    `Whereabout · Hedge your bets: ${formatPoints(total)} points. Atlas's probabilities: ${formatPoints(atlas)}.`,
  ];
  if (answering) {
    const theirs = formatPoints(hedgeTotals(answering).total);
    const outcome = hedgeChallengeOutcome(results, answering);
    lines.push(
      outcome === "won"
        ? `That beats your ${theirs}. Your turn to read the odds.`
        : outcome === "lost"
          ? `Your ${theirs} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same five photos, same four countries: can you read the odds better?");
  }
  lines.push(hedgeChallengeUrl(href, hedgeChallengeFrom(seed, results)));
  return lines.join("\n");
}

/** "You beat your friend's 3,120 by 410.", from the finished game and the friend's bets. */
export function hedgeChallengeLine(
  results: readonly HedgeResult[],
  theirs: readonly HedgeResult[],
): string {
  const you = hedgeTotals(results).total;
  const them = hedgeTotals(theirs).total;
  const outcome = challengeOutcome(you, them);
  if (outcome === "won") {
    return `You beat your friend's ${formatPoints(them)} by ${formatPoints(you - them)}.`;
  }
  if (outcome === "lost") {
    return `Your friend's ${formatPoints(them)} wins, by ${formatPoints(them - you)}.`;
  }
  return `A dead heat: you both scored ${formatPoints(you)}.`;
}

/** The answer card's line on the friend's bet: "Your friend had 4 chips on France: 640." */
export function hedgeFriendLine(theirs: HedgeResult, name: (country: string) => string): string {
  const truth = name(theirs.options[theirs.right]!);
  return `Your friend had ${chipWord(theirs.chips[theirs.right]!)} on ${truth}: ${formatPoints(theirs.score)}.`;
}

/** "7 on it · 910": the chips on the right country and the points, never the country. */
const betCell = (r: HedgeResult) => `${r.chips[r.right]} on it · ${formatPoints(r.score)}`;

/**
 * The head-to-head of a Hedge your bets challenge: each side's chips on the right country and
 * points on each photo, never the photo, its place or a country. More points take a photo and
 * the game.
 */
export function hedgeHeadToHead(
  results: readonly HedgeResult[],
  theirs: readonly HedgeResult[],
  url: string,
): HeadToHead {
  const you = hedgeTotals(results).total;
  const them = hedgeTotals(theirs).total;
  return {
    game: "Hedge your bets",
    youTotal: formatPoints(you),
    friendTotal: formatPoints(them),
    outcome: challengeOutcome(you, them),
    rows: results.map((r, i) => {
      const t = theirs[i]!;
      return {
        label: `Photo ${i + 1}`,
        you: betCell(r),
        friend: betCell(t),
        winner: rowWinner(r.score, t.score),
      };
    }),
    url,
  };
}
