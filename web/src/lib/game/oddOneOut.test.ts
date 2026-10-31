import { beforeEach, describe, expect, it } from "vitest";

import { continentOf } from "@/lib/continents";

import { mulberry32 } from "./daily";
import {
  BEST_ODD_KEY,
  QUAD,
  atlasOdd,
  canDeal,
  dealQuad,
  initialOdd,
  loadBestOdd,
  oddOver,
  oddReducer,
  rememberOdd,
  type OddAction,
  type OddState,
  type Quad,
} from "./oddOneOut";
import type { Regions } from "./regions";
import type { AtlasGuess } from "./types";

const REGIONS: Regions = {
  Europe: ["e1", "e2", "e3", "e4", "e5"],
  Asia: ["a1", "a2", "a3", "a4", "a5", "a6"],
  Africa: ["f1", "f2", "f3", "f4", "f5"],
};
const CONTINENT_OF_ID = new Map(
  Object.entries(REGIONS).flatMap(([c, ids]) => ids!.map((id) => [id, c] as const)),
);

function guess(country: string, lng: number, lat: number): AtlasGuess {
  return { lng, lat, confidence: 0.5, topCountries: [{ country, p: 0.5 }], clues: [] };
}

const QUAD_A: Quad = {
  ids: ["e1", "e2", "a1", "e3"],
  odd: 2,
  common: "Europe",
  oddContinent: "Asia",
};
const QUAD_B: Quad = {
  ids: ["f1", "a2", "a3", "a4"],
  odd: 0,
  common: "Asia",
  oddContinent: "Africa",
};
const PARIS = guess("FR", 2.35, 48.86);
const BERLIN = guess("DE", 13.4, 52.5);
const ROME = guess("IT", 12.5, 41.9);
const TOKYO = guess("JP", 139.7, 35.7);
const ISTANBUL = guess("TR", 28.97, 41.0);

describe("dealQuad", () => {
  it("deals three photos from one continent and one from another, at a random place", () => {
    const random = mulberry32(7);
    const odds = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const quad = dealQuad(REGIONS, random)!;
      expect(quad.ids).toHaveLength(QUAD);
      expect(new Set(quad.ids).size).toBe(QUAD);
      expect(quad.common).not.toBe(quad.oddContinent);
      quad.ids.forEach((id, j) =>
        expect(CONTINENT_OF_ID.get(id)).toBe(j === quad.odd ? quad.oddContinent : quad.common),
      );
      odds.add(quad.odd);
    }
    // Over many deals the odd photo turns up in every slot.
    expect([...odds].sort()).toEqual([0, 1, 2, 3]);
  });

  it("keeps back photos already dealt while each continent has fresh ones", () => {
    const random = mulberry32(3);
    const seen = new Set<string>();
    // Nine photos a continent: three quads can never run one dry.
    const big: Regions = {
      Europe: Array.from({ length: 9 }, (_, i) => `e${i}`),
      Asia: Array.from({ length: 9 }, (_, i) => `a${i}`),
    };
    for (let i = 0; i < 3; i++) {
      const quad = dealQuad(big, random, seen)!;
      for (const id of quad.ids) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    // Once a continent runs low it deals from all its photos again rather than stopping.
    const all = new Set(Object.values(REGIONS).flat());
    expect(dealQuad(REGIONS, random, all)).not.toBeNull();
  });

  it("needs a continent with three photos and another with one", () => {
    expect(canDeal(REGIONS)).toBe(true);
    expect(canDeal({ Europe: ["e1", "e2", "e3", "e4", "e5"] })).toBe(false);
    expect(canDeal({ Europe: ["e1", "e2"], Asia: ["a1", "a2"] })).toBe(false);
    expect(canDeal({})).toBe(false);
    expect(dealQuad({ Asia: REGIONS.Asia })).toBeNull();
    // The bare minimum deals the only possible quad's continents.
    const quad = dealQuad({ Europe: ["e1", "e2", "e3"], Asia: ["a1"] }, () => 0.99)!;
    expect(quad).toMatchObject({ common: "Europe", oddContinent: "Asia", odd: 3 });
    expect(quad.ids).toEqual(expect.arrayContaining(["e1", "e2", "e3", "a1"]));
  });

  it("deals from the site's real continents", async () => {
    const { bundledDeck } = await import("./bundled");
    const quad = dealQuad(bundledDeck.regions, mulberry32(1))!;
    expect(quad).not.toBeNull();
    const { bundledById } = await import("./bundled");
    quad.ids.forEach((id, j) =>
      expect(continentOf(bundledById.get(id)!.photo.country)).toBe(
        j === quad.odd ? quad.oddContinent : quad.common,
      ),
    );
  });
});

