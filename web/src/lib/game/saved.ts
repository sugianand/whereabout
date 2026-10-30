/**
 * Pick up where you left off: the game in progress, kept in this browser after every move, so a
 * reload or a phone killing the tab reopens it on the same round with the same photos and score.
 *
 * One game is kept at a time, under `SAVED_GAME_KEY`. It is written once the player has done
 * something worth keeping (a round played, a pin down or a hint taken) and cleared when the game
 * ends or another game starts in its place. A visit to the plain address reopens whatever is
 * kept; an address that asks for a particular game (`?daily`, `?tier=hard`, a challenge link...)
 * reopens it only if it is that same game, and otherwise starts the new one. A Daily Five is only
 * reopened on its own day, and anything older than `SAVED_GAME_MAX_AGE_MS` is let go.
 *
 * Everything read back is checked field by field: a save from an older build, a deck that no
 * longer deals one of its photos, or a hand-edited value is dropped, and the visit simply starts
 * a new game. Only the browser-dealt game is kept; the API backend deals and scores its own
 * rounds server-side, so there is nothing here to resume them with.
 */
import { CONTINENTS } from "@/lib/continents";
import { MAX_HINTS, MAX_POINTS, type LngLat } from "@/lib/geo";
import type { Clue } from "@/lib/hints";
import { isPostcard } from "@/lib/postcard";

import { BLITZ_MS } from "./blitz";
import { encodeChallenge, parseChallenge } from "./challenge";
import { sameKindOfGame, type GameMode } from "./mode";
import { ROUNDS_PER_GAME, type GameState, type RoundResult } from "./state";
import { isTier } from "./tiers";

export const SAVED_GAME_KEY = "whereabout:game-in-progress";
const VERSION = 1;
/** A game left alone this long is not reopened. */
export const SAVED_GAME_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

/** The round being played when the game was kept. */
export interface SavedRound {
  photoId: string;
  pin: LngLat | null;
  /** Hints already taken: they are taken again on resume, so the round's cap stays lowered. */
  hintsUsed: number;
  /** Blitz only: time left on the round's clock, so a reload never buys more time. */
  blitzMsLeft?: number;
}

export interface SavedGame {
  v: typeof VERSION;
  savedAt: number;
  mode: GameMode;
  /** The five photo ids, in the order they are played. */
  dealt: string[];
  /** Rounds already played, in order. */
  results: RoundResult[];
  round: SavedRound | null;
}

/**
 * What to keep of the game right now, or null when there is nothing worth reopening: a finished
 * game, or one where the player has not yet pinned, hinted or guessed.
 */
export function snapshot(
  mode: GameMode,
  dealt: readonly string[],
  state: GameState,
  now: number,
  blitzMsLeft?: number | null,
): SavedGame | null {
  if (state.phase === "finished" || dealt.length !== ROUNDS_PER_GAME) return null;
  let round: SavedRound | null = null;
  if (state.phase === "guessing" && state.round.photo.id === dealt[state.index]) {
    round = {
      photoId: state.round.photo.id,
      pin: state.pin,
      hintsUsed: state.clues.length,
      ...(mode.kind === "blitz" && blitzMsLeft != null ? { blitzMsLeft } : {}),
    };
  }
  const engaged =
    state.results.length > 0 || (round !== null && (round.pin !== null || round.hintsUsed > 0));
  if (!engaged) return null;
  return { v: VERSION, savedAt: now, mode, dealt: [...dealt], results: state.results, round };
}

/**
 * The kept game to reopen for a visit, or null to start `requested`. `explicit` is true when the
 * address (or the page) asked for a particular game rather than just opening the site.
 */
export function gameToResume(
  saved: SavedGame | null,
  requested: GameMode,
  explicit: boolean,
  today: string,
): SavedGame | null {
  if (!saved) return null;
  // Today's Daily Five is kept only for today; a past day's from the archive keeps for as long
  // as any other game.
  if (saved.mode.kind === "daily" && !saved.mode.archive && saved.mode.day !== today) return null;
  if (explicit && !sameKindOfGame(saved.mode, requested)) return null;
  return saved;
}

// ---- Reading back: trust nothing ----------------------------------------------------------

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isInt = (v: unknown, lo: number, hi: number) =>
  Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

function isLngLat(v: unknown): v is LngLat {
  return (
    isObj(v) && isNum(v.lng) && isNum(v.lat) && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 540 // the globe can hand back a longitude past ±180 after a spin
  );
}

function isClues(v: unknown): v is Clue[] {
  return (
    Array.isArray(v) &&
    v.length <= MAX_HINTS &&
    v.every((c) => isObj(c) && isStr(c.kind) && isStr(c.text))
  );
}

function isMode(v: unknown, deckIds: readonly string[]): v is GameMode {
  if (!isObj(v)) return false;
  const game = isInt(v.game, 1, Number.MAX_SAFE_INTEGER);
  switch (v.kind) {
    case "daily":
      return (
        isStr(v.day) &&
        /^\d{4}-\d{2}-\d{2}$/.test(v.day) &&
        (v.archive === undefined || typeof v.archive === "boolean")
      );
    case "fresh":
    case "blitz":
      return game;
    case "tier":
      return game && isTier(v.tier);
    case "region":
      return game && (CONTINENTS as readonly unknown[]).includes(v.region);
    case "challenge":
    case "rematch": {
      // A rematch carries the same shape as a challenge: five photos and a score on each.
      const c = v.kind === "challenge" ? v.challenge : v.rematch;
      if (!isObj(c) || !Array.isArray(c.ids) || !Array.isArray(c.scores)) return false;
      if (!c.ids.every(isStr) || !c.scores.every(isNum)) return false;
      const value = encodeChallenge({ ids: c.ids as string[], scores: c.scores as number[] });
      return parseChallenge(value, deckIds).ok;
    }
    default:
      return false;
  }
}

