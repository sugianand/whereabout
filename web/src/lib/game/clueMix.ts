/**
 * Clue mix: one endless quick game over all three clues the clue games teach. Each photo asks a
 * different clue in turn, the side of the road, then the climate, then the continent, round and
 * round, until the first wrong call, like Left or right?.
 *
 * The truths are the photo's own labels: its driving side and Köppen group
 * (data/labels/concept_labels.csv, as in Left or right? and Which climate?) and the continent of
 * its catalog country (`continentOf`, the table continent games use).
 *
 * The catalog is lopsided on every clue (about three in four photos drive on the right, few are
 * polar, Europe has the most photos), so `dealClueMix` deals each step evenly the way the single
 * clue games do: the step's clue is fixed by its place in the cycle, its answer is drawn by a fair
 * die over the answers that still have unused photos, then a photo from that answer's shuffled
 * pile. A photo is dealt at most once a run, so it is never asked a second clue later on. The run
 * is cleared when a step's clue has fewer than two answers left, since a one-answer question is
 * no question. Always giving one answer is a guess on every step.
 *
 * Atlas plays along with the reads the other games already score it on: `atlasDrivingSide`,
 * `atlasClimateGroup`, and for the continent, the continent of the country it gave most (as Odd
 * one out reads it). It sits out a step where it said nothing about that clue.
 *
 * The rules are a pure reducer, tested without photos. The best run is kept in this browser
 * only, best effort.
 */

import { CONTINENTS, continentOf, type Continent } from "@/lib/continents";
import type { DrivingSide } from "@/lib/drivingSides";
import { countryInSentence } from "@/lib/missLesson";
import {
  CLIMATE_GROUPS,
  atlasClimateGroup,
  atlasDrivingSide,
  type AtlasRead,
  type ClimateGroup,
} from "@/lib/trueClues";

import { mulberry32, seededShuffle } from "./daily";

export const BEST_CLUE_MIX_KEY = "whereabout:clue-mix-best";

export type ClueKind = "road" | "climate" | "continent";

/** The clue each photo asks, in turn: photo 1 the road, 2 the climate, 3 the continent, 4 the road… */
export const CLUE_CYCLE: readonly ClueKind[] = ["road", "climate", "continent"];

/** Each dealable photo's answer to each clue, by photo id; a photo may lack any of them. */
export interface ClueMaps {
  sides: Readonly<Record<string, DrivingSide>>;
  climates: Readonly<Record<string, ClimateGroup>>;
  continents: Readonly<Record<string, Continent>>;
}

/** One dealt step: the photo and the clue it asks. */
export interface ClueStep {
  id: string;
  clue: ClueKind;
}

/** The answers a clue can be given, in the order its buttons show them. */
export function clueAnswers(clue: ClueKind, maps: ClueMaps): readonly string[] {
  switch (clue) {
    case "road":
      return ["left", "right"];
    case "climate":
      return CLIMATE_GROUPS;
    case "continent": {
      // Only the continents the deck holds a photo from, so no button can never be right.
      const held = new Set(Object.values(maps.continents));
      return CONTINENTS.filter((c) => held.has(c));
    }
  }
}

function mapOf(clue: ClueKind, maps: ClueMaps): Readonly<Record<string, string>> {
  return clue === "road" ? maps.sides : clue === "climate" ? maps.climates : maps.continents;
}

/** The photo's answer to `clue`, or null when its labels don't say. */
export function clueTruth(clue: ClueKind, id: string, maps: ClueMaps): string | null {
  const map = mapOf(clue, maps);
  return Object.hasOwn(map, id) ? map[id] : null;
}

/**
 * The run for `seed`: a step per photo, the clue fixed by `CLUE_CYCLE`, the answer by a fair die
 * over the answers with unused photos, then the next unused photo from that answer's shuffled
 * pile. Ends before the first step whose clue has fewer than two answers left. Pure in the seed.
 *
 * `after` deals the rest of a run that has already shown some photos (a friend's challenge): its
 * `ids` are never dealt again and the cycle picks up at the step after them, so the first step
 * dealt asks the clue the run's next place in the cycle asks. Without it, the deal is the same as
 * it always was for a seed.
 */
