/**
 * Challenge a friend to Odd one out: a link that deals a friend the very same quads, each with
 * its four photos in the same places, and the run the sender made to beat.
 *
 * The link names every quad the sender was shown, the miss included, as photo ids in the order
 * they were laid out, with the streak and which photo the sender wrongly tapped on the last one,
 * e.g. `/odd-one-out?challenge=wm001.wm002.wm003.wm004-wm010.wm011.wm012.wm013_1_3`. Quads are
 * split by `-`, photos by `.`. The answer is not in the link: which photo is the odd one is read
 * back from the catalog's continents (`deck.regions`), so a link carries ids and counts only and
 * spoils nothing, and a link whose four photos aren't three-and-one any more is turned away.
 *
 * The friend plays those quads first, in order; a friend past the sender's miss plays on through
 * freshly dealt quads, keeping back the photos already shown, so a run is never cut short at the
 * number to beat. Nothing is stored: the whole challenge lives in the address.
 *
 * A long run would make a long address, so a link names at most `ODD_CHALLENGE_QUADS`; a run past
 * that carries its first quads and the streak, with no miss to show (its pick is `0`).
 */

import type { Continent } from "@/lib/continents";

import { challengeOutcome, type ChallengeOutcome } from "./challenge";
import { QUAD, dealQuad, type Quad } from "./oddOneOut";
import type { OddDealer } from "./oddDaily";
import type { Regions } from "./regions";

export const ODD_CHALLENGE_PARAM = "challenge";

/** The most quads a link names (four photos each), so the address stays one people can send. */
export const ODD_CHALLENGE_QUADS = 15;

export interface OddChallenge {
  /** The quads the sender was shown, in order, photos as laid out: the miss last, if it fits. */
  quads: Quad[];
  /** The sender's streak: quads right in a row. */
  streak: number;
  /**
   * Where the sender tapped on the quad that ended their run (0 to 3), or null when the link
   * stops before it (a run longer than `ODD_CHALLENGE_QUADS`).
   */
  missPick: number | null;
}

export type OddChallengeParse =
  | { ok: true; challenge: OddChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9-]{1,32}$/;
const COUNT = /^\d{1,4}$/;
const PICK = /^[0-4]$/;

export function encodeOddChallenge(c: OddChallenge): string {
  const quads = c.quads.map((q) => q.ids.join(".")).join("-");
  return `${quads}_${c.streak}_${c.missPick === null ? 0 : c.missPick + 1}`;
}

/** Each dealable photo's continent, from the deck's regions. */
function continentsById(regions: Regions): Map<string, Continent> {
  const out = new Map<string, Continent>();
  for (const [continent, ids] of Object.entries(regions) as [Continent, string[]][]) {
    for (const id of ids) out.set(id, continent);
  }
  return out;
}

/**
 * The quad four photos make, read from their continents: three from one, one from another.
 * Null when they don't split three and one.
 */
export function quadOf(ids: readonly string[], continents: ReadonlyMap<string, Continent>) {
  if (ids.length !== QUAD) return null;
  const of = ids.map((id) => continents.get(id));
  if (of.some((c) => c === undefined)) return null;
  const odd = of.findIndex((c, i) => {
    const rest = of.filter((_, j) => j !== i);
    return c !== rest[0] && rest.every((d) => d === rest[0]);
  });
  if (odd < 0) return null;
  const quad: Quad = {
    ids: [...ids],
    odd,
    common: of[(odd + 1) % QUAD]!,
    oddContinent: of[odd]!,
  };
  return quad;
}

/**
 * Read a `?challenge=` value: one to `ODD_CHALLENGE_QUADS` quads of four different photos Odd one
 * out can deal, each still three from one continent and one from another, and a run those quads
 * could give. Either the last quad was the miss (the streak is one short of the quads, and the
 * pick names a wrong photo on it), or a full link stops before the miss (a longer streak, pick 0).
 */
