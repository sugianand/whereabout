/**
 * Pass and play: two to four players share one phone or laptop. Each round, every player pins
 * the same photo in turn behind a "pass to" screen that hides the last pin, then one reveal shows
 * every pin, Atlas's and a running table.
 *
 * Rounds are scored like the main game (`scoreDistance`, no hints). Who pins first moves on by
 * one each round, so nobody always goes first or last. The rules live here as a pure reducer so
 * they can be tested without a globe; the player names are kept in this browser only, best
 * effort, so the same table can start again with one tap.
 */

import { haversineKm, scoreDistance, type LngLat } from "@/lib/geo";

export const PASS_ROUNDS = 5;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
/** Longest name kept, in characters; names are trimmed to it. */
export const MAX_NAME = 16;
export const PASS_PLAYERS_KEY = "whereabout:pass-players";

/** "Player 3": the name used when a field is left empty. */
export function defaultName(index: number): string {
  return `Player ${index + 1}`;
}

/**
 * The names a game starts with: each trimmed and cut to `MAX_NAME`, an empty one replaced by
 * its default, and at most `MAX_PLAYERS` of them.
 */
export function cleanNames(names: readonly string[]): string[] {
  return names
    .slice(0, MAX_PLAYERS)
    .map((n, i) => n.trim().replace(/\s+/g, " ").slice(0, MAX_NAME).trim() || defaultName(i));
}

/** One player's pin on one photo, scored. */
export interface PassGuess {
  at: LngLat;
  distanceKm: number;
  score: number;
}

/** A finished round: every player's guess in player order, and Atlas's when it made one. */
export interface PassRound {
  photoId: string;
  truth: LngLat;
  guesses: PassGuess[];
  atlas: PassGuess | null;
}

interface Table {
  players: readonly string[];
  /** The photos dealt, one per round. */
  order: readonly string[];
  /** Rounds finished so far, oldest first. */
  rounds: PassRound[];
}

export type PassState =
  | { phase: "setup" }
  | (Table & {
      /** The device is being handed to `players[turn]`; nothing of the last pin is on screen. */
      phase: "pass";
      turn: number;
      /** Pins locked in this round, by player index. */
      pins: (LngLat | null)[];
    })
  | (Table & {
      /** `players[turn]` is pinning; `pin` is null until their first tap. */
      phase: "pinning";
      turn: number;
      pins: (LngLat | null)[];
      pin: LngLat | null;
    })
  | (Table & {
      /** Every pin is in and the latest round is shown. */
      phase: "revealed";
    })
  | (Table & {
      /** All rounds played: the final table. */
      phase: "finished";
    });

export type PassAction =
  | { type: "start"; players: readonly string[]; order: readonly string[] }
  | { type: "ready" }
  | { type: "pinned"; pin: LngLat }
  /** Lock in the current pin; `truth` and `atlas` score the round once the last pin is in. */
  | { type: "lock"; truth: LngLat; atlas: LngLat | null }
  | { type: "next" }
  | { type: "setup" };

export const initialPass: PassState = { phase: "setup" };

/** The player who pins first in round `round` (0-based): one seat further along each round. */
export function firstTurn(round: number, players: number): number {
  return players > 0 ? round % players : 0;
}

/** Who pins after `turn` in round `round`, or null when everyone has. */
export function nextTurn(turn: number, round: number, players: number): number | null {
  const following = (turn + 1) % players;
  return following === firstTurn(round, players) ? null : following;
}

function scored(at: LngLat, truth: LngLat): PassGuess {
  const distanceKm = haversineKm(at, truth);
  return { at, distanceKm, score: scoreDistance(distanceKm) };
}

