/**
 * Challenge a friend to Clue mix: a link that deals a friend the very same steps, the same photos
 * asking the same clues in the same order, with the run the sender made to beat and the answer
 * they gave on the step that ended it.
 *
 * The link names the photos the sender was shown, up to and including the one that ended the
 * run, with the run's seed and its streak, and, when the run ended on a miss, the sender's wrong
 * answer on that last step: `/clue-mix?challenge=wm077.wm003.wm104_1z141z3_2_eu`. Each photo's
 * clue is its place in `CLUE_CYCLE` (the road, the climate, the continent, round again), so the
 * link needn't say it. A friend who gets past the sender's miss plays on through the photos left,
 * dealt by `dealClueMix` from the same seed with the cycle picking up where the named steps stop,
 * so a run is never cut short at the number to beat and always giving one answer is still a guess.
 *
 * The miss is one short code for that step's clue: `l` or `r` for the road, Köppen's letter for
 * the climate (A tropical to E polar), two letters for a continent (`eu`, `na`…). It must be an
 * answer the step's clue can take and not the photo's own, or it was no miss. With more than two
 * answers the friend couldn't work it out from the photo, so it rides in the link; it is shown
 * only once the friend has called that step themselves. The link names no place and no truth,
 * just ids, counts and the sender's guess, so it spoils nothing; nothing is stored.
 *
 * A long run would make a long address, so a link names at most `CLUE_CHALLENGE_PHOTOS`; a run
 * past that carries its first photos and the streak, with no miss to show.
 */

import type { Continent } from "@/lib/continents";
import { runHeadToHead, type HeadToHead } from "@/lib/headToHead";
import { CLIMATE_GROUPS, type ClimateGroup } from "@/lib/trueClues";

import { challengeOutcome, type ChallengeOutcome } from "./challenge";
import { KOPPEN_LETTER } from "./climateChallenge";
import {
  CLUE_CYCLE,
  answerName,
  clueTruth,
  dealClueMix,
  type ClueKind,
  type ClueMaps,
  type ClueStep,
} from "./clueMix";

export const CLUE_CHALLENGE_PARAM = "challenge";

/** The most photos a link names, so the address stays one people can send. */
export const CLUE_CHALLENGE_PHOTOS = 60;

export interface ClueChallenge {
  /** The photos the sender was shown, in order: the one that ended the run last, if it fits. */
  ids: string[];
  /** The run's seed: it deals the steps left for a friend who gets further. */
  seed: number;
  /** The sender's streak: clues read right in a row. */
  streak: number;
  /** The sender's wrong answer on the last photo, when the link ends on their miss. */
  miss: string | null;
}

export type ClueChallengeParse =
  | { ok: true; challenge: ClueChallenge }
  /** "malformed": not a challenge link at all; "missing": some photos aren't dealt any more. */
  | { ok: false; reason: "malformed" | "missing" };

/** The clue the photo at `index` of a run asks. */
export function clueAt(index: number): ClueKind {
  return CLUE_CYCLE[index % CLUE_CYCLE.length];
}

const CONTINENT_CODE: Record<Continent, string> = {
  Africa: "af",
  Asia: "as",
  Europe: "eu",
  "North America": "na",
  "South America": "sa",
  Oceania: "oc",
  Antarctica: "an",
};

/** Each clue's answers by their code in a link. */
const CODES: Record<ClueKind, Record<string, string>> = {
  road: { left: "l", right: "r" },
  climate: Object.fromEntries(CLIMATE_GROUPS.map((g: ClimateGroup) => [g, KOPPEN_LETTER[g]])),
  continent: CONTINENT_CODE,
};

/** An answer to `clue` as the link writes it. */
export function answerCode(clue: ClueKind, answer: string): string {
  const code = CODES[clue][answer];
  if (code === undefined) throw new Error(`No ${clue} answer "${answer}"`);
  return code;
}

/** The answer a link's code names for `clue`, or null when it names none. */
export function codeAnswer(clue: ClueKind, code: string): string | null {
  const hit = Object.entries(CODES[clue]).find(([, c]) => c === code);
  return hit ? hit[0] : null;
}

const ID = /^[A-Za-z0-9-]{1,32}$/;
const SEED = /^[0-9a-z]{1,7}$/;
const COUNT = /^\d{1,4}$/;

export function encodeClueChallenge(c: ClueChallenge): string {
  const base = `${c.ids.join(".")}_${c.seed.toString(36)}_${c.streak}`;
  return c.miss === null ? base : `${base}_${answerCode(clueAt(c.ids.length - 1), c.miss)}`;
}

/** True when the link shows the photo that ended the sender's run: its last. */
export function endsOnMiss(c: ClueChallenge): boolean {
  return c.streak === c.ids.length - 1;
}

/**
 * Read a `?challenge=` value: one to `CLUE_CHALLENGE_PHOTOS` different photos, each one Clue mix
 * can ask its step's clue of, a seed that fits in 32 bits, a streak those photos could give (one
 * short of them with the sender's wrong answer after it, or all of them, or more from a full
 * link), and a miss that is an answer to the last step's clue other than the photo's own.
 */
