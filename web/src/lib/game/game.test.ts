import { describe, expect, it, vi } from "vitest";

import catalog from "@/data/photos.json";
import { MAX_POINTS } from "@/lib/geo";

import { ApiBackend, LocalBackend } from "./backends";
import { dayKey, hashSeed, pickDaily, pickRandom, seededShuffle } from "./daily";
import { ROUNDS_PER_GAME, gameReducer, initialState, totals, type GameState } from "./state";
import type { AtlasGuess, CatalogPhoto, Reveal } from "./types";

const photos = catalog as CatalogPhoto[];
const KYOTO: CatalogPhoto = {
  id: "kyoto",
  imageUrl: "https://example.org/k.jpg",
  lng: 135.7681,
  lat: 35.0116,
  place: "Kyoto, Japan",
  country: "JP",
  credit: {
    author: "Ann",
    license: "CC BY 4.0",
    sourceUrl: "https://example.org/k",
  },
};

describe("daily selection", () => {
  it("is the same for everyone on the same day and different on another day", () => {
    const a = pickDaily(photos, "2026-10-09").map((p) => p.id);
    const b = pickDaily(photos, "2026-10-09").map((p) => p.id);
    const c = pickDaily(photos, "2026-10-10").map((p) => p.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(new Set(a).size).toBe(5);
  });

  it("shuffles without losing or duplicating items", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const out = seededShuffle(items, hashSeed("x"));
    expect([...out].sort((x, y) => x - y)).toEqual(items);
    expect(out).not.toEqual(items);
  });

  it("uses the UTC calendar day", () => {
    expect(dayKey(new Date("2026-10-09T23:30:00-04:00"))).toBe("2026-10-10");
  });

  it("picks random games of the requested size", () => {
    expect(pickRandom(photos, 5, () => 0.42)).toHaveLength(5);
  });
});

describe("LocalBackend", () => {
  it("withholds the answer until the guess, then scores it like the API", async () => {
    const backend = new LocalBackend([KYOTO]);
    const round = await backend.startRound();
    expect(JSON.stringify(round)).not.toContain("Kyoto");
    const reveal = await backend.guess(round.roundId, {
      lng: 135.7681,
      lat: 35.0116,
    });
    expect(reveal.distanceKm).toBe(0);
    expect(reveal.score).toBe(MAX_POINTS);
    expect(reveal.answer.place).toBe("Kyoto, Japan");
  });

  it("accepts only one guess per round", async () => {
    const backend = new LocalBackend([KYOTO]);
    const round = await backend.startRound();
    await backend.guess(round.roundId, { lng: 0, lat: 0 });
    await expect(backend.guess(round.roundId, { lng: 0, lat: 0 })).rejects.toThrow();
  });
});

describe("ApiBackend", () => {
  it("maps the API's snake_case responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            round_id: "r1",
            photo: { id: "p", image_url: "https://x/p.jpg" },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            round_id: "r1",
            distance_km: 12.5,
            score: 4958,
            answer: {
              lat: 1,
              lon: 2,
              place_name: "Somewhere",
              country: "SG",
              credit: {
                author: "A",
                license: "CC0",
                source_url: "https://x/f",
              },
            },
          }),
        ),
      );
    const backend = new ApiBackend("http://api.test/", fetchImpl);
    const round = await backend.startRound();
    expect(round).toEqual({
      roundId: "r1",
      photo: { id: "p", imageUrl: "https://x/p.jpg" },
    });
    const reveal = await backend.guess("r1", { lng: 2, lat: 1 });
    expect(reveal.answer.place).toBe("Somewhere");
    expect(reveal.answer.credit?.sourceUrl).toBe("https://x/f");
    expect(fetchImpl.mock.calls[0][0]).toBe("http://api.test/api/v1/rounds");
  });

  it("maps Atlas's server-scored guess, and tells 'sat out' apart from 'not sent'", async () => {
    const answer = {
      lat: 1,
      lon: 2,
      place_name: "Somewhere",
      country: "SG",
      credit: { author: null, license: null, source_url: null },
    };
    const guess = (extra: object) =>
      new Response(
        JSON.stringify({ round_id: "r", distance_km: 1, score: 4997, answer, ...extra }),
      );
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        guess({
          atlas: {
            lat: 1.3,
            lon: 103.8,
            guessed_place: "Singapore, SG",
            confidence: 0.9,
            top_countries: [{ country: "SG", p: 0.9 }],
            clues: [{ label: "City", p: 0.95 }],
            belief: { SG: 0.9, MY: 0.05 },
            distance_km: 11408,
            score: 2,
          },
        }),
      )
      .mockResolvedValueOnce(guess({ atlas: null }))
      .mockResolvedValueOnce(guess({}));
    const backend = new ApiBackend("http://api.test", fetchImpl);

    const played = await backend.guess("r", { lng: 2, lat: 1 });
    expect(played.atlas).toEqual({
      lng: 103.8,
      lat: 1.3,
      confidence: 0.9,
      guessedPlace: "Singapore, SG",
      topCountries: [{ country: "SG", p: 0.9 }],
      belief: { SG: 0.9, MY: 0.05 },
      clues: [{ label: "City", p: 0.95 }],
    });
    expect((await backend.guess("r", { lng: 2, lat: 1 })).atlas).toBeNull();
    expect("atlas" in (await backend.guess("r", { lng: 2, lat: 1 }))).toBe(false);
  });

  it("turns HTTP errors into a readable message", async () => {
    const backend = new ApiBackend(
      "http://api.test",
      vi.fn().mockResolvedValue(new Response("", { status: 503 })),
    );
    await expect(backend.startRound()).rejects.toThrow("503");
  });
});

