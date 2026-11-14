/**
 * Your climate mix-ups: which Köppen group you called for which in Which climate?, so Your map
 * can list the climates you misread most and as what, and deal a practice game from them.
 *
 * Two sources, never counted twice:
 * - free games (a friend's challenge and a practice game included) keep every call here as it
 *   is made, right or wrong, under `CLIMATE_CALLS_KEY`, newest last and capped, so a climate's
 *   misread rate follows recent play;
 * - today's games are read back from the days ./climateDaily.ts already keeps call by call; the
 *   daily screen never writes to this log.
 *
 * A practice game is the free game's own even deal (`dealClimate`) over only the climates in
 * your top misreads and the climates you took each for, so a photo of the climate you misread
 * comes up beside the one you called it, and always naming one of them is still a guess. It
 * keeps its own best: its photos are picked for being hard for this player.
 */

import { CLIMATE_GROUPS, isClimateGroup, type ClimateGroup } from "@/lib/trueClues";

import { loadClimateDays, type ClimateDay } from "./climateDaily";
import { CLIMATE_PHOTOS, dealClimate, type ClimateMap } from "./whichClimate";

export const CLIMATE_CALLS_KEY = "whereabout:climate-calls";
export const BEST_CLIMATE_MIX_UPS_KEY = "whereabout:which-climate-mix-ups-best";

/** How many free-game calls are kept; the newest stay when it overflows. */
export const MAX_CLIMATE_CALLS = 300;
/** How many misread climates Your map lists. */
export const TOP_MISREADS = 3;
/** How many of the top misreads a practice game is dealt from (with what each was taken for). */
export const PRACTICE_MISREADS = 2;

/** One photo's call: the climate it was in, and the one named for it. */
export interface ClimateCall {
  truth: ClimateGroup;
  picked: ClimateGroup;
}

/** The log with one more call, newest last. Pure: returns a new array. */
export function noteClimateCall(
  log: readonly ClimateCall[],
  call: ClimateCall,
  max = MAX_CLIMATE_CALLS,
): ClimateCall[] {
  const next = [...log, call];
  return next.slice(Math.max(0, next.length - max));
}

function parseCall(value: unknown): ClimateCall | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { truth, picked } = value as Record<string, unknown>;
  return isClimateGroup(truth) && isClimateGroup(picked) ? { truth, picked } : null;
}

