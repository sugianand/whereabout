import { afterEach, describe, expect, it, vi } from "vitest";

import { bundledById, bundledDeck, bundledFooledIds } from "./bundled";
import type { GameRecord } from "./deck";
import {
  BEST_FOOLED_KEY,
  NEAR_KM,
  TIE_RATIO,
  atlasFooledPick,
  atlasMissKm,
  atlasSureness,
  fooledIds,
  fooledOver,
  fooledReducer,
  initialFooled,
  judgeFooled,
  loadBestFooled,
  rememberFooled,
  surenessWords,
  tooClose,
  type FooledAction,
  type FooledState,
} from "./fooledAtlas";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function record(
  id: string,
  atlas: { lat: number; lng: number; confidence: number } | null,
): GameRecord {
  return {
    photo: {
      id,
      imageUrl: `https://upload.wikimedia.org/${id}.jpg`,
      lng: 0,
      lat: 0,
      place: id,
      country: "GH",
      credit: { author: "A", license: "CC BY 4.0", sourceUrl: "https://c" },
    },
    atlas: atlas ? { ...atlas, topCountries: [], clues: [] } : null,
  };
}

const pick = (
  side: "a" | "b",
  missA: number,
  missB: number,
  sureA: number | null = null,
  sureB: number | null = null,
): FooledAction => ({ type: "picked", side, missA, missB, sureA, sureB });

const run = (state: FooledState, ...actions: FooledAction[]) =>
  actions.reduce(fooledReducer, state);

describe("which photos can be dealt", () => {
  it("measures Atlas's miss from the photo to its pin", () => {
    // One degree of latitude is about 111 km.
    expect(atlasMissKm(record("a", { lat: 1, lng: 0, confidence: 0.5 }))).toBeCloseTo(111.2, 1);
    expect(atlasMissKm(record("b", null))).toBeNull();
    expect(atlasMissKm(record("c", { lat: Number.NaN, lng: 0, confidence: 0.5 }))).toBeNull();
  });

  it("deals only photos Atlas pinned", () => {
    const records = [
      record("a", { lat: 1, lng: 0, confidence: 0.5 }),
      record("b", null),
      record("c", { lat: 0, lng: 3, confidence: 0.1 }),
    ];
    expect(fooledIds(records)).toEqual(["a", "c"]);
  });

  it("deals from the real catalog, where Atlas's misses run from near to far", () => {
    expect(bundledFooledIds.length).toBeGreaterThanOrEqual(2);
    for (const id of bundledFooledIds) expect(bundledDeck.ids).toContain(id);
    const misses = bundledFooledIds.map((id) => atlasMissKm(bundledById.get(id)!)!);
    expect(misses.some((km) => km < 500)).toBe(true);
    expect(misses.some((km) => km > 2000)).toBe(true);
  });

  it("reads Atlas's sureness only as a probability", () => {
    expect(atlasSureness(record("a", { lat: 0, lng: 0, confidence: 0.42 }))).toBe(0.42);
    expect(atlasSureness(record("b", null))).toBeNull();
    expect(atlasSureness(record("c", { lat: 0, lng: 0, confidence: 1.4 }))).toBeNull();
    expect(atlasSureness(record("d", { lat: 0, lng: 0, confidence: Number.NaN }))).toBeNull();
  });
});

describe("judgeFooled", () => {
  it("is right when the picked photo is the one Atlas missed by more", () => {
    expect(judgeFooled("a", 4000, 300)).toMatchObject({ fooled: "a", tie: false, correct: true });
    expect(judgeFooled("a", 300, 4000)).toMatchObject({ fooled: "b", tie: false, correct: false });
  });

  it("counts either pick when the misses are too close to call", () => {
    expect(tooClose(1000, 1000 * TIE_RATIO)).toBe(true);
    expect(tooClose(1000, 1000 * TIE_RATIO + 1)).toBe(false);
    // Both near bullseyes, however many times apart.
    expect(tooClose(1, NEAR_KM - 1)).toBe(true);
    expect(tooClose(1, NEAR_KM)).toBe(false);
    expect(judgeFooled("b", 900, 700)).toMatchObject({ fooled: "a", tie: true, correct: true });
  });

  it("lets Atlas pick the photo it was less sure of", () => {
    expect(atlasFooledPick(0.9, 0.2)).toBe("b");
    expect(atlasFooledPick(0.1, 0.6)).toBe("a");
    expect(atlasFooledPick(0.5, 0.5)).toBe("a");
    expect(atlasFooledPick(null, 0.5)).toBeNull();
  });
});

describe("fooledReducer", () => {
  const order = ["p1", "p2", "p3", "p4"];

  it("starts on the first pair, or cleared with fewer than two photos", () => {
    expect(run(initialFooled, { type: "start", order })).toMatchObject({
      phase: "picking",
      index: 0,
      streak: 0,
    });
    expect(run(initialFooled, { type: "start", order: ["p1"] }).phase).toBe("cleared");
  });

  it("plays on after a right pick, keeping Atlas's tally beside yours", () => {
    const state = run(
      initialFooled,
      { type: "start", order },
      pick("a", 5000, 100, 0.2, 0.9), // you right, Atlas picks a: right
      { type: "next" },
      pick("b", 100, 5000, 0.2, 0.9), // you right, Atlas picks a: wrong
    );
    expect(state).toMatchObject({ phase: "answered", index: 1, streak: 2 });
    expect(state).toMatchObject({ atlasRight: 1, atlasPlayed: 2 });
    expect(fooledOver(state)).toBe(false);
  });

  it("ends on the first wrong pick and ignores next", () => {
    const state = run(initialFooled, { type: "start", order }, pick("b", 5000, 100));
    expect(state).toMatchObject({ phase: "answered", streak: 0, atlas: null, atlasPlayed: 0 });
    expect(fooledOver(state)).toBe(true);
    expect(fooledReducer(state, { type: "next" })).toBe(state);
  });

  it("clears once every photo has been played", () => {
    const state = run(
      initialFooled,
      { type: "start", order: ["p1", "p2", "p3"] },
      pick("a", 5000, 100),
      { type: "next" },
      pick("b", 100, 5000),
      { type: "next" },
    );
    expect(state).toMatchObject({ phase: "cleared", streak: 2 });
    expect(fooledOver(state)).toBe(true);
  });

  it("ignores a pick while not picking", () => {
    expect(fooledReducer(initialFooled, pick("a", 1, 2))).toBe(initialFooled);
  });
});

describe("surenessWords", () => {
  it("puts Atlas's probability in words", () => {
    expect(surenessWords(0.9)).toBe("very sure");
    expect(surenessWords(0.5)).toBe("fairly sure");
    expect(surenessWords(0.3)).toBe("unsure");
    expect(surenessWords(0.05)).toBe("guessing");
  });
});

describe("the best streak", () => {
  it("keeps only a longer streak", () => {
    expect(loadBestFooled()).toBe(0);
    expect(rememberFooled(3)).toBe(3);
    expect(rememberFooled(2)).toBe(3);
    expect(loadBestFooled()).toBe(3);
  });

  it("refuses junk", () => {
    localStorage.setItem(BEST_FOOLED_KEY, "-4");
    expect(loadBestFooled()).toBe(0);
    localStorage.setItem(BEST_FOOLED_KEY, "{");
    expect(loadBestFooled()).toBe(0);
    localStorage.setItem(BEST_FOOLED_KEY, "2.5");
    expect(loadBestFooled()).toBe(0);
  });

  it("survives blocked storage", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(rememberFooled(5)).toBe(5);
  });
});
