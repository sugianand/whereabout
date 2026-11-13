import { afterEach, describe, expect, it } from "vitest";

import { CLIMATE_GROUPS } from "@/lib/trueClues";

import { bundledClimateGroups } from "./bundled";
import {
  BEST_CLIMATE_KEY,
  CLIMATE_PHOTOS,
  climateAtlasLine,
  climateMap,
  climateReducer,
  climateTotals,
  climateTruthLine,
  climateVerdict,
  dealClimate,
  initialClimate,
  latitudeLabel,
  loadBestClimate,
  rememberClimate,
  type ClimateMap,
  type ClimateState,
} from "./whichClimate";

afterEach(() => localStorage.clear());

// A lopsided deck, like the catalog: many temperate photos, one polar.
const LOPSIDED: ClimateMap = {
  ...Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`t${i}`, "Temperate"])),
  a1: "Arid",
  a2: "Arid",
  a3: "Arid",
  r1: "Tropical",
  r2: "Tropical",
  c1: "Continental",
  c2: "Continental",
  p1: "Polar",
};

describe("dealClimate", () => {
  it("deals five different photos, the same for the same seed", () => {
    const order = dealClimate(LOPSIDED, 7);
    expect(order).toHaveLength(CLIMATE_PHOTOS);
    expect(new Set(order).size).toBe(CLIMATE_PHOTOS);
    expect(dealClimate(LOPSIDED, 7)).toEqual(order);
    expect(dealClimate(LOPSIDED, 8)).not.toEqual(order);
  });

  it("draws each group about as often, so always naming one group scores about a fifth", () => {
    const counts = Object.fromEntries(CLIMATE_GROUPS.map((g) => [g, 0]));
    const games = 400;
    for (let seed = 0; seed < games; seed++) {
      for (const id of dealClimate(LOPSIDED, seed)) counts[LOPSIDED[id]]++;
    }
    const share = (g: string) => counts[g] / (games * CLIMATE_PHOTOS);
    // Temperate is 40 of 48 photos, but only its fair share of a game.
    expect(share("Temperate")).toBeLessThan(0.3);
    expect(share("Arid")).toBeGreaterThan(0.12);
    expect(share("Polar")).toBeGreaterThan(0.1);
  });

  it("deals every group from the bundled catalog across games", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      const order = dealClimate(bundledClimateGroups, seed);
      expect(order).toHaveLength(CLIMATE_PHOTOS);
      for (const id of order) seen.add(bundledClimateGroups[id]);
    }
    expect(seen.size).toBe(CLIMATE_GROUPS.length);
  });

  it("deals nothing when the photos can't fill a fair game", () => {
    expect(dealClimate({ a: "Arid", b: "Polar" }, 1)).toEqual([]);
    const oneGroup = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`x${i}`, "Arid"]));
    expect(dealClimate(oneGroup as ClimateMap, 1)).toEqual([]);
  });
});

describe("climateMap", () => {
  it("keeps only photos labelled with one of the five groups", () => {
    expect(
      climateMap([
        { id: "a", climateGroup: "Arid" },
        { id: "b" },
        { id: "c", climateGroup: "Ocean" },
      ]),
    ).toEqual({ a: "Arid" });
  });
});

describe("climateReducer", () => {
  const order = ["a", "b"];
  const start = climateReducer(initialClimate, { type: "start", order });

  it("plays each photo through an answer, then ends after the last", () => {
    expect(start).toMatchObject({ phase: "picking", results: [] });
    let s: ClimateState = climateReducer(start, {
      type: "picked",
      group: "Arid",
      truth: "Arid",
      atlas: "Temperate",
    });
    expect(s).toMatchObject({
      phase: "answered",
      results: [{ id: "a", picked: "Arid", truth: "Arid", correct: true, atlas: "Temperate" }],
    });
    // A second call on the answer screen is ignored.
    expect(climateReducer(s, { type: "picked", group: "Polar", truth: "Arid", atlas: null })).toBe(
      s,
    );
    s = climateReducer(s, { type: "next" });
    expect(s.phase).toBe("picking");
    s = climateReducer(s, { type: "picked", group: "Polar", truth: "Tropical", atlas: null });
    expect(s.phase === "answered" && s.results[1]).toMatchObject({ id: "b", correct: false });
    s = climateReducer(s, { type: "next" });
    expect(s.phase).toBe("done");
    expect(s.phase === "done" && climateTotals(s.results)).toEqual({
      right: 1,
      atlasRight: 0,
      atlasRead: 1,
    });
  });

  it("ends at once with no photos to deal", () => {
    expect(climateReducer(initialClimate, { type: "start", order: [] })).toEqual({
      phase: "done",
      order: [],
      results: [],
    });
  });
});

describe("words", () => {
  it("names the group with what it means", () => {
    expect(climateTruthLine("Arid")).toBe(
      "An arid climate: dry: more water evaporates than falls.",
    );
    expect(climateTruthLine("Polar")).toBe("A polar climate: cold all year, no real summer.");
  });

  it("says what Atlas read, and when it read nothing", () => {
    expect(climateAtlasLine("Tropical", "Tropical")).toBe("Atlas read it as tropical, and got it.");
    expect(climateAtlasLine("Arid", "Temperate")).toBe("Atlas read it as arid: wrong.");
    expect(climateAtlasLine(null, "Polar")).toMatch(/said nothing about the climate/);
  });

  it("says who took the game", () => {
    expect(climateVerdict(4, 2)).toBe("You beat Atlas 4 to 2.");
    expect(climateVerdict(1, 3)).toBe("Atlas wins 3 to 1.");
    expect(climateVerdict(2, 2)).toBe("You and Atlas tie on 2.");
  });

  it("reads latitudes north and south of the equator", () => {
    expect(latitudeLabel(18.92368)).toBe("18.9° N");
    expect(latitudeLabel(-54.8)).toBe("54.8° S");
    expect(latitudeLabel(0)).toBe("0.0°");
  });
});

describe("best", () => {
  it("keeps only a better whole game, and refuses junk", () => {
    expect(loadBestClimate()).toBe(0);
    expect(rememberClimate(3)).toBe(3);
    expect(rememberClimate(2)).toBe(3);
    expect(loadBestClimate()).toBe(3);
    localStorage.setItem(BEST_CLIMATE_KEY, "9");
    expect(loadBestClimate()).toBe(0);
    localStorage.setItem(BEST_CLIMATE_KEY, "{");
    expect(loadBestClimate()).toBe(0);
  });
});