export function passReducer(state: PassState, action: PassAction): PassState {
  switch (action.type) {
    case "start": {
      const players = cleanNames(action.players);
      const order = action.order.slice(0, PASS_ROUNDS);
      if (players.length < MIN_PLAYERS || order.length === 0) return state;
      return {
        phase: "pass",
        players,
        order,
        rounds: [],
        turn: firstTurn(0, players.length),
        pins: players.map(() => null),
      };
    }
    case "ready":
      return state.phase === "pass" ? { ...state, phase: "pinning", pin: null } : state;
    case "pinned":
      return state.phase === "pinning" ? { ...state, pin: action.pin } : state;
    case "lock": {
      if (state.phase !== "pinning" || !state.pin) return state;
      const { players, order, rounds, turn } = state;
      const pins = state.pins.map((p, i) => (i === turn ? state.pin : p));
      const following = nextTurn(turn, rounds.length, players.length);
      if (following !== null) {
        return { phase: "pass", players, order, rounds, turn: following, pins };
      }
      const round: PassRound = {
        photoId: order[rounds.length],
        truth: action.truth,
        guesses: pins.map((p) => scored(p!, action.truth)),
        atlas: action.atlas ? scored(action.atlas, action.truth) : null,
      };
      return { phase: "revealed", players, order, rounds: [...rounds, round] };
    }
    case "next": {
      if (state.phase !== "revealed") return state;
      const { players, order, rounds } = state;
      if (rounds.length >= order.length) return { phase: "finished", players, order, rounds };
      return {
        phase: "pass",
        players,
        order,
        rounds,
        turn: firstTurn(rounds.length, players.length),
        pins: players.map(() => null),
      };
    }
    case "setup":
      return initialPass;
  }
}

/** One line of the running table. */
export interface Standing {
  /** A player's index, or "atlas". */
  who: number | "atlas";
  name: string;
  total: number;
  /** 1 for the leader; players on the same total share a place. */
  place: number;
}

/**
 * The running table after `rounds`: every player and Atlas by total, highest first. Players on
 * the same total share a place and keep their seat order; Atlas is listed with the players and
 * placed the same way, so the table shows who is beating the machine.
 */
export function standings(
  players: readonly string[],
  rounds: readonly PassRound[],
  withAtlas = true,
): Standing[] {
  const rows: Omit<Standing, "place">[] = players.map((name, i) => ({
    who: i,
    name,
    total: rounds.reduce((sum, r) => sum + (r.guesses[i]?.score ?? 0), 0),
  }));
  if (withAtlas && rounds.some((r) => r.atlas)) {
    rows.push({
      who: "atlas",
      name: "Atlas",
      total: rounds.reduce((sum, r) => sum + (r.atlas?.score ?? 0), 0),
    });
  }
  const sorted = rows
    .map((row, seat) => ({ row, seat }))
    .sort((a, b) => b.row.total - a.row.total || a.seat - b.seat)
    .map(({ row }) => row);
  return sorted.map((row) => ({
    ...row,
    place: 1 + sorted.filter((other) => other.total > row.total).length,
  }));
}

/** The players (never Atlas) on the top total, in seat order; several on a tie. */
export function winners(players: readonly string[], rounds: readonly PassRound[]): number[] {
  const table = standings(players, rounds, false);
  const top = table[0]?.total ?? 0;
  return table
    .filter((s) => s.total === top)
    .map((s) => s.who as number)
    .sort((a, b) => a - b);
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The names of the last table that played here, or null when none can be read. */
export function loadPassPlayers(): string[] | null {
  try {
    const raw = storage()?.getItem(PASS_PLAYERS_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !Array.isArray(value) ||
      value.length < MIN_PLAYERS ||
      value.length > MAX_PLAYERS ||
      !value.every((n) => typeof n === "string")
    ) {
      return null;
    }
    return cleanNames(value as string[]);
  } catch {
    return null;
  }
}

/** Keep the table's names for next time. */
export function rememberPassPlayers(players: readonly string[]): void {
  try {
    storage()?.setItem(PASS_PLAYERS_KEY, JSON.stringify(cleanNames(players)));
  } catch {
    // Private mode or full storage: the names are typed again next time.
  }
}
