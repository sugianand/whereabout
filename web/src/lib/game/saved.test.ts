import { describe, expect, it } from "vitest";

import { BLITZ_MS, clockWithTimeLeft, remainingMs, secondsShown, fractionLeft } from "./blitz";
import { LocalBackend } from "./backends";
import { sameKindOfGame, type GameMode } from "./mode";
import {
  SAVED_GAME_KEY,
  SAVED_GAME_MAX_AGE_MS,
  gameToResume,
  loadSaved,
  parseSaved,
  snapshot,
  storeSaved,
  type SavedGame,
} from "./saved";
import { ROUNDS_PER_GAME, gameReducer, initialState, type GameState } from "./state";
import type { CatalogPhoto } from "./types";

const PHOTOS: CatalogPhoto[] = ["a1", "b2", "c3", "d4", "e5"].map((id, i) => ({
  id,
  imageUrl: `https://example.org/${id}.jpg`,
  lng: -40 + i * 20,
  lat: 10 + i * 5,
  place: `Place ${id}`,
  country: "BR",
  drivingSide: "right",
  credit: { author: "Ann", license: "CC BY 4.0", sourceUrl: `https://example.org/${id}` },
  postcard: {
    description: `What to learn about ${id}.`,
    article: { title: `Place ${id}`, url: `https://en.wikipedia.org/wiki/Place_${id}` },
  },
}));
const IDS = PHOTOS.map((p) => p.id);
const DECK = [...IDS, "f6", "g7"];
const NOW = Date.UTC(2026, 9, 29, 12);
const FRESH: GameMode = { kind: "fresh", game: 1 };
const DAILY: GameMode = { kind: "daily", day: "2026-10-29" };

/** Play `rounds` rounds through the real reducer and backend, guessing each spot exactly. */
async function played(rounds: number): Promise<GameState> {
  const backend = new LocalBackend(PHOTOS);
  let state: GameState = initialState;
  for (let i = 0; i < rounds; i++) {
    const round = await backend.startRound();
    state = gameReducer(state, { type: "started", round });
    state = gameReducer(state, { type: "pinned", pin: PHOTOS[i] });
    state = gameReducer(state, { type: "submitted" });
    const reveal = await backend.guess(round.roundId, PHOTOS[i]);
    state = gameReducer(state, { type: "revealed", reveal, atlas: null });
    if (i + 1 < ROUNDS_PER_GAME) state = gameReducer(state, { type: "next" });
  }
  return state;
}

/** The game one round in, the second round on screen with a hint and a pin. */
async function midRound(): Promise<GameState> {
  const backend = new LocalBackend(PHOTOS, 1);
  let state = await played(1);
  const round = await backend.startRound();
  state = gameReducer(state, { type: "started", round });
  state = gameReducer(state, { type: "hintRequested" });
  state = gameReducer(state, { type: "hinted", clues: await backend.hint(round.roundId) });
  return gameReducer(state, { type: "pinned", pin: { lng: 1, lat: 2 } });
}

function roundTrip(game: SavedGame | null, now = NOW, deck: readonly string[] = DECK) {
  return parseSaved(JSON.stringify(game), deck, now);
}

describe("snapshot", () => {
  it("keeps nothing before the player has pinned, hinted or guessed", async () => {
    expect(snapshot(FRESH, IDS, initialState, NOW)).toBeNull();
    const round = await new LocalBackend(PHOTOS).startRound();
    const showing = gameReducer(initialState, { type: "started", round });
    expect(snapshot(FRESH, IDS, showing, NOW)).toBeNull();
    const pinned = gameReducer(showing, { type: "pinned", pin: { lng: 3, lat: 4 } });
    expect(snapshot(FRESH, IDS, pinned, NOW)?.round).toEqual({
      photoId: "a1",
      pin: { lng: 3, lat: 4 },
      hintsUsed: 0,
    });
  });

  it("keeps the rounds played and the round on screen with its hints and pin", async () => {
    const kept = snapshot(FRESH, IDS, await midRound(), NOW)!;
    expect(kept.results).toHaveLength(1);
    expect(kept.results[0].reveal.score).toBe(5000);
    expect(kept.round).toEqual({ photoId: "b2", pin: { lng: 1, lat: 2 }, hintsUsed: 1 });
    expect(kept.dealt).toEqual(IDS);
  });

  it("keeps a Blitz clock's time left only in a Blitz game", async () => {
    const state = await midRound();
    expect(snapshot({ kind: "blitz", game: 1 }, IDS, state, NOW, 12_345)?.round?.blitzMsLeft).toBe(
      12_345,
    );
    expect(snapshot(FRESH, IDS, state, NOW, 12_345)?.round).not.toHaveProperty("blitzMsLeft");
  });

  it("lets a finished game go", async () => {
    const done = gameReducer(await played(5), { type: "next" });
    expect(done.phase).toBe("finished");
    expect(snapshot(FRESH, IDS, done, NOW)).toBeNull();
  });
});