/** What storage held, keeping the well-formed calls (the newest, up to the cap). */
export function parseClimateCalls(value: unknown): ClimateCall[] {
  if (!Array.isArray(value)) return [];
  const log = value.map(parseCall).filter((c): c is ClimateCall => c !== null);
  return log.slice(Math.max(0, log.length - MAX_CLIMATE_CALLS));
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The free games' calls kept in this browser, oldest first. */
export function loadClimateCalls(): ClimateCall[] {
  try {
    const raw = storage()?.getItem(CLIMATE_CALLS_KEY);
    return raw ? parseClimateCalls(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** Keep one free-game call. Best effort: storage that refuses it changes nothing. */
export function keepClimateCall(truth: ClimateGroup, picked: ClimateGroup): void {
  const call = parseCall({ truth, picked });
  if (!call) return;
  try {
    storage()?.setItem(
      CLIMATE_CALLS_KEY,
      JSON.stringify(noteClimateCall(loadClimateCalls(), call)),
    );
  } catch {
    // Blocked or full storage: the game goes on without it.
  }
}

/** Today's games' calls, oldest day first. */
export function dayCalls(days: Readonly<Record<string, ClimateDay>>): ClimateCall[] {
  return Object.keys(days)
    .sort()
    .flatMap((day) => days[day].results.map(({ truth, picked }) => ({ truth, picked })));
}

/** Every call this browser keeps: today's games, then the free games. */
export function loadAllClimateCalls(): ClimateCall[] {
  return [...dayCalls(loadClimateDays()), ...loadClimateCalls()];
}

/** A climate you have called wrong, with how often and as what. */
export interface ClimateMisread {
  group: ClimateGroup;
  /** Photos of this climate you called, and how many of them wrong. */
  photos: number;
  missed: number;
  /** What you called it instead, most often first. */
  as: readonly { group: ClimateGroup; times: number }[];
}

const order = (g: ClimateGroup) => CLIMATE_GROUPS.indexOf(g);

/**
 * The climates you called wrong, most missed first; on a tie the higher miss rate, then
 * Köppen's own order (A to E), so the list reads the same every time. At most `top`.
 */
export function climateMisreads(
  calls: readonly ClimateCall[],
  top = TOP_MISREADS,
): ClimateMisread[] {
  const by = new Map<ClimateGroup, { photos: number; as: Map<ClimateGroup, number> }>();
  for (const { truth, picked } of calls) {
    const entry = by.get(truth) ?? by.set(truth, { photos: 0, as: new Map() }).get(truth)!;
    entry.photos += 1;
    if (picked !== truth) entry.as.set(picked, (entry.as.get(picked) ?? 0) + 1);
  }
  return [...by.entries()]
    .map(([group, { photos, as }]) => ({
      group,
      photos,
      missed: [...as.values()].reduce((n, t) => n + t, 0),
      as: [...as.entries()]
        .map(([g, times]) => ({ group: g, times }))
        .sort((x, y) => y.times - x.times || order(x.group) - order(y.group)),
    }))
    .filter((m) => m.missed > 0)
    .sort(
      (x, y) =>
        y.missed - x.missed ||
        y.missed / y.photos - x.missed / x.photos ||
        order(x.group) - order(y.group),
    )
    .slice(0, top);
}

/** "once", "twice", "3 times". */
function timesWord(n: number): string {
  return n === 1 ? "once" : n === 2 ? "twice" : `${n.toLocaleString("en-US")} times`;
}

/** "You called 3 of 5 continental photos wrong: temperate twice and arid once." */
export function misreadLine(m: ClimateMisread): string {
  const as = m.as.map((a) => `${a.group.toLowerCase()} ${timesWord(a.times)}`);
  const list = as.length > 1 ? `${as.slice(0, -1).join(", ")} and ${as[as.length - 1]}` : as[0];
  const photos = `${m.photos.toLocaleString("en-US")} ${m.group.toLowerCase()} photo${m.photos === 1 ? "" : "s"}`;
  return `You called ${m.missed.toLocaleString("en-US")} of ${photos} wrong: ${list}.`;
}

/**
 * The climates a practice game is dealt from: each of the top `PRACTICE_MISREADS` misreads and
 * the climate you took it for most, in Köppen's order. Never just one climate, since a misread
 * always names another.
 */
export function practiceGroups(misreads: readonly ClimateMisread[]): ClimateGroup[] {
  const set = new Set<ClimateGroup>();
  for (const m of misreads.slice(0, PRACTICE_MISREADS)) {
    set.add(m.group);
    if (m.as[0]) set.add(m.as[0].group);
  }
  return CLIMATE_GROUPS.filter((g) => set.has(g));
}

/** Only the photos in `practice`'s climates. */
export function practiceMap(groups: ClimateMap, practice: readonly ClimateGroup[]): ClimateMap {
  return Object.fromEntries(Object.entries(groups).filter(([, g]) => practice.includes(g)));
}

/** A practice game's five photos, or none when those climates can't fill a game. Pure in `seed`. */
export function practiceDeal(
  groups: ClimateMap,
  practice: readonly ClimateGroup[],
  seed: number,
): string[] {
  return dealClimate(practiceMap(groups, practice), seed);
}

/** How many photos each climate has to deal, for offering a game without the photo map at hand. */
export function photosByClimate(groups: ClimateMap): Partial<Record<ClimateGroup, number>> {
  const counts: Partial<Record<ClimateGroup, number>> = {};
  for (const g of Object.values(groups)) counts[g] = (counts[g] ?? 0) + 1;
  return counts;
}

/** Whether `practice`'s climates have the photos for a game: five, from at least two climates. */
export function canPractise(
  counts: Readonly<Partial<Record<ClimateGroup, number>>>,
  practice: readonly ClimateGroup[],
): boolean {
  const have = practice.map((g) => counts[g] ?? 0);
  return have.reduce((n, c) => n + c, 0) >= CLIMATE_PHOTOS && have.filter((c) => c > 0).length >= 2;
}

/** "continental and temperate", "arid, temperate and polar". */
export function groupsInWords(practice: readonly ClimateGroup[]): string {
  const words = practice.map((g) => g.toLowerCase());
  return words.length > 1
    ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
    : (words[0] ?? "");
}
