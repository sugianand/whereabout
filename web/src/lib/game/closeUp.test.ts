import { beforeEach, describe, expect, it } from "vitest";

import {
  BEST_CLOSE_KEY,
  CLOSE_MAX,
  CLOSE_PHOTOS,
  atlasTries,
  closePoints,
  closeReducer,
  closeTotals,
  dealClose,
  initialClose,
  loadBestClose,
  rememberClose,
  type CloseResult,
  type CloseState,
} from "./closeUp";
import type { AtlasGuess } from "./types";

const OPTIONS = ["FR", "DE", "IT", "ES"];

function atlas(belief: Record<string, number>): AtlasGuess {
  return { lng: 0, lat: 0, confidence: 0.5, topCountries: [], belief, clues: [] };
}

function pick(state: CloseState, country: string, truth = "FR", guess: AtlasGuess | null = null) {
  return closeReducer(state, { type: "picked", country, options: OPTIONS, truth, atlas: guess });
}

const start = (order: string[] = ["a", "b"]) =>
  closeReducer(initialClose, { type: "start", order, seed: 7 });

describe("closePoints", () => {
  it("costs a point for each wrong name, and pays nothing after the third", () => {
    expect([0, 1, 2, 3].map(closePoints)).toEqual([3, 2, 1, 0]);
    expect(CLOSE_MAX).toBe(15);
  });
});

describe("dealClose", () => {
  const ids = Array.from({ length: 30 }, (_, i) => `p${i}`);

  it("deals five different photos, the same for the same seed", () => {
    const hand = dealClose(ids, 11);
    expect(hand).toHaveLength(CLOSE_PHOTOS);
    expect(new Set(hand).size).toBe(CLOSE_PHOTOS);
    expect(dealClose(ids, 11)).toEqual(hand);
    expect(dealClose(ids, 12)).not.toEqual(hand);
  });

  it("deals what there is from a small deck", () => {
    expect(dealClose(["a", "b"], 1).sort()).toEqual(["a", "b"]);
  });
});

describe("atlasTries", () => {
  it("tries the names in the order of what it gave them", () => {
    const tries = atlasTries(atlas({ DE: 0.5, FR: 0.3, ES: 0.1 }), OPTIONS, "FR");
    expect(tries).toEqual({ order: ["DE", "FR", "ES"], rank: 1, points: 2 });
  });

  it("scores its last place as nothing, like a third wrong name", () => {
    const belief = { DE: 0.4, IT: 0.3, ES: 0.2, FR: 0.1 };
    expect(atlasTries(atlas(belief), OPTIONS, "FR")).toMatchObject({ rank: 3, points: 0 });
  });

  it("would never try a name it gave nothing, so that truth scores it none", () => {
    expect(atlasTries(atlas({ DE: 0.9 }), OPTIONS, "FR")).toEqual({
      order: ["DE"],
      rank: null,
      points: 0,
    });
  });

  it("reads its top countries when its belief leaves a name out", () => {
    const guess = { ...atlas({}), topCountries: [{ country: "FR", p: 0.2 }] };
    expect(atlasTries(guess, OPTIONS, "FR")).toMatchObject({ rank: 0, points: 3 });
  });

  it("breaks ties by the names' order, so the same screen always reads the same", () => {
    const tries = atlasTries(atlas({ ES: 0.2, DE: 0.2 }), OPTIONS, "FR");
    expect(tries?.order).toEqual(["DE", "ES"]);
  });

  it("sits out a photo it never guessed, or where it gave none of the four anything", () => {
    expect(atlasTries(null, OPTIONS, "FR")).toBeNull();
    expect(atlasTries(atlas({ JP: 0.9 }), OPTIONS, "FR")).toBeNull();
  });
});

describe("closeReducer", () => {
  it("has nothing to deal from an empty deck", () => {
    expect(start([]).phase).toBe("none");
  });

  it("pays three points for a first-try name", () => {
    const state = pick(start(), "FR");
    expect(state).toMatchObject({ phase: "answered", found: true, truth: "FR" });
    expect(state.phase === "answered" && state.result.points).toBe(3);
  });

  it("stays on the photo after a wrong name, a point cheaper", () => {
    const once = pick(start(), "DE");
    expect(once).toMatchObject({ phase: "guessing", wrong: ["DE"], index: 0 });
    const found = pick(once, "FR");
    expect(found.phase === "answered" && found.result.points).toBe(2);
  });

  it("ignores a name already ruled out and one that isn't on offer", () => {
    const once = pick(start(), "DE");
    expect(pick(once, "DE")).toBe(once);
    expect(pick(once, "JP")).toBe(once);
  });

  it("ends the photo on the third wrong name, on nothing", () => {
    let state = start();
    for (const name of ["DE", "IT", "ES"]) state = pick(state, name);
    expect(state).toMatchObject({ phase: "answered", found: false, truth: "FR" });
    expect(state.phase === "answered" && state.result.points).toBe(0);
  });

  it("clears the wrong names for the next photo, and ends after the last", () => {
    const next = closeReducer(pick(pick(start(), "DE"), "FR"), { type: "next" });
    expect(next).toMatchObject({ phase: "guessing", index: 1, wrong: [] });
    const over = closeReducer(pick(next, "FR"), { type: "next" });
    expect(over.phase).toBe("over");
    expect(over.phase === "over" && over.results.map((r) => r.points)).toEqual([2, 3]);
  });

  it("does nothing out of turn", () => {
    expect(closeReducer(initialClose, { type: "next" })).toBe(initialClose);
    expect(closeReducer(start(), { type: "next" }).phase).toBe("guessing");
  });
});

describe("closeTotals", () => {
  it("sets Atlas against your points on only the photos it played", () => {
    const tried = { order: ["FR"], rank: 0, points: 3 };
    const results: CloseResult[] = [
      { id: "a", points: 2, atlas: tried },
      { id: "b", points: 3, atlas: null },
    ];
    expect(closeTotals(results)).toEqual({ you: 5, youOnPlayed: 2, atlas: 3, atlasPlayed: 1 });
  });
});

describe("the best", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the most points, and refuses junk", () => {
    expect(loadBestClose()).toBe(0);
    expect(rememberClose(9)).toBe(9);
    expect(rememberClose(4)).toBe(9);
    expect(loadBestClose()).toBe(9);
    localStorage.setItem(BEST_CLOSE_KEY, '"lots"');
    expect(loadBestClose()).toBe(0);
  });
});