describe("parseSaved", () => {
  it("reads back exactly what was kept", async () => {
    const kept = snapshot(DAILY, IDS, await midRound(), NOW)!;
    expect(roundTrip(kept)).toEqual(kept);
  });

  it("drops a game that is too old, from the future, or not JSON", async () => {
    const kept = snapshot(FRESH, IDS, await played(2), NOW)!;
    expect(roundTrip(kept, NOW + SAVED_GAME_MAX_AGE_MS)).not.toBeNull();
    expect(roundTrip(kept, NOW + SAVED_GAME_MAX_AGE_MS + 1)).toBeNull();
    expect(roundTrip(kept, NOW - 1)).toBeNull();
    expect(parseSaved("{not json", DECK, NOW)).toBeNull();
    expect(parseSaved(null, DECK, NOW)).toBeNull();
  });

  it("drops a game whose photos this deck no longer deals", async () => {
    const kept = snapshot(FRESH, IDS, await played(2), NOW)!;
    expect(
      roundTrip(
        kept,
        NOW,
        DECK.filter((id) => id !== "c3"),
      ),
    ).toBeNull();
  });

  it("drops anything out of shape", async () => {
    const kept = snapshot(FRESH, IDS, await midRound(), NOW)!;
    const tamper = (change: (g: Record<string, unknown>) => void) => {
      const g = JSON.parse(JSON.stringify(kept));
      change(g);
      return parseSaved(JSON.stringify(g), DECK, NOW);
    };
    expect(tamper(() => {})).not.toBeNull();
    expect(tamper((g) => (g.v = 2))).toBeNull();
    expect(tamper((g) => (g.mode = { kind: "tier", tier: "impossible", game: 1 }))).toBeNull();
    expect(tamper((g) => (g.mode = { kind: "region", region: "Atlantis", game: 1 }))).toBeNull();
    expect(
      tamper((g) => (g.mode = { kind: "daily", day: "2026-10-20", archive: true })),
    ).not.toBeNull();
    expect(
      tamper((g) => (g.mode = { kind: "daily", day: "2026-10-20", archive: "yes" })),
    ).toBeNull();
    expect(
      tamper((g) => ((g.results as { reveal: { score: number } }[])[0].reveal.score = 9999)),
    ).toBeNull();
    expect(tamper((g) => ((g.dealt as string[])[0] = "b2"))).toBeNull();
    // A kept postcard is read back only as the catalog writes it, so no stored link can point
    // anywhere but English Wikipedia.
    type Kept = { reveal: { answer: { postcard?: { article: { url: string } } } } }[];
    expect(
      tamper((g) => ((g.results as Kept)[0].reveal.answer.postcard!.article.url = "javascript:1")),
    ).toBeNull();
    expect(tamper((g) => delete (g.results as Kept)[0].reveal.answer.postcard)).not.toBeNull();
    // The round in progress must be the one after the last played.
    expect(tamper((g) => ((g.round as { photoId: string }).photoId = "c3"))).toBeNull();
    expect(tamper((g) => ((g.round as { hintsUsed: number }).hintsUsed = 7))).toBeNull();
    expect(tamper((g) => ((g.round as { blitzMsLeft: number }).blitzMsLeft = 5000))).toBeNull();
    expect(
      tamper((g) => (g.results = [...(g.results as unknown[]), ...(g.results as unknown[])])),
    ).toBeNull();
  });

  it("checks a challenge against its own link rules and its five photos", async () => {
    const challenge: GameMode = {
      kind: "challenge",
      challenge: { ids: IDS, scores: [1, 2, 3, 4, 5] },
    };
    const kept = snapshot(challenge, IDS, await played(1), NOW)!;
    expect(roundTrip(kept)?.mode).toEqual(challenge);
    const other = {
      ...kept,
      mode: { ...challenge, challenge: { ids: IDS, scores: [1, 2, 3, 4, 99999] } },
    };
    expect(roundTrip(other)).toBeNull();
  });

  it("keeps a rematch with its first tries, and only on the five photos it names", async () => {
    const rematch: GameMode = {
      kind: "rematch",
      rematch: { ids: IDS, scores: [0, 10, 20, 30, 40] },
    };
    const kept = snapshot(rematch, IDS, await played(2), NOW)!;
    expect(roundTrip(kept)?.mode).toEqual(rematch);
    const reordered = {
      ...kept,
      mode: { ...rematch, rematch: { ids: [...IDS].reverse(), scores: [0, 10, 20, 30, 40] } },
    };
    expect(roundTrip(reordered)).toBeNull();
    const short = { ...kept, mode: { ...rematch, rematch: { ids: IDS, scores: [1, 2] } } };
    expect(roundTrip(short)).toBeNull();
  });

  it("caps a Blitz clock at one round's allowance", async () => {
    const kept = snapshot({ kind: "blitz", game: 2 }, IDS, await midRound(), NOW, 10_000)!;
    const big = { ...kept, round: { ...kept.round!, blitzMsLeft: 10 * BLITZ_MS } };
    expect(roundTrip(big)?.round?.blitzMsLeft).toBe(BLITZ_MS);
  });
});

