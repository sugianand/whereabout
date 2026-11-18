/**
 * Your ground mix-ups: which land cover you called for which in What's on the ground?, so Your
 * clue reading can list the covers you misread most and as what, and deal a practice game from
 * them.
 *
 * Two sources, never counted twice:
 * - free games (a friend's challenge and a practice game included) keep every call here as it
 *   is made, right or wrong, under `GROUND_CALLS_KEY`, newest last and capped, so a cover's
 *   misread rate follows recent play;
 * - today's games are read back from the days ./groundDaily.ts already keeps call by call; the
 *   daily screen never writes to this log.
 *
 * A practice game is the free game's own even deal (`dealGround`) over only the covers in your
 * top misreads and the cover you took each for most, so a photo of the cover you misread comes
 * up beside the one you called it, and always naming one of them is still a guess. It keeps its
 * own best: its photos are picked for being hard for this player.
 */

import { GROUND_COVERS, isGroundCover, type GroundCover } from "@/lib/trueClues";

import { loadGroundDays, type GroundDay } from "./groundDaily";
import { GROUND_NAME, GROUND_PHOTOS, dealGround, type GroundMap } from "./onTheGround";

export const GROUND_CALLS_KEY = "whereabout:ground-calls";
export const BEST_GROUND_MIX_UPS_KEY = "whereabout:on-the-ground-mix-ups-best";

/** How many free-game calls are kept; the newest stay when it overflows. */
export const MAX_GROUND_CALLS = 300;
/** How many misread covers Your clue reading lists. */
export const TOP_GROUND_MISREADS = 3;
/** How many of the top misreads a practice game is dealt from (with what each was taken for). */
export const PRACTICE_GROUND_MISREADS = 2;

/** One photo's call: the cover it was in, and the one named for it. */
export interface GroundCall {
  truth: GroundCover;
  picked: GroundCover;
}

/** The log with one more call, newest last. Pure: returns a new array. */
export function noteGroundCall(
  log: readonly GroundCall[],
  call: GroundCall,
  max = MAX_GROUND_CALLS,
): GroundCall[] {
  const next = [...log, call];
  return next.slice(Math.max(0, next.length - max));
}

function parseCall(value: unknown): GroundCall | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { truth, picked } = value as Record<string, unknown>;
  return isGroundCover(truth) && isGroundCover(picked) ? { truth, picked } : null;
}