export function parseOddChallenge(value: string, regions: Regions): OddChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 3) return malformed;
  const [quadPart, streakPart, pickPart] = parts;
  const lists = quadPart.split("-").map((q) => q.split("."));
  if (
    lists.length > ODD_CHALLENGE_QUADS ||
    !lists.every((ids) => ids.length === QUAD && new Set(ids).size === QUAD) ||
    !lists.every((ids) => ids.every((id) => ID.test(id))) ||
    !COUNT.test(streakPart) ||
    !PICK.test(pickPart)
  ) {
    return malformed;
  }
  const streak = Number(streakPart);
  const pick = Number(pickPart);
  const endsOnMiss = streak === lists.length - 1 && pick > 0;
  const runsOn = lists.length === ODD_CHALLENGE_QUADS && streak >= lists.length && pick === 0;
  if (!endsOnMiss && !runsOn) return malformed;
  const continents = continentsById(regions);
  if (!lists.every((ids) => ids.every((id) => continents.has(id)))) {
    return { ok: false, reason: "missing" };
  }
  const quads: Quad[] = [];
  for (const ids of lists) {
    const quad = quadOf(ids, continents);
    if (!quad) return malformed;
    quads.push(quad);
  }
  const missPick = endsOnMiss ? pick - 1 : null;
  // The sender's miss was a wrong tap, never the odd one.
  if (missPick !== null && missPick === quads.at(-1)!.odd) return malformed;
  return { ok: true, challenge: { quads, streak, missPick } };
}

/**
 * The friend's run: the challenge's quads first, as the sender saw them, then fresh quads from
 * `dealQuad`, keeping back every photo already shown while each continent has fresh ones.
 */
export function oddChallengeDealer(
  c: OddChallenge,
  regions: Regions,
  random: () => number = Math.random,
): OddDealer {
  const queue = [...c.quads];
  const seen = new Set(c.quads.flatMap((q) => q.ids));
  const next = () => {
    const linked = queue.shift();
    if (linked) return linked;
    const quad = dealQuad(regions, random, seen);
    quad?.ids.forEach((id) => seen.add(id));
    return quad;
  };
  return {
    next,
    skip(n) {
      for (let i = 0; i < n; i++) next();
    },
  };
}

/** A finished run, as the link needs it: the quads it showed, its streak and its last tap. */
export interface OddRun {
  /** Every quad shown, in order, up to and including the one that ended the run. */
  quads: readonly Quad[];
  streak: number;
  /** Where the last tap landed. */
  picked: number;
}

/** The challenge a finished run makes: up to `ODD_CHALLENGE_QUADS` quads, its streak and miss. */
export function oddChallengeFrom(run: OddRun): OddChallenge {
  const fits = run.quads.length <= ODD_CHALLENGE_QUADS;
  return {
    quads: run.quads.slice(0, ODD_CHALLENGE_QUADS),
    streak: run.streak,
    missPick: fits ? run.picked : null,
  };
}

/** The page's address with only the challenge in its query. */
export function oddChallengeUrl(href: string, c: OddChallenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${ODD_CHALLENGE_PARAM}=${encodeOddChallenge(c)}`;
}

/** "1 quad", "4 quads". */
function quads(n: number): string {
  return `${n} quad${n === 1 ? "" : "s"}`;
}

/** How a finished run did against the challenge it answered. */
export function oddChallengeOutcome(streak: number, c: OddChallenge): ChallengeOutcome {
  return challengeOutcome(streak, c.streak);
}

/**
 * The message that goes with the link: the run, and when it was itself a challenge, how it went
 * against the friend's. Counts only, so it names no place.
 */
export function oddChallengeText(run: OddRun, href: string, answering?: OddChallenge): string {
  const lines = [
    `Whereabout · Odd one out: I spotted the odd one in ${quads(run.streak)} in a row.`,
  ];
  if (answering) {
    const outcome = oddChallengeOutcome(run.streak, answering);
    lines.push(
      outcome === "won"
        ? `That beats your ${answering.streak}. Your turn to go further.`
        : outcome === "lost"
          ? `Your ${answering.streak} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same photos, same places: can you go further?");
  }
  lines.push(oddChallengeUrl(href, oddChallengeFrom(run)));
  return lines.join("\n");
}

/** "You beat your friend's 3 in a row by 2.", from the finished streak and the challenge. */
export function oddChallengeLine(streak: number, c: OddChallenge): string {
  const gap = Math.abs(streak - c.streak);
  const outcome = oddChallengeOutcome(streak, c);
  if (outcome === "won") return `You beat your friend's ${c.streak} in a row by ${gap}.`;
  if (outcome === "lost") return `Your friend's ${c.streak} in a row wins, by ${gap}.`;
  return `A dead heat: you both spotted ${quads(c.streak)}.`;
}

/**
 * On the quad that ended the friend's run, what they tapped: "Your friend's run ended here: they
 * picked photo 2." Null on any other quad, or when the link stops before the miss.
 */
export function oddFriendMissLine(quadIndex: number, c: OddChallenge): string | null {
  if (c.missPick === null || quadIndex !== c.quads.length - 1) return null;
  return `Your friend's run ended here: they picked photo ${c.missPick + 1}.`;
}