describe("gameToResume", () => {
  const kept = (mode: GameMode) =>
    ({ v: 1, savedAt: NOW, mode, dealt: IDS, results: [], round: null }) as SavedGame;

  it("reopens any kept game from the plain address", () => {
    expect(gameToResume(kept(DAILY), FRESH, false, "2026-10-29")).not.toBeNull();
    expect(
      gameToResume(kept({ kind: "tier", tier: "hard", game: 4 }), FRESH, false, "2026-10-29"),
    ).not.toBeNull();
    expect(gameToResume(null, FRESH, false, "2026-10-29")).toBeNull();
  });

  it("reopens a game the address asks for only if it is that game", () => {
    const hard: GameMode = { kind: "tier", tier: "hard", game: 1 };
    expect(gameToResume(kept({ ...hard, game: 3 }), hard, true, "2026-10-29")).not.toBeNull();
    expect(
      gameToResume(kept({ kind: "tier", tier: "easy", game: 1 }), hard, true, "2026-10-29"),
    ).toBeNull();
    expect(gameToResume(kept(FRESH), DAILY, true, "2026-10-29")).toBeNull();
  });

  it("reopens a Daily Five only on its own day", () => {
    expect(gameToResume(kept(DAILY), DAILY, true, "2026-10-30")).toBeNull();
    expect(gameToResume(kept(DAILY), FRESH, false, "2026-10-30")).toBeNull();
  });

  it("reopens a past day's Daily Five from the archive on a later day", () => {
    const past: GameMode = { kind: "daily", day: "2026-10-20", archive: true };
    expect(gameToResume(kept(past), FRESH, false, "2026-10-30")).not.toBeNull();
    expect(gameToResume(kept(past), past, true, "2026-10-30")).not.toBeNull();
    expect(gameToResume(kept(past), DAILY, true, "2026-10-30")).toBeNull();
  });
});

describe("sameKindOfGame", () => {
  it("ignores the visit counter and nothing else", () => {
    expect(sameKindOfGame({ kind: "blitz", game: 1 }, { kind: "blitz", game: 9 })).toBe(true);
    expect(sameKindOfGame({ kind: "blitz", game: 1 }, FRESH)).toBe(false);
    expect(sameKindOfGame(DAILY, { kind: "daily", day: "2026-10-28" })).toBe(false);
    expect(
      sameKindOfGame(
        { kind: "region", region: "Asia", game: 1 },
        { kind: "region", region: "Europe", game: 1 },
      ),
    ).toBe(false);
  });
});

describe("storage", () => {
  it("keeps, reads back and clears one game, and survives a store that throws", async () => {
    const map = new Map<string, string>();
    const store = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    const game = snapshot(FRESH, IDS, await played(1), NOW)!;
    storeSaved(game, store);
    expect(map.has(SAVED_GAME_KEY)).toBe(true);
    expect(loadSaved(DECK, NOW, store)).toEqual(game);
    storeSaved(null, store);
    expect(loadSaved(DECK, NOW, store)).toBeNull();

    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => storeSaved(game, broken)).not.toThrow();
    expect(loadSaved(DECK, NOW, broken)).toBeNull();
  });
});

describe("resuming", () => {
  it("picks the game up after the rounds already played", async () => {
    const results = (await played(2)).results;
    const state = gameReducer(initialState, { type: "resumed", results });
    expect(state).toMatchObject({ phase: "loading", index: 2, results, error: null });
    // Never onto a game already under way.
    expect(gameReducer(state, { type: "resumed", results })).toBe(state);
    expect(gameReducer(initialState, { type: "resumed", results: [] })).toBe(initialState);
  });

  it("reopens on the last reveal when all five were played", async () => {
    const results = (await played(5)).results;
    const state = gameReducer(initialState, { type: "resumed", results });
    expect(state).toMatchObject({ phase: "revealed", index: 4, current: results[4] });
    expect(gameReducer(state, { type: "next" }).phase).toBe("finished");
  });

  it("starts a resumed round with its pin and hints", async () => {
    const backend = new LocalBackend(PHOTOS, 3);
    const round = await backend.startRound();
    expect(round.photo.id).toBe("d4");
    const clues = await backend.hint(round.roundId);
    const state = gameReducer(initialState, {
      type: "started",
      round,
      pin: { lng: 5, lat: 6 },
      clues,
    });
    expect(state).toMatchObject({ phase: "guessing", pin: { lng: 5, lat: 6 }, clues });
    // The backend counted the hint, so the guess is scored with it.
    const reveal = await backend.guess(round.roundId, PHOTOS[3]);
    expect(reveal).toMatchObject({ hintsUsed: 1, score: 4000 });
  });

  it("runs a resumed Blitz clock from the time it had left", () => {
    const clock = clockWithTimeLeft(1_000, 18_000);
    expect(remainingMs(clock, 1_000)).toBe(18_000);
    expect(secondsShown(clock, 1_000)).toBe(18);
    expect(fractionLeft(clock, 1_000)).toBeCloseTo(0.6);
    expect(remainingMs(clock, 19_000)).toBe(0);
    expect(remainingMs(clockWithTimeLeft(0, -5), 0)).toBe(0);
    expect(remainingMs(clockWithTimeLeft(0, 10 * BLITZ_MS), 0)).toBe(BLITZ_MS);
  });
});
