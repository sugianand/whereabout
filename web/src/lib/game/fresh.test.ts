import { describe, expect, it } from "vitest";

import { RECENT_KEY, loadRecent, pickFresh, rememberPlayed, saveRecent } from "./fresh";
import { mulberry32 } from "./daily";

const catalog = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}` }));
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("pickFresh", () => {
  it("deals five distinct photos from the catalog", () => {
    const game = ids(pickFresh(catalog, [], 5, mulberry32(1)));
    expect(game).toHaveLength(5);
    expect(new Set(game).size).toBe(5);
  });

  it("skips every recently played photo while enough unseen ones remain", () => {
    const recent = ids(catalog.slice(0, 7));
    for (let seed = 0; seed < 50; seed++) {
      const game = ids(pickFresh(catalog, recent, 5, mulberry32(seed)));
      expect(game.sort()).toEqual(ids(catalog.slice(7)).sort());
    }
  });

  it("tops up with the photos seen longest ago when the unseen pool runs short", () => {
    const recent = ids(catalog.slice(0, 10)); // p0 oldest ... p9 newest; p10, p11 unseen
    const game = ids(pickFresh(catalog, recent, 5, mulberry32(3)));
    expect(game.slice(0, 2).sort()).toEqual(["p10", "p11"]);
    expect(game.slice(2)).toEqual(["p0", "p1", "p2"]);
  });

  it("differs between games", () => {
    const random = mulberry32(9);
    const a = ids(pickFresh(catalog, [], 5, random));
    const b = ids(pickFresh(catalog, [], 5, random));
    expect(a).not.toEqual(b);
  });

  it("cycles the whole catalog before repeating when memory is capped at catalog minus game", () => {
    const random = mulberry32(5);
    let recent: string[] = [];
    const seen = new Set<string>();
    // 12 photos, games of 3: four games cover the catalog with no repeats.
    for (let g = 0; g < 4; g++) {
      const game = ids(pickFresh(catalog, recent, 3, random));
      for (const id of game) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      recent = rememberPlayed(recent, game, catalog.length - 3);
    }
    expect(seen.size).toBe(12);
  });
});

describe("rememberPlayed", () => {
  it("appends newest last, moves replays to the end and caps the length", () => {
    expect(rememberPlayed(["a", "b", "c"], ["b", "d"], 10)).toEqual(["a", "c", "b", "d"]);
    expect(rememberPlayed(["a", "b", "c"], ["d", "e"], 3)).toEqual(["c", "d", "e"]);
    expect(rememberPlayed(["a"], ["b"], 0)).toEqual([]);
  });
});

describe("recent-photo storage", () => {
  it("round-trips ids through the store", () => {
    const store = fakeStore();
    saveRecent(["a", "b"], store);
    expect(store.data.get(RECENT_KEY)).toBe('["a","b"]');
    expect(loadRecent(store)).toEqual(["a", "b"]);
  });

  it("treats missing, corrupt or foreign data as an empty memory", () => {
    expect(loadRecent(fakeStore())).toEqual([]);
    expect(loadRecent(fakeStore({ [RECENT_KEY]: "{not json" }))).toEqual([]);
    expect(loadRecent(fakeStore({ [RECENT_KEY]: '{"a":1}' }))).toEqual([]);
    expect(loadRecent(fakeStore({ [RECENT_KEY]: '["a",2,null,"b"]' }))).toEqual(["a", "b"]);
    expect(loadRecent(null)).toEqual([]);
  });

  it("survives a store that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(loadRecent(broken)).toEqual([]);
    expect(() => saveRecent(["a"], broken)).not.toThrow();
  });
});
