import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import catalog from "@/data/photos.json";
import { CONTINENT_OF } from "@/lib/continents";
import { ApiBackend, LocalBackend } from "@/lib/game/backends";
import { gameReducer, initialState, type GameState } from "@/lib/game/state";
import type { CatalogPhoto, RoundStart } from "@/lib/game/types";
import { MAX_HINTS, MAX_POINTS_BY_HINTS, haversineKm, maxPoints, scoreDistance } from "@/lib/geo";

import { cluesFor, type Clue } from "./hints";

// The API's rules, written out by api/src/whereabout_api: the same hints must give the same
// clues and the same score in the static game and on the server.
type Fixture = {
  max_points_by_hints: number[];
  scores: { distance_km: number; hints: number; score: number }[];
  photos: {
    name: string;
    country: string;
    driving_side: string | null;
    climate_group: string | null;
    clues: Clue[];
  }[];
  continents: Record<string, string>;
};
const fixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "../data/fixtures/hint_cases.json"), "utf8"),
) as Fixture;

describe("parity with the API (data/fixtures/hint_cases.json)", () => {
  it("lowers the maximum by the same table", () => {
    expect([...MAX_POINTS_BY_HINTS]).toEqual(fixture.max_points_by_hints);
    expect(MAX_HINTS).toBe(3);
  });

  it.each(fixture.scores)("$distance_km km after $hints hints scores $score", (c) => {
    expect(scoreDistance(c.distance_km, c.hints)).toBe(c.score);
  });

  it.each(fixture.photos)("gives the same clues: $name", (c) => {
    expect(
      cluesFor({ country: c.country, drivingSide: c.driving_side, climateGroup: c.climate_group }),
    ).toEqual(c.clues);
  });

  it("uses the same continent table", () => {
    expect(Object.fromEntries(CONTINENT_OF)).toEqual(fixture.continents);
  });
});

describe("hint scoring", () => {
  it("never pays more for a hint", () => {
    for (const d of [0, 50, 900, 4000, 19000]) {
      const scores = [0, 1, 2, 3].map((h) => scoreDistance(d, h));
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
  });

  it.each([-1, 4, 1.5])("rejects %s hints", (h) => {
    expect(() => maxPoints(h)).toThrow(RangeError);
    expect(() => scoreDistance(10, h)).toThrow(RangeError);
  });
});

describe("the bundled catalog's hints", () => {
  const photos = catalog as CatalogPhoto[];

  it("offers every photo at least its continent", () => {
    for (const p of photos) expect(cluesFor(p)[0]?.kind).toBe("continent");
  });

  it("carries the driving side and climate from the concept labels", () => {
    expect(photos.some((p) => cluesFor(p).length === 3)).toBe(true);
  });

  it("never names the place, the country or the photo", () => {
    for (const p of photos) {
      const text = cluesFor(p)
        .map((c) => c.text)
        .join(" ");
      const placeWords = p.place
        .split(/[\s,()]+/)
        .filter(
          (w) =>
            w.length > 3 &&
            !/^(Asia|Europe|Africa|Oceania|America|North|South|Antarctica)$/i.test(w),
        );
      for (const w of placeWords) expect(text).not.toContain(w);
    }
  });
});

const KYOTO: CatalogPhoto = {
  id: "kyoto",
  imageUrl: "https://example.org/k.jpg",
  lng: 135.7681,
  lat: 35.0116,
  place: "Kyoto, Japan",
  country: "JP",
  drivingSide: "left",
  climateGroup: "Temperate",
  credit: { author: "Ann", license: "CC BY 4.0", sourceUrl: "https://example.org/k" },
};
const OSAKA = { lng: 135.5023, lat: 34.6937 };

describe("LocalBackend hints", () => {
  it("gives the clues one at a time and scores the guess with them", async () => {
    const backend = new LocalBackend([KYOTO]);
    const round = await backend.startRound();
    expect(round.hintsAvailable).toBe(3);
    expect(JSON.stringify(round)).not.toContain("Asia");
    expect(await backend.hint(round.roundId)).toEqual([
      { kind: "continent", text: "It's in Asia" },
    ]);
    const two = await backend.hint(round.roundId);
    expect(two.map((c) => c.kind)).toEqual(["continent", "driving_side"]);
    const reveal = await backend.guess(round.roundId, OSAKA);
    expect(reveal.hintsUsed).toBe(2);
    expect(reveal.score).toBe(scoreDistance(haversineKm(OSAKA, KYOTO), 2));
    await expect(backend.hint(round.roundId)).rejects.toThrow();
  });

  it("stops when the photo has no more hints", async () => {
    const backend = new LocalBackend([
      { ...KYOTO, drivingSide: undefined, climateGroup: undefined },
    ]);
    const round = await backend.startRound();
    expect(round.hintsAvailable).toBe(1);
    await backend.hint(round.roundId);
    await expect(backend.hint(round.roundId)).rejects.toThrow("No hints left");
  });
});

describe("ApiBackend hints", () => {
  it("asks the server for each hint and sends its count with the guess", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            round_id: "r1",
            hints: [{ kind: "continent", text: "It's in Asia" }],
            hints_left: 2,
            max_score: 4000,
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            round_id: "r1",
            distance_km: 30,
            score: 3921,
            hints_used: 1,
            max_score: 4000,
            answer: {
              lat: 1,
              lon: 2,
              place_name: "Somewhere",
              country: "JP",
              credit: { author: null, license: null, source_url: null },
            },
            atlas: null,
          }),
        ),
      );
    const backend = new ApiBackend("http://api.test", fetchImpl);
    expect(await backend.hint("r1")).toEqual([{ kind: "continent", text: "It's in Asia" }]);
    expect(fetchImpl.mock.calls[0][0]).toBe("http://api.test/api/v1/rounds/r1/hints");
    const reveal = await backend.guess("r1", { lng: 2, lat: 1 });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ lat: 1, lon: 2, hints_used: 1 });
    // The server's score stands: the client never rescores a hinted guess.
    expect(reveal.score).toBe(3921);
    expect(reveal.hintsUsed).toBe(1);
  });
});