export function dealClueMix(
  maps: ClueMaps,
  seed: number,
  after: readonly string[] = [],
): ClueStep[] {
  // Each clue's piles, one per answer in button order, each with a read head into it.
  const piles = new Map<ClueKind, { ids: string[]; head: number }[]>();
  CLUE_CYCLE.forEach((clue, c) => {
    const map = mapOf(clue, maps);
    piles.set(
      clue,
      clueAnswers(clue, maps).map((answer, a) => ({
        ids: seededShuffle(
          Object.keys(map).filter((id) => map[id] === answer),
          (seed + (c * 8 + a + 1) * 0x9e3779b9) >>> 0,
        ),
        head: 0,
      })),
    );
  });
  const used = new Set<string>(after);
  const die = mulberry32((seed ^ 0x27d4eb2f) >>> 0);
  const out: ClueStep[] = [];
  for (;;) {
    const clue = CLUE_CYCLE[(after.length + out.length) % CLUE_CYCLE.length];
    // Skip photos another clue has already dealt, so each pile's head is a fresh photo.
    const open = piles.get(clue)!.filter((pile) => {
      while (pile.head < pile.ids.length && used.has(pile.ids[pile.head])) pile.head++;
      return pile.head < pile.ids.length;
    });
    if (open.length < 2) return out;
    const pile = open[Math.min(open.length - 1, Math.floor(die() * open.length))];
    const id = pile.ids[pile.head++];
    used.add(id);
    out.push({ id, clue });
  }
}

/** Atlas's answer to `clue` for a photo, or null when it said nothing about it. */
export function atlasClueRead(clue: ClueKind, atlas: AtlasRead | null | undefined): string | null {
  if (!atlas) return null;
  switch (clue) {
    case "road":
      return atlasDrivingSide(atlas)?.side ?? null;
    case "climate":
      return atlasClimateGroup(atlas);
    case "continent": {
      const top = [...atlas.topCountries].sort((a, b) => b.p - a.p)[0]?.country;
      return continentOf(top);
    }
  }
}

/** How one call came out. */
export interface ClueVerdict {
  clue: ClueKind;
  picked: string;
  truth: string;
  correct: boolean;
}

interface Run {
  order: readonly ClueStep[];
  /** The step on screen is `order[index]`. */
  index: number;
  /** Right calls in a row this run. */
  streak: number;
  /** Steps Atlas called right, and steps it gave a read on. */
  atlasRight: number;
  atlasPlayed: number;
}

export type ClueMixState =
  | { phase: "idle" }
  | (Run & { phase: "picking" })
  | (Run & {
      phase: "answered";
      verdict: ClueVerdict;
      /** Atlas's answer, or null when it said nothing about this clue. */
      atlas: { picked: string; correct: boolean } | null;
    })
  | (Run & { phase: "cleared" });

export type ClueMixAction =
  | {
      type: "start";
      order: readonly ClueStep[];
      /** A kept run to pick up from (today's run after a reload): it goes on at `order[streak]`. */
      from?: { streak: number; atlasRight: number; atlasPlayed: number };
    }
  | { type: "picked"; answer: string; truth: string; atlas: string | null }
  | { type: "next" };

export const initialClueMix: ClueMixState = { phase: "idle" };

