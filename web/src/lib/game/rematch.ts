/**
 * Rematch Atlas: the photos where Atlas beat you on your first try, kept in this browser so a
 * later game can deal the five it beat you by the most and score you against that first try.
 *
 * A photo joins the pool only on the first time you play it (a photo already on your map, or
 * already in the pool, is not a first try) and only when Atlas scored more than you. It leaves
 * the pool the first time you score more than Atlas on it, in a rematch or any other game, so
 * the pool is always "the photos Atlas still has over you". The first try's points stay as
 * they were: a rematch you lose again never lowers the bar.
 *
 * Like the record and the map this is best effort: storage that is blocked or full never stops
 * a game, and whatever comes back from storage goes through `parseRematch`, which drops any
 * malformed entry on its own.
 */
import { MAX_POINTS } from "@/lib/geo";

import type { Challenge } from "./challenge";
import { ROUNDS_PER_GAME } from "./state";

export const REMATCH_KEY = "whereabout:rematch";

/** How many photos the pool keeps; the newest stay when it overflows. */
export const MAX_REMATCH = 100;

export interface AtlasWin {
  /** The catalog photo id. */
  id: string;
  /** Your points on your first try at this photo. */
  score: number;
  /** Atlas's points on the same photo (always more than `score`). */
  atlas: number;
}

/** One revealed round, as the pool needs to see it. */
export interface PlayedRound {
  id: string;
  score: number;
  /** Atlas's points on this photo, or null when Atlas sat it out. */
  atlas: number | null;
}

/**
 * The pool after one more revealed round. Pure: returns a new array, oldest first.
 *
 * `firstTry` says whether this was the first time this browser saw the photo; the pool also
 * treats any photo it already holds as played before.
 */
export function noteRound(
  pool: readonly AtlasWin[],
  round: PlayedRound,
  firstTry: boolean,
  max = MAX_REMATCH,
): AtlasWin[] {
  const held = pool.find((w) => w.id === round.id);
  if (held) {
    // Beating Atlas on it settles the score; anything less leaves the first try standing.
    return round.score > held.atlas ? pool.filter((w) => w.id !== round.id) : [...pool];
  }
  if (!firstTry || round.atlas === null || round.atlas <= round.score) return [...pool];
  const next = [...pool, { id: round.id, score: round.score, atlas: round.atlas }];
  return next.slice(Math.max(0, next.length - max));
}

/** How many points Atlas beat you by on this photo. */
export const marginOf = (w: AtlasWin) => w.atlas - w.score;

/**
 * The rematch to offer: the photos this deck can deal where Atlas beat you by the most, biggest
 * margin first (ties by photo id, so the same pool always deals the same game), each with your
 * first try's points to beat. Null until there are enough of them for a whole game.
 */
export function pickRematch(
  pool: readonly AtlasWin[],
  deckIds: readonly string[],
  n = ROUNDS_PER_GAME,
): Challenge | null {
  const known = new Set(deckIds);
  const picked = pool
    .filter((w) => known.has(w.id))
    .sort((a, b) => marginOf(b) - marginOf(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, n);
  if (picked.length < n) return null;
  return { ids: picked.map((w) => w.id), scores: picked.map((w) => w.score) };
}

/** How a rematch round went against your first try at the same photo. */
export type RematchOutcome = "better" | "worse" | "same";

export function rematchOutcome(score: number, first: number): RematchOutcome {
  return score > first ? "better" : score < first ? "worse" : "same";
}

const ID = /^[A-Za-z0-9-]{1,32}$/;
const points = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_POINTS;

function parseEntry(v: unknown): AtlasWin | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const e = v as Record<string, unknown>;
  if (typeof e.id !== "string" || !ID.test(e.id)) return null;
  if (!points(e.score) || !points(e.atlas) || e.atlas <= e.score) return null;
  return { id: e.id, score: e.score, atlas: e.atlas };
}

/**
 * Read the stored pool back. Anything that is not a list reads as empty; a malformed entry is
 * dropped on its own; a photo listed twice keeps its first entry (the first try); the cap holds.
 */
export function parseRematch(raw: string | null, max = MAX_REMATCH): AtlasWin[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const out: AtlasWin[] = [];
  for (const v of data) {
    const entry = parseEntry(v);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out.slice(Math.max(0, out.length - max));
}

/** Minimal storage surface, so tests can pass a fake (including one that throws). */
export type RematchStore = Pick<Storage, "getItem" | "setItem">;

function browserStore(): RematchStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadRematch(store: RematchStore | null = browserStore()): AtlasWin[] {
  if (!store) return [];
  try {
    return parseRematch(store.getItem(REMATCH_KEY));
  } catch {
    return [];
  }
}

/** Note one revealed round in the stored pool, best effort; returns the new pool. */
export function keepForRematch(
  round: PlayedRound,
  firstTry: boolean,
  store: RematchStore | null = browserStore(),
): AtlasWin[] {
  const next = noteRound(loadRematch(store), round, firstTry);
  try {
    store?.setItem(REMATCH_KEY, JSON.stringify(next));
  } catch {
    // Quota or privacy mode: the game plays on; this round just won't be offered for a rematch.
  }
  return next;
}