/** What storage held, keeping the well-formed calls (the newest, up to the cap). */
export function parseGroundCalls(value: unknown): GroundCall[] {
  if (!Array.isArray(value)) return [];
  const log = value.map(parseCall).filter((c): c is GroundCall => c !== null);
  return log.slice(Math.max(0, log.length - MAX_GROUND_CALLS));
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The free games' calls kept in this browser, oldest first. */
export function loadGroundCalls(): GroundCall[] {
  try {
    const raw = storage()?.getItem(GROUND_CALLS_KEY);
    return raw ? parseGroundCalls(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** Keep one free-game call. Best effort: storage that refuses it changes nothing. */
export function keepGroundCall(truth: GroundCover, picked: GroundCover): void {
  const call = parseCall({ truth, picked });
  if (!call) return;
  try {
    storage()?.setItem(GROUND_CALLS_KEY, JSON.stringify(noteGroundCall(loadGroundCalls(), call)));
  } catch {
    // Blocked or full storage: the game goes on without it.
  }
}

/** Today's games' calls, oldest day first. */
export function groundDayCalls(days: Readonly<Record<string, GroundDay>>): GroundCall[] {
  return Object.keys(days)
    .sort()
    .flatMap((day) => days[day].results.map(({ truth, picked }) => ({ truth, picked })));
}

/** Every call this browser keeps: today's games, then the free games. */
export function loadAllGroundCalls(): GroundCall[] {
  return [...groundDayCalls(loadGroundDays()), ...loadGroundCalls()];
}

/** A cover you have called wrong, with how often and as what. */
export interface GroundMisread {
  cover: GroundCover;
  /** Photos of this cover you called, and how many of them wrong. */
  photos: number;
  missed: number;
  /** What you called it instead, most often first. */
  as: readonly { cover: GroundCover; times: number }[];
}

const order = (c: GroundCover) => GROUND_COVERS.indexOf(c);

/**
 * The covers you called wrong, most missed first; on a tie the higher miss rate, then the
 * buttons' own order (built-up to bare ground), so the list reads the same every time. At most
 * `top`.
 */
export function groundMisreads(
  calls: readonly GroundCall[],
  top = TOP_GROUND_MISREADS,
): GroundMisread[] {
  const by = new Map<GroundCover, { photos: number; as: Map<GroundCover, number> }>();
  for (const { truth, picked } of calls) {
    const entry = by.get(truth) ?? by.set(truth, { photos: 0, as: new Map() }).get(truth)!;
    entry.photos += 1;
    if (picked !== truth) entry.as.set(picked, (entry.as.get(picked) ?? 0) + 1);
  }
  return [...by.entries()]
    .map(([cover, { photos, as }]) => ({
      cover,
      photos,
      missed: [...as.values()].reduce((n, t) => n + t, 0),
      as: [...as.entries()]
        .map(([c, times]) => ({ cover: c, times }))
        .sort((x, y) => y.times - x.times || order(x.cover) - order(y.cover)),
    }))
    .filter((m) => m.missed > 0)
    .sort(
      (x, y) =>
        y.missed - x.missed ||
        y.missed / y.photos - x.missed / x.photos ||
        order(x.cover) - order(y.cover),
    )
    .slice(0, top);
}

/** Each cover as it reads before "photo": "a tree photo", "a bare-ground photo". */
const PHOTO_NOUN: Record<GroundCover, string> = {
  "Built-up": "built-up",
  "Tree cover": "tree",
  Grassland: "grassland",
  "Permanent water bodies": "water",
  "Bare / sparse vegetation": "bare-ground",
};

/** "once", "twice", "3 times". */
function timesWord(n: number): string {
  return n === 1 ? "once" : n === 2 ? "twice" : `${n.toLocaleString("en-US")} times`;
}

/** "a, b and c". */
function inWords(words: readonly string[]): string {
  return words.length > 1
    ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
    : (words[0] ?? "");
}

/** "You called 3 of 5 grassland photos wrong: trees twice and built-up once." */
export function groundMisreadLine(m: GroundMisread): string {
  const as = m.as.map((a) => `${GROUND_NAME[a.cover].toLowerCase()} ${timesWord(a.times)}`);
  const photos = `${m.photos.toLocaleString("en-US")} ${PHOTO_NOUN[m.cover]} photo${m.photos === 1 ? "" : "s"}`;
  return `You called ${m.missed.toLocaleString("en-US")} of ${photos} wrong: ${inWords(as)}.`;
}

/**
 * The covers a practice game is dealt from: each of the top `PRACTICE_GROUND_MISREADS` misreads
 * and the cover you took it for most, in the buttons' order. Never just one cover, since a
 * misread always names another.
 */
export function practiceCovers(misreads: readonly GroundMisread[]): GroundCover[] {
  const set = new Set<GroundCover>();
  for (const m of misreads.slice(0, PRACTICE_GROUND_MISREADS)) {
    set.add(m.cover);
    if (m.as[0]) set.add(m.as[0].cover);
  }
  return GROUND_COVERS.filter((c) => set.has(c));
}

/** Only the photos in `practice`'s covers. */
export function practiceGroundMap(covers: GroundMap, practice: readonly GroundCover[]): GroundMap {
  return Object.fromEntries(Object.entries(covers).filter(([, c]) => practice.includes(c)));
}

/** A practice game's five photos, or none when those covers can't fill a game. Pure in `seed`. */
export function practiceGroundDeal(
  covers: GroundMap,
  practice: readonly GroundCover[],
  seed: number,
): string[] {
  return dealGround(practiceGroundMap(covers, practice), seed);
}

/** How many photos each cover has to deal, for offering a game without the photo map at hand. */
export function photosByCover(covers: GroundMap): Partial<Record<GroundCover, number>> {
  const counts: Partial<Record<GroundCover, number>> = {};
  for (const c of Object.values(covers)) counts[c] = (counts[c] ?? 0) + 1;
  return counts;
}

/** Whether `practice`'s covers have the photos for a game: five, from at least two covers. */
export function canPractiseGround(
  counts: Readonly<Partial<Record<GroundCover, number>>>,
  practice: readonly GroundCover[],
): boolean {
  const have = practice.map((c) => counts[c] ?? 0);
  return have.reduce((n, c) => n + c, 0) >= GROUND_PHOTOS && have.filter((c) => c > 0).length >= 2;
}

/** "grassland and trees", "built-up, water and bare ground". */
export function coversInWords(practice: readonly GroundCover[]): string {
  return inWords(practice.map((c) => GROUND_NAME[c].toLowerCase()));
}
