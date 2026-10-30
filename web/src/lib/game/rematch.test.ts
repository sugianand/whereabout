import { describe, expect, it } from "vitest";

import {
  MAX_REMATCH,
  REMATCH_KEY,
  keepForRematch,
  loadRematch,
  noteRound,
  parseRematch,
  pickRematch,
  rematchOutcome,
  type AtlasWin,
  type RematchStore,
} from "./rematch";

function memoryStore(
  initial: Record<string, string> = {},
): RematchStore & { data: typeof initial } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const win = (id: string, score: number, atlas: number): AtlasWin => ({ id, score, atlas });

describe("noteRound", () => {
  it("keeps a first try that Atlas beat, with both scores", () => {
    expect(noteRound([], { id: "a", score: 1200, atlas: 4100 }, true)).toEqual([
      win("a", 1200, 4100),
    ]);
  });

  it("ignores a first try you won or tied, or one Atlas sat out", () => {
    expect(noteRound([], { id: "a", score: 4100, atlas: 1200 }, true)).toEqual([]);
    expect(noteRound([], { id: "a", score: 3000, atlas: 3000 }, true)).toEqual([]);
    expect(noteRound([], { id: "a", score: 0, atlas: null }, true)).toEqual([]);
  });

  it("ignores a photo played before, even when Atlas beat you on it", () => {
    expect(noteRound([], { id: "a", score: 10, atlas: 5000 }, false)).toEqual([]);
  });

  it("never lowers the bar: a rematch lost again keeps the first try", () => {
    const pool = [win("a", 1200, 4100)];
    expect(noteRound(pool, { id: "a", score: 300, atlas: 4100 }, true)).toEqual(pool);
    expect(noteRound(pool, { id: "a", score: 3900, atlas: 4100 }, false)).toEqual(pool);
  });

  it("lets a photo go once you beat Atlas on it, in any game", () => {
    const pool = [win("a", 1200, 4100), win("b", 0, 900)];
    expect(noteRound(pool, { id: "a", score: 4200, atlas: 4100 }, false)).toEqual([
      win("b", 0, 900),
    ]);
  });

  it("keeps the newest photos when the pool is full", () => {
    const pool = [win("a", 0, 10), win("b", 0, 10)];
    expect(noteRound(pool, { id: "c", score: 0, atlas: 10 }, true, 2).map((w) => w.id)).toEqual([
      "b",
      "c",
    ]);
  });

  it("does not change the pool it was given", () => {
    const pool = [win("a", 0, 10)];
    noteRound(pool, { id: "b", score: 0, atlas: 10 }, true);
    expect(pool).toEqual([win("a", 0, 10)]);
  });
});

describe("pickRematch", () => {
  const pool = [
    win("a", 4000, 4100), // by 100
    win("b", 0, 5000), // by 5000
    win("c", 1000, 3000), // by 2000
    win("d", 2000, 4000), // by 2000
    win("e", 100, 1100), // by 1000
    win("f", 0, 4500), // by 4500
  ];

  it("deals the five Atlas beat you by the most, with your first tries to beat", () => {
    expect(pickRematch(pool, ["a", "b", "c", "d", "e", "f"])).toEqual({
      ids: ["b", "f", "c", "d", "e"],
      scores: [0, 0, 1000, 2000, 100],
    });
  });

  it("only deals photos the game still has", () => {
    expect(pickRematch(pool, ["a", "c", "d", "e", "f"])?.ids).toEqual(["f", "c", "d", "e", "a"]);
  });

  it("offers nothing until there are five", () => {
    expect(pickRematch(pool.slice(0, 4), ["a", "b", "c", "d", "e", "f"])).toBeNull();
    expect(pickRematch(pool, ["a", "b", "c", "d"])).toBeNull();
  });
});

describe("rematchOutcome", () => {
  it("compares this try with the first", () => {
    expect(rematchOutcome(3000, 1000)).toBe("better");
    expect(rematchOutcome(1000, 3000)).toBe("worse");
    expect(rematchOutcome(1000, 1000)).toBe("same");
  });
});

describe("parseRematch", () => {
  it("reads nothing from nothing, bad JSON or a non-list", () => {
    expect(parseRematch(null)).toEqual([]);
    expect(parseRematch("{oops")).toEqual([]);
    expect(parseRematch('{"a":1}')).toEqual([]);
  });

  it("drops malformed entries one by one and keeps the rest", () => {
    const raw = JSON.stringify([
      win("a", 10, 20),
      { id: "b", score: 30, atlas: 20 }, // Atlas did not win
      { id: "c", score: -1, atlas: 20 },
      { id: "d", score: 1.5, atlas: 20 },
      { id: "e", score: 0, atlas: 99999 },
      { id: "bad id!", score: 0, atlas: 10 },
      "f",
      win("g", 0, 5000),
    ]);
    expect(parseRematch(raw)).toEqual([win("a", 10, 20), win("g", 0, 5000)]);
  });

  it("keeps a photo's first entry and the newest entries under the cap", () => {
    expect(parseRematch(JSON.stringify([win("a", 0, 10), win("a", 5, 9)]))).toEqual([
      win("a", 0, 10),
    ]);
    const many = Array.from({ length: MAX_REMATCH + 3 }, (_, i) => win(`p${i}`, 0, 10));
    const read = parseRematch(JSON.stringify(many));
    expect(read).toHaveLength(MAX_REMATCH);
    expect(read[0].id).toBe("p3");
  });
});

describe("keepForRematch / loadRematch", () => {
  it("round-trips the pool through storage", () => {
    const store = memoryStore();
    keepForRematch({ id: "a", score: 0, atlas: 3000 }, true, store);
    keepForRematch({ id: "b", score: 100, atlas: 50 }, true, store);
    expect(loadRematch(store)).toEqual([win("a", 0, 3000)]);
    expect(JSON.parse(store.data[REMATCH_KEY])).toEqual([win("a", 0, 3000)]);
  });

  it("plays on when storage is missing or throws", () => {
    const broken: RematchStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(loadRematch(null)).toEqual([]);
    expect(loadRematch(broken)).toEqual([]);
    expect(keepForRematch({ id: "a", score: 0, atlas: 10 }, true, broken)).toEqual([
      win("a", 0, 10),
    ]);
  });
});