function isResult(v: unknown, photoId: string): v is RoundResult {
  if (!isObj(v) || !isObj(v.round) || !isObj(v.reveal) || !isObj(v.round.photo)) return false;
  const { round, reveal } = v;
  const photo = round.photo as Obj;
  if (photo.id !== photoId || !isStr(photo.imageUrl) || !isStr(round.roundId)) return false;
  if (!isInt(round.hintsAvailable, 0, MAX_HINTS)) return false;
  if (v.pin !== null && !isLngLat(v.pin)) return false;
  if (!isClues(v.clues)) return false;
  if (v.timedOut !== undefined && v.timedOut !== true) return false;
  if (!isInt(reveal.score, 0, MAX_POINTS) || !isInt(reveal.hintsUsed, 0, MAX_HINTS)) return false;
  if (reveal.distanceKm !== null && !(isNum(reveal.distanceKm) && reveal.distanceKm >= 0)) {
    return false;
  }
  const answer = reveal.answer;
  if (!isLngLat(answer) || !isStr((answer as Obj).place)) return false;
  const postcard = (answer as Obj).postcard;
  if (postcard !== undefined && !isPostcard(postcard)) return false;
  if (v.atlas !== null) {
    if (!isLngLat(v.atlas)) return false;
    const a = v.atlas as unknown as Obj;
    if (!isNum(a.distanceKm) || !isInt(a.score, 0, MAX_POINTS) || !isNum(a.confidence)) {
      return false;
    }
    if (!Array.isArray(a.topCountries) || !Array.isArray(a.clues)) return false;
  }
  return true;
}

function isRound(v: unknown, photoId: string | undefined): v is SavedRound {
  if (!isObj(v) || photoId === undefined || v.photoId !== photoId) return false;
  if (v.pin !== null && !isLngLat(v.pin)) return false;
  if (!isInt(v.hintsUsed, 0, MAX_HINTS)) return false;
  return v.blitzMsLeft === undefined || (isNum(v.blitzMsLeft) && v.blitzMsLeft >= 0);
}

/**
 * A kept game read back from storage, or null if there is none or it can't be trusted: another
 * version, too old, photos this deck no longer deals, or any field out of shape.
 */
export function parseSaved(raw: string | null, deckIds: readonly string[], now: number) {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(v) || v.v !== VERSION || !isNum(v.savedAt)) return null;
  if (v.savedAt > now || now - v.savedAt > SAVED_GAME_MAX_AGE_MS) return null;
  if (!isMode(v.mode, deckIds)) return null;
  const known = new Set(deckIds);
  const { dealt, results } = v;
  if (!Array.isArray(dealt) || dealt.length !== ROUNDS_PER_GAME) return null;
  if (!dealt.every((id) => isStr(id) && known.has(id)) || new Set(dealt).size !== dealt.length) {
    return null;
  }
  if (v.mode.kind === "challenge" && v.mode.challenge.ids.join() !== dealt.join()) return null;
  if (v.mode.kind === "rematch" && v.mode.rematch.ids.join() !== dealt.join()) return null;
  if (!Array.isArray(results) || results.length > ROUNDS_PER_GAME) return null;
  if (!results.every((r, i) => isResult(r, dealt[i]))) return null;
  // A round in progress is always the one after the last played.
  if (v.round !== null && !isRound(v.round, dealt[results.length])) return null;
  const round = v.round as SavedRound | null;
  if (round?.blitzMsLeft !== undefined && v.mode.kind !== "blitz") return null;
  return {
    v: VERSION,
    savedAt: v.savedAt,
    mode: v.mode,
    dealt: dealt as string[],
    results: results as RoundResult[],
    round: round && {
      ...round,
      ...(round.blitzMsLeft !== undefined
        ? { blitzMsLeft: Math.min(round.blitzMsLeft, BLITZ_MS) }
        : {}),
    },
  } satisfies SavedGame;
}

// ---- Browser storage, best effort ---------------------------------------------------------

export type SavedStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStore(): SavedStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // Storage blocked (privacy settings, sandboxed iframe).
  }
}

export function loadSaved(
  deckIds: readonly string[],
  now: number,
  store: SavedStore | null = browserStore(),
): SavedGame | null {
  try {
    return parseSaved(store?.getItem(SAVED_GAME_KEY) ?? null, deckIds, now);
  } catch {
    return null;
  }
}

/** Keep `game`, or clear what is kept when given null. A full or blocked store keeps nothing. */
export function storeSaved(game: SavedGame | null, store: SavedStore | null = browserStore()) {
  try {
    if (game) store?.setItem(SAVED_GAME_KEY, JSON.stringify(game));
    else store?.removeItem(SAVED_GAME_KEY);
  } catch {
    // The game still plays; it just won't survive a reload.
  }
}
