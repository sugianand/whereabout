import { describe, expect, it } from "vitest";

import {
  MAX_PLAYED,
  PLAYED_KEY,
  addPlayed,
  forgetPlayed,
  keepOnMap,
  loadPlayed,
  parsePlayed,
  playedFeatures,
  summarizePlayed,
  type PlayedPhoto,
  type PlayedStore,
} from "./playedMap";

function memoryStore(): PlayedStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: PlayedStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("quota");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

function photo(id: string, over: Partial<PlayedPhoto> = {}): PlayedPhoto {
  return {
    id,
    lng: 2.35,
    lat: 48.86,
    place: "Paris",
    country: "FR",
    km: 120,
    score: 4600,
    day: "2026-10-30",
    ...over,
  };
}

describe("addPlayed", () => {
  it("adds newest last and replays a photo by moving it to the end with its new result", () => {
    let h = addPlayed([], photo("a"));
    h = addPlayed(h, photo("b"));
    h = addPlayed(h, photo("a", { km: 5, score: 4983 }));
    expect(h.map((p) => p.id)).toEqual(["b", "a"]);
    expect(h[1]).toMatchObject({ km: 5, score: 4983 });
  });

  it("keeps only the newest photos once the cap is reached", () => {
    let h: PlayedPhoto[] = [];
    for (let i = 0; i < 5; i++) h = addPlayed(h, photo(`p${i}`), 3);
    expect(h.map((p) => p.id)).toEqual(["p2", "p3", "p4"]);
  });

  it("does not change the history it was given", () => {
    const h = [photo("a")];
    addPlayed(h, photo("b"));
    expect(h).toHaveLength(1);
  });
});

describe("parsePlayed", () => {
  it("round-trips a stored history", () => {
    const h = [photo("a"), photo("b", { km: null, score: 0, country: null })];
    expect(parsePlayed(JSON.stringify(h))).toEqual(h);
  });

  it.each([null, "", "not json", "{}", '"x"', "42"])("reads %j as empty", (raw) => {
    expect(parsePlayed(raw)).toEqual([]);
  });

  it.each([
    ["a missing id", { id: "" }],
    ["a longitude off the globe", { lng: 200 }],
    ["a latitude off the globe", { lat: -91 }],
    ["a non-numeric distance", { km: "far" }],
    ["a negative distance", { km: -1 }],
    ["a distance longer than half the globe", { km: 30_000 }],
    ["a fractional score", { score: 12.5 }],
    ["a score above the maximum", { score: 5001 }],
    ["a lower-case country", { country: "fr" }],
    ["a malformed day", { day: "30/10/2026" }],
    ["a place that is not text", { place: 7 }],
  ])("drops only the entry with %s", (_, bad) => {
    const raw = JSON.stringify([photo("good"), { ...photo("bad"), ...bad }, null, [1]]);
    expect(parsePlayed(raw).map((p) => p.id)).toEqual(["good"]);
  });

  it("drops fields it does not know", () => {
    const raw = JSON.stringify([{ ...photo("a"), extra: "<script>" }]);
    expect(parsePlayed(raw)[0]).toEqual(photo("a"));
  });

  it("keeps a photo listed twice once, with its later entry, and applies the cap", () => {
    const raw = JSON.stringify([photo("a"), photo("b"), photo("a", { score: 1 })]);
    expect(parsePlayed(raw).map((p) => [p.id, p.score])).toEqual([
      ["b", 4600],
      ["a", 1],
    ]);
    expect(parsePlayed(raw, 1).map((p) => p.id)).toEqual(["a"]);
  });
});

describe("summarizePlayed", () => {
  it("counts photos, countries and continents, and sorts countries by photos", () => {
    const s = summarizePlayed([
      photo("a", { country: "JP", km: 10 }),
      photo("b", { country: "FR", km: 300 }),
      photo("c", { country: "JP", km: 1500 }),
      photo("d", { country: null, km: null }),
      photo("e", { country: "BR", km: 9000 }),
    ]);
    expect(s.photos).toBe(5);
    expect(s.countries).toEqual([
      { code: "JP", photos: 2 },
      { code: "BR", photos: 1 },
      { code: "FR", photos: 1 },
    ]);
    expect(s.continents).toEqual(["Asia", "Europe", "South America"]);
    expect(s.bands).toEqual({ bullseye: 1, close: 1, near: 1, far: 2 });
  });

  it("is all zeros for an empty history", () => {
    expect(summarizePlayed([])).toEqual({
      photos: 0,
      countries: [],
      continents: [],
      bands: { bullseye: 0, close: 0, near: 0, far: 0 },
    });
  });
});

describe("playedFeatures", () => {
  it("makes one point per photo, tagged with its closeness band", () => {
    const fc = playedFeatures([
      photo("a", { lng: 139.7, lat: 35.7, km: 3 }),
      photo("b", { km: null }),
    ]);
    expect(fc.features).toEqual([
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [139.7, 35.7] },
        properties: { id: "a", band: "bullseye" },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [2.35, 48.86] },
        properties: { id: "b", band: "far" },
      },
    ]);
  });
});

describe("storage", () => {
  it("keeps each round in the store and reads it back", () => {
    const store = memoryStore();
    keepOnMap(photo("a"), store);
    keepOnMap(photo("b"), store);
    expect(loadPlayed(store).map((p) => p.id)).toEqual(["a", "b"]);
    expect(JSON.parse(store.data.get(PLAYED_KEY)!)).toHaveLength(2);
    forgetPlayed(store);
    expect(loadPlayed(store)).toEqual([]);
  });

  it("never throws when storage is blocked or full", () => {
    expect(loadPlayed(throwing)).toEqual([]);
    expect(keepOnMap(photo("a"), throwing).map((p) => p.id)).toEqual(["a"]);
    expect(() => forgetPlayed(throwing)).not.toThrow();
    expect(loadPlayed(null)).toEqual([]);
  });

  it("caps the stored history", () => {
    const store = memoryStore();
    for (let i = 0; i < MAX_PLAYED + 3; i++) keepOnMap(photo(`p${i}`), store);
    const h = loadPlayed(store);
    expect(h).toHaveLength(MAX_PLAYED);
    expect(h[0].id).toBe("p3");
  });
});
