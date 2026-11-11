/**
 * Challenge a friend to Name the country: a link that deals a friend the very same run, photo by
 * photo with the same four names on each, and the streak the sender made to beat.
 *
 * A run is its order and its seed (the seed settles each photo's names through `nameSeed`). The
 * link names the photos the sender was shown, the miss included, and carries the seed and the
 * streak, e.g. `/name-country?challenge=wm077.wm003.wm104_1z141z3_2`. The friend plays those
 * photos first, in that order, and a friend who gets past the sender's miss plays on through the
 * rest of the deck, shuffled by the same seed, so a run is never cut short at the number to beat.
 * The photos are named rather than re-dealt from the seed, so a link keeps dealing the same
 * photos as the catalog grows. It carries ids and counts only, never a place or a country, so it
 * spoils nothing; nothing is stored, the whole challenge lives in the address.
 *
 * A long run would make a long address, so a link names at most `NAME_CHALLENGE_PHOTOS`; a run
 * past that carries its first photos and the streak, and the friend plays on from the seed.
 */

import { runHeadToHead, type HeadToHead } from "@/lib/headToHead";

import { challengeOutcome, type ChallengeOutcome } from "./challenge";
import { seededShuffle } from "./daily";

export const NAME_CHALLENGE_PARAM = "challenge";

/** The most photos a link names, so the address stays one people can send. */
export const NAME_CHALLENGE_PHOTOS = 60;

export interface NameChallenge {
  /** The photos the sender was shown, in order: the miss last, unless the run went past them. */
  ids: string[];
  /** The run's seed: with a photo's id, it settles that photo's four names. */
  seed: number;
  /** The sender's streak: countries named in a row. */
  streak: number;
}

export type NameChallengeParse =
  | { ok: true; challenge: NameChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

const ID = /^[A-Za-z0-9-]{1,32}$/;
const SEED = /^[0-9a-z]{1,7}$/;
const COUNT = /^\d{1,4}$/;

export function encodeNameChallenge(c: NameChallenge): string {
  return `${c.ids.join(".")}_${c.seed.toString(36)}_${c.streak}`;
}

/**
 * Read a `?challenge=` value: one to `NAME_CHALLENGE_PHOTOS` different photos Name the country
 * can deal, a seed that fits in 32 bits, and a streak those photos could give: one short of them
 * (the last was the miss), all of them (the run named every photo), or, from a full link, more.
 */
export function parseNameChallenge(value: string, dealable: readonly string[]): NameChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 3) return malformed;
  const [idPart, seedPart, streakPart] = parts;
  const ids = idPart.split(".");
  if (
    ids.length > NAME_CHALLENGE_PHOTOS ||
    !ids.every((id) => ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    !SEED.test(seedPart) ||
    !COUNT.test(streakPart)
  ) {
    return malformed;
  }
  const seed = parseInt(seedPart, 36);
  const streak = Number(streakPart);
  const fits =
    streak === ids.length - 1 ||
    streak === ids.length ||
    (ids.length === NAME_CHALLENGE_PHOTOS && streak > ids.length);
  if (seed >= 2 ** 32 || !fits) return malformed;
  const known = new Set(dealable);
  if (!ids.every((id) => known.has(id))) return { ok: false, reason: "missing" };
  return { ok: true, challenge: { ids, seed, streak } };
}

/**
 * The friend's run: the sender's photos first, as they were shown, then every other dealable
 * photo shuffled by the challenge's seed, for a friend who gets further.
 */
export function nameChallengeOrder(c: NameChallenge, dealable: readonly string[]): string[] {
  const named = new Set(c.ids);
  return [
    ...c.ids,
    ...seededShuffle(
      dealable.filter((id) => !named.has(id)),
      c.seed,
    ),
  ];
}

/**
 * The challenge a finished run makes: the photos it showed, up to and including the one at
 * `index` (the miss, or the last photo of a cleared run), its seed and its streak.
 */
export function nameChallengeFrom(run: {
  order: readonly string[];
  index: number;
  seed: number;
  streak: number;
}): NameChallenge {
  return {
    ids: run.order.slice(0, Math.min(run.index + 1, NAME_CHALLENGE_PHOTOS)),
    seed: run.seed,
    streak: run.streak,
  };
}

/** The page's address with only the challenge in its query. */
export function nameChallengeUrl(href: string, c: NameChallenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${NAME_CHALLENGE_PARAM}=${encodeNameChallenge(c)}`;
}

/** "1 country", "4 countries". */
function countries(n: number): string {
  return `${n} ${n === 1 ? "country" : "countries"}`;
}

/** How a finished run did against the challenge it answered. */
export function nameChallengeOutcome(streak: number, c: NameChallenge): ChallengeOutcome {
  return challengeOutcome(streak, c.streak);
}

/**
 * The message that goes with the link: the streak, and when the run was itself a challenge, how
 * it went against the friend's. Counts only, so it names no place.
 */
export function nameChallengeText(
  run: { order: readonly string[]; index: number; seed: number; streak: number },
  href: string,
  answering?: NameChallenge,
): string {
  const lines = [`Whereabout · Name the country: I named ${countries(run.streak)} in a row.`];
  if (answering) {
    const outcome = nameChallengeOutcome(run.streak, answering);
    lines.push(
      outcome === "won"
        ? `That beats your ${answering.streak}. Your turn to go further.`
        : outcome === "lost"
          ? `Your ${answering.streak} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same photos, same names: can you go further?");
  }
  lines.push(nameChallengeUrl(href, nameChallengeFrom(run)));
  return lines.join("\n");
}

/** "You beat your friend's 3 in a row by 2.", from the finished streak and the challenge. */
export function nameChallengeLine(streak: number, c: NameChallenge): string {
  const gap = Math.abs(streak - c.streak);
  const outcome = nameChallengeOutcome(streak, c);
  if (outcome === "won") return `You beat your friend's ${c.streak} in a row by ${gap}.`;
  if (outcome === "lost") return `Your friend's ${c.streak} in a row wins, by ${gap}.`;
  return `A dead heat: you both named ${countries(c.streak)}.`;
}

/**
 * The head-to-head of a Name the country challenge: both runs photo by photo, right, wrong or not
 * reached, never a photo, a place or a name either side picked. The longer streak takes it, as the
 * end screen says. A link that stops before its sender's miss shows none.
 */
export function nameHeadToHead(
  run: { index: number; streak: number },
  c: NameChallenge,
  url: string,
): HeadToHead {
  return runHeadToHead(
    "Name the country",
    { one: "Photo", many: "Photos" },
    // A cleared run ends on a photo it named, so its streak runs one past `index`.
    { streak: run.streak, missed: run.index === run.streak },
    { streak: c.streak, missed: c.streak === c.ids.length - 1 },
    url,
  );
}