export function parseClueChallenge(value: string, maps: ClueMaps): ClueChallengeParse {
  const malformed = { ok: false, reason: "malformed" } as const;
  const parts = value.split("_");
  if (parts.length !== 3 && parts.length !== 4) return malformed;
  const [idPart, seedPart, streakPart, missPart] = parts;
  const ids = idPart.split(".");
  if (
    ids.length < 1 ||
    ids.length > CLUE_CHALLENGE_PHOTOS ||
    !ids.every((id) => ID.test(id)) ||
    new Set(ids).size !== ids.length ||
    !SEED.test(seedPart) ||
    !COUNT.test(streakPart)
  ) {
    return malformed;
  }
  const seed = parseInt(seedPart, 36);
  const streak = Number(streakPart);
  if (seed >= 2 ** 32) return malformed;
  const onMiss = streak === ids.length - 1;
  const fits =
    onMiss ||
    streak === ids.length ||
    (ids.length === CLUE_CHALLENGE_PHOTOS && streak >= ids.length);
  // A run that ended on a miss says what was answered there; one that didn't has nothing to say.
  if (!fits || onMiss !== (missPart !== undefined)) return malformed;
  const last = clueAt(ids.length - 1);
  const miss = missPart === undefined ? null : codeAnswer(last, missPart);
  if (missPart !== undefined && miss === null) return malformed;
  if (!ids.every((id, i) => clueTruth(clueAt(i), id, maps) !== null)) {
    return { ok: false, reason: "missing" };
  }
  // The answer that ended the run can't be the photo's own: that would have been right.
  if (miss !== null && miss === clueTruth(last, ids[ids.length - 1], maps)) return malformed;
  return { ok: true, challenge: { ids, seed, streak, miss } };
}

/**
 * The friend's run: the sender's steps first, as they were shown, then the steps left, dealt by
 * the challenge's seed with the cycle going on from there, for a friend who gets further.
 */
export function clueChallengeOrder(c: ClueChallenge, maps: ClueMaps): ClueStep[] {
  const named = c.ids.map((id, i) => ({ id, clue: clueAt(i) }));
  return [...named, ...dealClueMix(maps, c.seed, c.ids)];
}

/** A finished run, as the link needs it. */
export interface ClueRun {
  order: readonly ClueStep[];
  /** The step that ended the run (a miss, or the last step of a cleared run). */
  index: number;
  seed: number;
  streak: number;
  /** Your wrong answer on the step at `index`, when the run ended on a miss. */
  miss: string | null;
}

/** The challenge a finished run makes: its steps up to `index`, seed, streak and miss. */
export function clueChallengeFrom(run: ClueRun): ClueChallenge {
  const ids = run.order.slice(0, Math.min(run.index + 1, CLUE_CHALLENGE_PHOTOS)).map((s) => s.id);
  const shown = run.miss !== null && run.streak === ids.length - 1;
  return { ids, seed: run.seed, streak: run.streak, miss: shown ? run.miss : null };
}

/** The page's address with only the challenge in its query. */
export function clueChallengeUrl(href: string, c: ClueChallenge): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?${CLUE_CHALLENGE_PARAM}=${encodeClueChallenge(c)}`;
}

/** "1 clue", "4 clues". */
function clues(n: number): string {
  return `${n} clue${n === 1 ? "" : "s"}`;
}

/** How a finished run did against the challenge it answered. */
export function clueChallengeOutcome(streak: number, c: ClueChallenge): ChallengeOutcome {
  return challengeOutcome(streak, c.streak);
}

/**
 * The message that goes with the link: the run, and when it was itself a challenge, how it went
 * against the friend's. Counts only, so it names no place and no answer.
 */
export function clueChallengeText(run: ClueRun, href: string, answering?: ClueChallenge): string {
  const lines = [`Whereabout · Clue mix: I read ${clues(run.streak)} in a row.`];
  if (answering) {
    const outcome = clueChallengeOutcome(run.streak, answering);
    lines.push(
      outcome === "won"
        ? `That beats your ${answering.streak}. Your turn to read the clues.`
        : outcome === "lost"
          ? `Your ${answering.streak} wins this time. Try them again?`
          : "We tied. Play them again to break it?",
    );
  } else {
    lines.push("Same photos, same clues: the road, the climate, the continent, in turn.");
  }
  lines.push(clueChallengeUrl(href, clueChallengeFrom(run)));
  return lines.join("\n");
}

/** "You beat your friend's 3 in a row by 2.", from the finished streak and the challenge. */
export function clueChallengeLine(streak: number, c: ClueChallenge): string {
  const gap = Math.abs(streak - c.streak);
  const outcome = clueChallengeOutcome(streak, c);
  if (outcome === "won") return `You beat your friend's ${c.streak} in a row by ${gap}.`;
  if (outcome === "lost") return `Your friend's ${c.streak} in a row wins, by ${gap}.`;
  return `A dead heat: you both read ${clues(c.streak)}.`;
}

/**
 * The answer the friend gave on the step that ended their run, as its button names it, on that
 * step only and only when the link shows it. Null on any other step.
 */
export function friendMissAnswer(index: number, c: ClueChallenge): string | null {
  if (c.miss === null || !endsOnMiss(c) || index !== c.ids.length - 1) return null;
  return answerName(clueAt(index), c.miss);
}

/**
 * The head-to-head of a Clue mix challenge: both runs step by step, right, wrong or not reached,
 * never a photo or an answer. The longer streak takes it, as the end screen says.
 */
export function clueHeadToHead(run: ClueRun, c: ClueChallenge, url: string): HeadToHead {
  return runHeadToHead(
    "Clue mix",
    { one: "Clue", many: "Clues" },
    // The run ended on the step at `index`: past the streak's steps when it was a miss.
    { streak: run.streak, missed: run.index === run.streak },
    { streak: c.streak, missed: endsOnMiss(c) },
    url,
  );
}