describe("gameReducer", () => {
  const round = {
    roundId: "r",
    photo: { id: "kyoto", imageUrl: "https://example.org/k.jpg" },
  };
  const reveal: Reveal = {
    roundId: "r",
    distanceKm: 100,
    score: 4677,
    answer: { lng: 135, lat: 35, place: "Kyoto", country: "JP", credit: null },
  };
  const atlas: AtlasGuess = {
    lng: 135,
    lat: 35,
    confidence: 0.9,
    topCountries: [],
    clues: [],
  };

  function playRound(state: GameState, withAtlas = true): GameState {
    state = gameReducer(state, { type: "started", round });
    state = gameReducer(state, { type: "pinned", pin: { lng: 135, lat: 34 } });
    state = gameReducer(state, { type: "submitted" });
    return gameReducer(state, {
      type: "revealed",
      reveal,
      atlas: withAtlas ? atlas : null,
    });
  }

  it("cannot submit before a pin is placed", () => {
    const s = gameReducer(gameReducer(initialState, { type: "started", round }), {
      type: "submitted",
    });
    expect(s.phase === "guessing" && s.submitting).toBe(false);
  });

  it("scores Atlas's guess against the revealed answer", () => {
    const s = playRound(initialState);
    expect(s.phase).toBe("revealed");
    if (s.phase !== "revealed") return;
    expect(s.current.atlas?.distanceKm).toBe(0);
    expect(s.current.atlas?.score).toBe(MAX_POINTS);
  });

  it("finishes after the last round and totals both players", () => {
    let s: GameState = initialState;
    for (let i = 0; i < ROUNDS_PER_GAME; i++) {
      s = playRound(s);
      s = gameReducer(s, { type: "next" });
    }
    expect(s.phase).toBe("finished");
    const t = totals(s.phase === "finished" ? s.results : []);
    expect(t.player).toBe(4677 * ROUNDS_PER_GAME);
    expect(t.atlas).toBe(MAX_POINTS * ROUNDS_PER_GAME);
    expect(t.playerWins).toBe(0);
  });

  it("keeps the pin and shows the error when a guess fails", () => {
    let s = gameReducer(initialState, { type: "started", round });
    s = gameReducer(s, { type: "pinned", pin: { lng: 1, lat: 1 } });
    s = gameReducer(s, { type: "submitted" });
    s = gameReducer(s, { type: "failed", message: "Network down" });
    expect(s.phase === "guessing" && s.pin && s.error).toBe("Network down");
  });

  it("ignores a second submit while the first is in flight", () => {
    let s = gameReducer(initialState, { type: "started", round });
    s = gameReducer(s, { type: "pinned", pin: { lng: 1, lat: 1 } });
    s = gameReducer(s, { type: "submitted" });
    expect(gameReducer(s, { type: "submitted" })).toBe(s);
  });

  it("locks the pin while a guess is being scored", () => {
    let s = gameReducer(initialState, { type: "started", round });
    s = gameReducer(s, { type: "pinned", pin: { lng: 1, lat: 1 } });
    s = gameReducer(s, { type: "submitted" });
    s = gameReducer(s, { type: "pinned", pin: { lng: 50, lat: 50 } });
    expect(s.phase === "guessing" && s.pin).toEqual({ lng: 1, lat: 1 });
  });

  it("counts wins for each side and ignores ties", () => {
    const base = playRound(initialState);
    if (base.phase !== "revealed") throw new Error("expected a revealed round");
    const win = {
      ...base.current,
      reveal: { ...base.current.reveal, score: 5000 },
      atlas: { ...base.current.atlas!, score: 10 },
    };
    const loss = {
      ...base.current,
      reveal: { ...base.current.reveal, score: 10 },
      atlas: { ...base.current.atlas!, score: 5000 },
    };
    const tie = {
      ...base.current,
      reveal: { ...base.current.reveal, score: 300 },
      atlas: { ...base.current.atlas!, score: 300 },
    };
    const t = totals([win, loss, tie]);
    expect([t.playerWins, t.atlasWins, t.atlasRounds]).toEqual([1, 1, 3]);
  });

  it("restarts from scratch", () => {
    expect(gameReducer(playRound(initialState), { type: "restart" })).toBe(initialState);
  });

  it("works without Atlas data", () => {
    const s = playRound(initialState, false);
    expect(s.phase === "revealed" && s.current.atlas).toBeNull();
  });
});
