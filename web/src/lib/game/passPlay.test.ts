import { beforeEach, describe, expect, it } from "vitest";

import { MAX_POINTS } from "@/lib/geo";

import {
  MAX_NAME,
  PASS_PLAYERS_KEY,
  PASS_ROUNDS,
  cleanNames,
  firstTurn,
  initialPass,
  loadPassPlayers,
  nextTurn,
  passReducer,
  rememberPassPlayers,
  standings,
  winners,
  type PassAction,
  type PassRound,
  type PassState,
} from "./passPlay";

const PARIS = { lng: 2.35, lat: 48.86 };
const TOKYO = { lng: 139.69, lat: 35.69 };
const ORDER = ["a", "b", "c", "d", "e", "f", "g"];

function run(state: PassState, ...actions: PassAction[]): PassState {
  return actions.reduce(passReducer, state);
}

const start = (players: string[]) =>
  passReducer(initialPass, { type: "start", players, order: ORDER });

/** The current player pins `at` and locks in, with the photo in Paris and Atlas in Tokyo. */
const pinAndLock = (at: { lng: number; lat: number }): PassAction[] => [
  { type: "ready" },
  { type: "pinned", pin: at },
  { type: "lock", truth: PARIS, atlas: TOKYO },
];

describe("cleanNames", () => {
  it("trims, cuts long names, fills empty ones and keeps at most four", () => {
    expect(cleanNames(["  Ana  ", "", "x".repeat(40), "Bo  Li", "Fifth"])).toEqual([
      "Ana",
      "Player 2",
      "x".repeat(MAX_NAME),
      "Bo Li",
    ]);
  });
});

describe("turns", () => {
  it("moves the first seat on by one each round and visits every seat once", () => {
    expect([0, 1, 2, 3].map((r) => firstTurn(r, 3))).toEqual([0, 1, 2, 0]);
    // Round 1 of three players starts with seat 1: 1, 2, 0, then done.
    expect(nextTurn(1, 1, 3)).toBe(2);
    expect(nextTurn(2, 1, 3)).toBe(0);
    expect(nextTurn(0, 1, 3)).toBeNull();
  });
});

describe("passReducer", () => {
  it("needs two players and a photo to start, and deals at most five rounds", () => {
    expect(passReducer(initialPass, { type: "start", players: ["Solo"], order: ORDER })).toBe(
      initialPass,
    );
    expect(passReducer(initialPass, { type: "start", players: ["A", "B"], order: [] })).toBe(
      initialPass,
    );
    const state = start(["A", "B"]);
    expect(state).toMatchObject({ phase: "pass", turn: 0, pins: [null, null], rounds: [] });
    expect(state.phase !== "setup" && state.order).toEqual(ORDER.slice(0, PASS_ROUNDS));
  });

  it("hides each pin behind the pass screen and reveals once everyone has pinned", () => {
    let state = run(start(["Ana", "Bo"]), { type: "ready" });
    expect(state).toMatchObject({ phase: "pinning", turn: 0, pin: null });
    // No pin, no lock.
    expect(passReducer(state, { type: "lock", truth: PARIS, atlas: null })).toBe(state);

    state = run(
      state,
      { type: "pinned", pin: PARIS },
      { type: "lock", truth: PARIS, atlas: TOKYO },
    );
    // Handing over: Ana's pin is kept but there is no pin on screen for Bo.
    expect(state).toMatchObject({ phase: "pass", turn: 1, pins: [PARIS, null] });
    state = run(state, { type: "ready" });
    expect(state).toMatchObject({ phase: "pinning", turn: 1, pin: null });

    state = run(
      state,
      { type: "pinned", pin: TOKYO },
      { type: "lock", truth: PARIS, atlas: TOKYO },
    );
    expect(state.phase).toBe("revealed");
    if (state.phase !== "revealed") return;
    const [round] = state.rounds;
    expect(round.photoId).toBe("a");
    expect(round.guesses.map((g) => g.score)).toEqual([MAX_POINTS, expect.any(Number)]);
    expect(round.guesses[1].distanceKm).toBeGreaterThan(9000);
    expect(round.atlas?.distanceKm).toBeCloseTo(round.guesses[1].distanceKm);
  });

  it("starts the next round with the next seat, and finishes after the last photo", () => {
    let state = run(start(["Ana", "Bo"]), ...pinAndLock(PARIS), ...pinAndLock(TOKYO));
    state = run(state, { type: "next" });
    expect(state).toMatchObject({ phase: "pass", turn: 1, pins: [null, null] });
    // Bo first, then Ana; the guesses stay in seat order.
    state = run(state, ...pinAndLock(TOKYO), ...pinAndLock(PARIS));
    expect(state.phase === "revealed" && state.rounds[1].guesses[0].score).toBe(MAX_POINTS);

    for (let r = 2; r < PASS_ROUNDS; r++) {
      state = run(state, { type: "next" }, ...pinAndLock(PARIS), ...pinAndLock(PARIS));
    }
    expect(state.phase).toBe("revealed");
    state = run(state, { type: "next" });
    expect(state.phase).toBe("finished");
    expect(state.phase === "finished" && state.rounds).toHaveLength(PASS_ROUNDS);
    expect(run(state, { type: "setup" })).toBe(initialPass);
  });

  it("scores a round without Atlas when it made no guess", () => {
    const state = run(
      start(["Ana", "Bo"]),
      { type: "ready" },
      { type: "pinned", pin: PARIS },
      { type: "lock", truth: PARIS, atlas: null },
      { type: "ready" },
      { type: "pinned", pin: PARIS },
      { type: "lock", truth: PARIS, atlas: null },
    );
    expect(state.phase === "revealed" && state.rounds[0].atlas).toBeNull();
  });
});

function round(scores: number[], atlas: number | null): PassRound {
  const guess = (score: number) => ({ at: PARIS, distanceKm: 0, score });
  return {
    photoId: "x",
    truth: PARIS,
    guesses: scores.map(guess),
    atlas: atlas === null ? null : guess(atlas),
  };
}

describe("standings", () => {
  it("orders by total with shared places on a tie, Atlas among the players", () => {
    const rounds = [round([3000, 4000, 4000], 3500), round([1000, 500, 500], 2000)];
    expect(standings(["Ana", "Bo", "Cy"], rounds)).toEqual([
      { who: "atlas", name: "Atlas", total: 5500, place: 1 },
      { who: 1, name: "Bo", total: 4500, place: 2 },
      { who: 2, name: "Cy", total: 4500, place: 2 },
      { who: 0, name: "Ana", total: 4000, place: 4 },
    ]);
    expect(winners(["Ana", "Bo", "Cy"], rounds)).toEqual([1, 2]);
  });

  it("leaves Atlas out when it never guessed", () => {
    const table = standings(["Ana", "Bo"], [round([10, 20], null)]);
    expect(table.map((s) => s.who)).toEqual([1, 0]);
  });
});

describe("remembered players", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the table's names and reads back only a valid list", () => {
    expect(loadPassPlayers()).toBeNull();
    rememberPassPlayers([" Ana ", "", "Cy"]);
    expect(loadPassPlayers()).toEqual(["Ana", "Player 2", "Cy"]);
    for (const bad of ['["one"]', '"Ana"', "[1,2]", "{", JSON.stringify(Array(5).fill("x"))]) {
      localStorage.setItem(PASS_PLAYERS_KEY, bad);
      expect(loadPassPlayers()).toBeNull();
    }
  });
});