export function clueMixReducer(state: ClueMixState, action: ClueMixAction): ClueMixState {
  switch (action.type) {
    case "start": {
      const from = action.from ?? { streak: 0, atlasRight: 0, atlasPlayed: 0 };
      const run: Run = { order: action.order, index: from.streak, ...from };
      return run.index >= action.order.length
        ? { phase: "cleared", ...run }
        : { phase: "picking", ...run };
    }
    case "picked": {
      if (state.phase !== "picking") return state;
      const clue = state.order[state.index].clue;
      const correct = action.answer === action.truth;
      const atlas =
        action.atlas === null
          ? null
          : { picked: action.atlas, correct: action.atlas === action.truth };
      return {
        ...state,
        phase: "answered",
        streak: state.streak + (correct ? 1 : 0),
        atlasRight: state.atlasRight + (atlas?.correct ? 1 : 0),
        atlasPlayed: state.atlasPlayed + (atlas ? 1 : 0),
        verdict: { clue, picked: action.answer, truth: action.truth, correct },
        atlas,
      };
    }
    case "next": {
      if (state.phase !== "answered" || !state.verdict.correct) return state;
      const { order, streak, atlasRight, atlasPlayed } = state;
      const run: Run = { order, index: state.index + 1, streak, atlasRight, atlasPlayed };
      return run.index >= order.length
        ? { phase: "cleared", ...run }
        : { phase: "picking", ...run };
    }
  }
}

/** True once the run has ended, by a wrong call or by calling every step dealt. */
export function clueMixOver(state: ClueMixState): boolean {
  return state.phase === "cleared" || (state.phase === "answered" && !state.verdict.correct);
}

/** The question a clue asks, over its buttons. */
export const CLUE_QUESTION: Record<ClueKind, string> = {
  road: "Which side of the road do they drive on?",
  climate: "Which climate is it?",
  continent: "Which continent is it on?",
};

/** An answer as its button and the answer card name it. */
export function answerName(clue: ClueKind, answer: string): string {
  if (clue === "road") return answer === "left" ? "Left" : "Right";
  return answer;
}

/** The answer in words, for the card: "In Japan they drive on the left." */
export function clueTruthLine(clue: ClueKind, truth: string, country: string): string {
  const where = countryInSentence(country);
  switch (clue) {
    case "road":
      return `In ${where} they drive on the ${truth}.`;
    case "climate":
      return `${truth === "Arid" ? "An" : "A"} ${truth.toLowerCase()} climate, in ${where}.`;
    case "continent":
      return `Taken in ${where}, in ${truth}.`;
  }
}

/** Atlas's call in words: "Atlas said Asia, and got it." or "Atlas read it as arid: wrong." */
export function clueAtlasLine(clue: ClueKind, atlas: { picked: string; correct: boolean } | null) {
  const outcome = atlas?.correct ? ", and got it." : ": wrong.";
  if (!atlas) {
    const what = { road: "the road", climate: "the climate", continent: "the place" }[clue];
    return `Atlas said nothing about ${what} here: no call for it.`;
  }
  switch (clue) {
    case "road":
      return `Atlas called the ${atlas.picked}${outcome}`;
    case "climate":
      return `Atlas read it as ${atlas.picked.toLowerCase()}${outcome}`;
    case "continent":
      return `Atlas placed it in ${atlas.picked}${outcome}`;
  }
}

/** Each photo's continent from its catalog country, for any record-like list. */
export function continentMap(
  photos: readonly { id: string; country: string }[],
): Record<string, Continent> {
  return Object.fromEntries(
    photos.flatMap((p) => {
      const c = continentOf(p.country);
      return c ? [[p.id, c]] : [];
    }),
  );
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The best run this browser has kept, or 0 when none is stored or it can't be read. */
export function loadBestClueMix(): number {
  try {
    const raw = storage()?.getItem(BEST_CLUE_MIX_KEY);
    if (!raw) return 0;
    const value: unknown = JSON.parse(raw);
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** Keep `streak` if it beats the stored best, and return the best after that. */
export function rememberClueMix(streak: number): number {
  const best = loadBestClueMix();
  if (streak <= best) return best;
  try {
    storage()?.setItem(BEST_CLUE_MIX_KEY, JSON.stringify(streak));
  } catch {
    // Private mode or full storage: the run still counts for this visit.
  }
  return streak;
}
