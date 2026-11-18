import { afterEach, describe, expect, it } from "vitest";

import { GROUND_COVERS, atlasGroundCover } from "@/lib/trueClues";

import { bundledGroundCovers } from "./bundled";
import {
  BEST_GROUND_KEY,
  GROUND_PHOTOS,
  dealGround,
  groundAtlasLine,
  groundMap,
  groundReducer,
  groundTotals,
  groundTruthLine,
  groundVerdict,
  initialGround,
  loadBestGround,
  rememberGround,
  type GroundMap,
  type GroundState,
} from "./onTheGround";

afterEach(() => localStorage.clear());

// A lopsided deck, like the catalog: many built-up photos, one of bare ground.
const LOPSIDED: GroundMap = {
  ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`b${i}`, "Built-up"])),
  t1: "Tree cover",
  t2: "Tree cover",
  t3: "Tree cover",
  g1: "Grassland",
  g2: "Grassland",
  w1: "Permanent water bodies",
  w2: "Permanent water bodies",
  s1: "Bare / sparse vegetation",
};

describe("dealGround", () => {
  it("deals five different photos, the same for the same seed", () => {
    const order = dealGround(LOPSIDED, 7);
    expect(order).toHaveLength(GROUND_PHOTOS);
    expect(new Set(order).size).toBe(GROUND_PHOTOS);
    expect(dealGround(LOPSIDED, 7)).toEqual(order);
    expect(dealGround(LOPSIDED, 8)).not.toEqual(order);
  });

  it("draws each cover about as often, so always naming one cover scores about a fifth", () => {
    const counts = Object.fromEntries(GROUND_COVERS.map((c) => [c, 0]));
    const games = 400;
    for (let seed = 0; seed < games; seed++) {
      for (const id of dealGround(LOPSIDED, seed)) counts[LOPSIDED[id]]++;
    }
    const share = (c: string) => counts[c] / (games * GROUND_PHOTOS);
    // Built-up is 40 of 48 photos, but only its fair share of a game.
    expect(share("Built-up")).toBeLessThan(0.3);
    expect(share("Tree cover")).toBeGreaterThan(0.12);
    expect(share("Bare / sparse vegetation")).toBeGreaterThan(0.1);
  });

  it("deals every cover from the bundled catalog across games", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      const order = dealGround(bundledGroundCovers, seed);
      expect(order).toHaveLength(GROUND_PHOTOS);
      for (const id of order) seen.add(bundledGroundCovers[id]);
    }
    expect(seen.size).toBe(GROUND_COVERS.length);
  });

  it("deals nothing when the photos can't fill a fair game", () => {
    expect(dealGround({ a: "Built-up", b: "Grassland" }, 1)).toEqual([]);
    const oneCover = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`x${i}`, "Grassland"]),
    );
    expect(dealGround(oneCover as GroundMap, 1)).toEqual([]);
  });
});

describe("groundMap", () => {
  it("keeps only photos labelled with one of the five covers", () => {
    expect(
      groundMap([
        { id: "a", landCover: "Built-up" },
        { id: "b", landCover: "Shrubland" },
        { id: "c" },
        { id: "d", landCover: "Permanent water bodies" },
        { id: "e", landCover: "constructor" },
      ]),
    ).toEqual({ a: "Built-up", d: "Permanent water bodies" });
  });

  it("leaves the catalog's rare covers out of the bundled deck", () => {
    const covers = new Set(Object.values(bundledGroundCovers));
    expect([...covers].sort()).toEqual([...GROUND_COVERS].sort());
  });
});

describe("atlasGroundCover", () => {
  const read = (...labels: string[]) => ({ clues: labels.map((label) => ({ label, p: 0.9 })) });

  it("reads a city, a skyline or an old town as built-up, and a coast as water", () => {
    expect(atlasGroundCover(read("City"))).toBe("Built-up");
    expect(atlasGroundCover(read("Modern skyline"))).toBe("Built-up");
    expect(atlasGroundCover(read("Tropical climate", "European old town"))).toBe("Built-up");
    expect(atlasGroundCover(read("Mountains", "Coast"))).toBe("Permanent water bodies");
  });

  it("takes the first clue that names a cover", () => {
    expect(atlasGroundCover(read("Coast", "City"))).toBe("Permanent water bodies");
    expect(atlasGroundCover(read("City", "Coast"))).toBe("Built-up");
  });

  it("sits out clues that could mean several covers, and no read at all", () => {
    expect(
      atlasGroundCover(read("No buildings", "Village", "Countryside", "Mountains")),
    ).toBeNull();
    expect(atlasGroundCover(read())).toBeNull();
    expect(atlasGroundCover(null)).toBeNull();
    expect(atlasGroundCover(undefined)).toBeNull();
  });
});