describe("gameReducer hints", () => {
  const round: RoundStart = {
    roundId: "r",
    photo: { id: "kyoto", imageUrl: "https://example.org/k.jpg" },
    hintsAvailable: 2,
  };
  const continent: Clue = { kind: "continent", text: "It's in Asia" };
  const side: Clue = { kind: "driving_side", text: "Traffic drives on the left" };
  const started = () => gameReducer(initialState, { type: "started", round });

  it("adds each hint and keeps them with the round's result", () => {
    let s: GameState = started();
    s = gameReducer(s, { type: "hintRequested" });
    expect(s.phase === "guessing" && s.hinting).toBe(true);
    s = gameReducer(s, { type: "hinted", clues: [continent] });
    s = gameReducer(s, { type: "pinned", pin: { lng: 135, lat: 34 } });
    s = gameReducer(s, { type: "submitted" });
    s = gameReducer(s, {
      type: "revealed",
      atlas: null,
      reveal: {
        roundId: "r",
        distanceKm: 10,
        score: 3974,
        hintsUsed: 1,
        answer: { lng: 135, lat: 35, place: "Kyoto", country: "JP", credit: null },
      },
    });
    expect(s.phase === "revealed" && s.current.clues).toEqual([continent]);
  });

  it("asks for one hint at a time and no more than the photo offers", () => {
    let s: GameState = gameReducer(started(), { type: "hintRequested" });
    expect(gameReducer(s, { type: "hintRequested" })).toBe(s);
    s = gameReducer(s, { type: "hinted", clues: [continent] });
    s = gameReducer(s, { type: "hintRequested" });
    s = gameReducer(s, { type: "hinted", clues: [continent, side] });
    expect(gameReducer(s, { type: "hintRequested" })).toBe(s);
  });

  it("doesn't submit while a hint is on its way, and a failed hint can be retried", () => {
    let s: GameState = gameReducer(started(), { type: "pinned", pin: { lng: 1, lat: 1 } });
    s = gameReducer(s, { type: "hintRequested" });
    expect(gameReducer(s, { type: "submitted" })).toBe(s);
    s = gameReducer(s, { type: "failed", message: "Network down" });
    expect(s.phase === "guessing" && !s.hinting && s.error).toBe("Network down");
    expect(gameReducer(s, { type: "hintRequested" })).not.toBe(s);
  });

  it("no hints once the guess is being scored", () => {
    let s: GameState = gameReducer(started(), { type: "pinned", pin: { lng: 1, lat: 1 } });
    s = gameReducer(s, { type: "submitted" });
    expect(gameReducer(s, { type: "hintRequested" })).toBe(s);
  });
});