describe("atlasOdd", () => {
  it("picks the one photo it read on a different continent from the other three", () => {
    expect(atlasOdd([PARIS, BERLIN, TOKYO, ROME], 2)).toEqual({
      picked: 2,
      continents: ["Europe", "Europe", "Asia", "Europe"],
      byContinent: true,
      correct: true,
    });
    // Atlas read the odd photo as European too, and Rome as Asian: it picks Rome, wrongly.
    expect(atlasOdd([PARIS, BERLIN, ISTANBUL, ROME], 3)).toMatchObject({
      picked: 2,
      byContinent: true,
      correct: false,
    });
  });

  it("falls back on the pin furthest from its other three when the continents don't split", () => {
    // All four read as Europe: Atlas picks the guess furthest from the rest.
    const allEurope = atlasOdd([PARIS, BERLIN, ROME, guess("PT", -9.14, 38.7)], 3);
    expect(allEurope).toMatchObject({ picked: 3, byContinent: false, correct: true });
    // Two and two: the same rule decides.
    const split = atlasOdd([PARIS, TOKYO, BERLIN, guess("KR", 127, 37.5)], 0);
    expect(split?.byContinent).toBe(false);
    expect(split?.picked).toBeGreaterThanOrEqual(0);
  });

  it("sits out a quad with a photo it never guessed", () => {
    expect(atlasOdd([PARIS, null, TOKYO, ROME], 2)).toBeNull();
    expect(atlasOdd([PARIS, TOKYO], 1)).toBeNull();
  });
});

const run = (state: OddState, ...actions: OddAction[]) => actions.reduce(oddReducer, state);
const start: OddAction = { type: "start", quad: QUAD_A, upcoming: QUAD_B };

describe("oddReducer", () => {
  it("starts on the first quad, or says there is nothing to deal", () => {
    expect(run(initialOdd, start)).toMatchObject({ phase: "picking", quad: QUAD_A, streak: 0 });
    expect(run(initialOdd, { type: "start", quad: null, upcoming: null })).toEqual({
      phase: "none",
    });
  });

  it("counts a right tap, tallies Atlas and moves on to the upcoming quad", () => {
    const answered = run(initialOdd, start, {
      type: "picked",
      index: 2,
      atlas: [PARIS, BERLIN, TOKYO, ROME],
    });
    expect(answered).toMatchObject({
      phase: "answered",
      picked: 2,
      correct: true,
      streak: 1,
      atlasRight: 1,
      atlasPlayed: 1,
    });
    expect(oddOver(answered)).toBe(false);
    const next = run(answered, { type: "next", upcoming: QUAD_A });
    expect(next).toMatchObject({ phase: "picking", quad: QUAD_B, upcoming: QUAD_A, streak: 1 });
  });

  it("ends the run on a wrong tap, which no 'next' gets past", () => {
    const wrong = run(initialOdd, start, {
      type: "picked",
      index: 0,
      atlas: [null, null, null, null],
    });
    expect(wrong).toMatchObject({ phase: "answered", correct: false, streak: 0, atlas: null });
    expect(wrong).toMatchObject({ atlasPlayed: 0 });
    expect(oddOver(wrong)).toBe(true);
    expect(run(wrong, { type: "next", upcoming: QUAD_A })).toBe(wrong);
  });

  it("ignores taps outside the four photos and taps after answering", () => {
    const picking = run(initialOdd, start);
    expect(run(picking, { type: "picked", index: 4, atlas: [] })).toBe(picking);
    expect(run(picking, { type: "picked", index: -1, atlas: [] })).toBe(picking);
    const answered = run(picking, { type: "picked", index: 2, atlas: [] });
    expect(run(answered, { type: "picked", index: 0, atlas: [] })).toBe(answered);
    expect(run(initialOdd, { type: "picked", index: 0, atlas: [] })).toBe(initialOdd);
  });
});

describe("best run", () => {
  beforeEach(() => localStorage.clear());

  it("keeps only a better run, and reads nothing odd back", () => {
    expect(loadBestOdd()).toBe(0);
    expect(rememberOdd(3)).toBe(3);
    expect(rememberOdd(2)).toBe(3);
    expect(localStorage.getItem(BEST_ODD_KEY)).toBe("3");
    for (const bad of ["-2", "1.5", '"7"', "{", "null"]) {
      localStorage.setItem(BEST_ODD_KEY, bad);
      expect(loadBestOdd()).toBe(0);
    }
  });
});