describe("groundReducer", () => {
  const order = ["p1", "p2"];

  it("plays each photo to an answer and ends after the last", () => {
    let s: GroundState = groundReducer(initialGround, { type: "start", order });
    expect(s.phase).toBe("picking");
    s = groundReducer(s, { type: "picked", cover: "Grassland", truth: "Grassland", atlas: null });
    expect(s).toMatchObject({ phase: "answered", results: [{ id: "p1", correct: true }] });
    // A second pick on the answer is ignored.
    expect(
      groundReducer(s, { type: "picked", cover: "Built-up", truth: "Built-up", atlas: null }),
    ).toBe(s);
    s = groundReducer(s, { type: "next" });
    expect(s.phase).toBe("picking");
    s = groundReducer(s, {
      type: "picked",
      cover: "Built-up",
      truth: "Tree cover",
      atlas: "Built-up",
    });
    expect(s).toMatchObject({ results: [{}, { id: "p2", correct: false, atlas: "Built-up" }] });
    s = groundReducer(s, { type: "next" });
    expect(s.phase).toBe("done");
    expect(groundReducer(s, { type: "next" })).toBe(s);
  });

  it("ends at once on an empty deal", () => {
    expect(groundReducer(initialGround, { type: "start", order: [] })).toEqual({
      phase: "done",
      order: [],
      results: [],
    });
  });

  it("picks up after the calls already made, and is done when they cover the game", () => {
    const kept = [
      { id: "p1", picked: "Grassland", truth: "Grassland", correct: true, atlas: null },
    ] as const;
    const s = groundReducer(initialGround, { type: "start", order: ["p1", "p2"], from: kept });
    expect(s).toMatchObject({ phase: "picking", results: kept });
    expect(
      groundReducer(initialGround, { type: "start", order: ["p1"], from: kept }),
    ).toMatchObject({ phase: "done", results: kept });
  });
});

describe("words and totals", () => {
  it("counts your points and Atlas's over the photos it read", () => {
    const totals = groundTotals([
      { id: "a", picked: "Built-up", truth: "Built-up", correct: true, atlas: "Built-up" },
      { id: "b", picked: "Grassland", truth: "Tree cover", correct: false, atlas: null },
      {
        id: "c",
        picked: "Permanent water bodies",
        truth: "Permanent water bodies",
        correct: true,
        atlas: "Built-up",
      },
    ]);
    expect(totals).toEqual({ right: 2, atlasRight: 1, atlasRead: 2 });
  });

  it("says the answer, Atlas's call and who won", () => {
    expect(groundTruthLine("Permanent water bodies")).toBe(
      "Mostly water around it: sea, lake or river all year.",
    );
    expect(groundTruthLine("Bare / sparse vegetation")).toBe(
      "Mostly bare ground around it: rock, sand or soil, little growing.",
    );
    expect(groundAtlasLine("Built-up", "Built-up")).toBe("Atlas read it as built-up, and got it.");
    expect(groundAtlasLine("Permanent water bodies", "Grassland")).toBe(
      "Atlas read it as water: wrong.",
    );
    expect(groundAtlasLine(null, "Grassland")).toMatch(/no point for it/);
    expect(groundVerdict(4, 2)).toBe("You beat Atlas 4 to 2.");
    expect(groundVerdict(1, 3)).toBe("Atlas wins 3 to 1.");
    expect(groundVerdict(2, 2)).toBe("You and Atlas tie on 2.");
  });
});

describe("the best game", () => {
  it("keeps the most photos named right, and only a better game replaces it", () => {
    expect(loadBestGround()).toBe(0);
    expect(rememberGround(3)).toBe(3);
    expect(rememberGround(2)).toBe(3);
    expect(rememberGround(5)).toBe(5);
    expect(loadBestGround()).toBe(5);
  });

  it("refuses junk kept under its key", () => {
    for (const junk of ["{", "6", "-1", "2.5", '"4"']) {
      localStorage.setItem(BEST_GROUND_KEY, junk);
      expect(loadBestGround()).toBe(0);
    }
  });
});
