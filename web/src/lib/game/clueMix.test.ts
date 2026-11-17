import { afterEach, describe, expect, it } from "vitest";

import { CONTINENTS } from "@/lib/continents";
import { CLIMATE_GROUPS, GROUND_COVERS } from "@/lib/trueClues";

import {
  bundledClimateGroups,
  bundledContinents,
  bundledDrivingSides,
  bundledGroundCovers,
} from "./bundled";
import {
  BEST_CLUE_MIX_KEY,
  CLUE_CYCLE,
  GROUND_CLUE_FROM,
  THREE_CLUE_CYCLE,
  answerName,
  atlasClueRead,
  clueAt,
  clueCycleFor,
  clueAnswers,
  clueAtlasLine,
  clueMixOver,
  clueMixReducer,
  clueTruth,
  clueTruthLine,
  continentMap,
  dealClueMix,
  initialClueMix,
  loadBestClueMix,
  rememberClueMix,
  type ClueMaps,
  type ClueMixState,
} from "./clueMix";

afterEach(() => localStorage.clear());

const BUNDLED: ClueMaps = {
  sides: bundledDrivingSides,
  climates: bundledClimateGroups,
  continents: bundledContinents,
  grounds: bundledGroundCovers,
};

// A lopsided deck, like the catalog: mostly right-hand, temperate, European photos.
function lopsided(): ClueMaps {
  const sides: Record<string, "left" | "right"> = {};
  const climates: Record<string, (typeof CLIMATE_GROUPS)[number]> = {};
  const continents: Record<string, (typeof CONTINENTS)[number]> = {};
  const grounds: Record<string, (typeof GROUND_COVERS)[number]> = {};
  for (let i = 0; i < 300; i++) {
    const id = `p${i}`;
    sides[id] = i % 10 === 0 ? "left" : "right";
    climates[id] = i % 15 === 0 ? "Polar" : i % 3 === 0 ? "Arid" : "Temperate";
    continents[id] = i % 7 === 0 ? "Asia" : i % 11 === 0 ? "Africa" : "Europe";
    grounds[id] = i % 13 === 0 ? "Permanent water bodies" : i % 4 === 0 ? "Tree cover" : "Built-up";
  }
  return { sides, climates, continents, grounds };
}

describe("dealClueMix", () => {
  it("asks the road, the climate, the continent and the ground in turn, each photo once", () => {
    const order = dealClueMix(BUNDLED, 7);
    expect(order.length).toBeGreaterThan(30);
    order.forEach((step, i) =>
      expect(step.clue).toBe(["road", "climate", "continent", "ground"][i % 4]),
    );
    expect(new Set(order.map((s) => s.id)).size).toBe(order.length);
    // Every step's photo has an answer to the clue it asks.
    for (const step of order) expect(clueTruth(step.clue, step.id, BUNDLED)).not.toBeNull();
  });

  it("deals a three-clue run that never asks the ground, whatever the ground map holds", () => {
    const three = dealClueMix(BUNDLED, 7, [], THREE_CLUE_CYCLE);
    expect(three.length).toBeGreaterThan(30);
    three.forEach((step, i) => expect(step.clue).toBe(THREE_CLUE_CYCLE[i % 3]));
    // The ground's piles aren't dealt from, so a run dealt before it joined deals the same.
    expect(dealClueMix({ ...BUNDLED, grounds: {} }, 7, [], THREE_CLUE_CYCLE)).toEqual(three);
    // The four-clue run shuffles the first three clues' piles alike: the same first photos.
    expect(dealClueMix(BUNDLED, 7).slice(0, 3)).toEqual(three.slice(0, 3));
  });

  it("picks a cycle up after the photos already shown", () => {
    const after = dealClueMix(BUNDLED, 9)
      .slice(0, 3)
      .map((s) => s.id);
    const rest = dealClueMix(BUNDLED, 9, after);
    expect(rest[0].clue).toBe("ground");
    expect(rest[1].clue).toBe("road");
    expect(rest.some((s) => after.includes(s.id))).toBe(false);
  });

  it("is pure in the seed and differs between seeds", () => {
    expect(dealClueMix(BUNDLED, 42)).toEqual(dealClueMix(BUNDLED, 42));
    expect(dealClueMix(BUNDLED, 42)).not.toEqual(dealClueMix(BUNDLED, 43));
  });

  it("deals each clue's answers evenly, so always giving one answer is a guess", () => {
    const maps = lopsided();
    const firsts: Record<string, Record<string, number>> = {
      road: {},
      climate: {},
      continent: {},
      ground: {},
    };
    const runs = 3000;
    for (let seed = 0; seed < runs; seed++) {
      for (const step of dealClueMix(maps, seed).slice(0, 4)) {
        const truth = clueTruth(step.clue, step.id, maps)!;
        firsts[step.clue][truth] = (firsts[step.clue][truth] ?? 0) + 1;
      }
    }
    // Each clue's first step lands on each of its answers about equally often.
    const share = (clue: string, answer: string, of: number) =>
      (firsts[clue][answer] ?? 0) / runs - 1 / of;
    for (const side of ["left", "right"])
      expect(Math.abs(share("road", side, 2))).toBeLessThan(0.04);
    for (const g of ["Polar", "Arid", "Temperate"])
      expect(Math.abs(share("climate", g, 3))).toBeLessThan(0.04);
    for (const c of ["Asia", "Africa", "Europe"])
      expect(Math.abs(share("continent", c, 3))).toBeLessThan(0.04);
    // Most photos are built-up, yet each cover the deck holds comes first about a third of runs.
    for (const g of ["Built-up", "Tree cover", "Permanent water bodies"])
      expect(Math.abs(share("ground", g, 3))).toBeLessThan(0.04);
  });

  it("ends before a clue with only one answer left, and deals nothing from one-answer maps", () => {
    const one: ClueMaps = {
      sides: { a: "right", b: "right" },
      climates: { a: "Arid", b: "Polar" },
      continents: { a: "Asia", b: "Europe" },
      grounds: { a: "Built-up", b: "Grassland" },
    };
    expect(dealClueMix(one, 1)).toEqual([]);

    // Two left and two right photos: the road runs out of left photos after a few steps.
    const small: ClueMaps = {
      sides: { a: "left", b: "right", c: "left", d: "right" },
      climates: { a: "Arid", b: "Polar", c: "Arid", d: "Polar" },
      continents: { a: "Asia", b: "Europe", c: "Asia", d: "Europe" },
      grounds: { a: "Built-up", b: "Grassland", c: "Built-up", d: "Grassland" },
    };
    for (let seed = 0; seed < 50; seed++) {
      const order = dealClueMix(small, seed);
      expect(order.length).toBeGreaterThanOrEqual(1);
      expect(order.length).toBeLessThanOrEqual(4);
      expect(new Set(order.map((s) => s.id)).size).toBe(order.length);
    }
  });

  it("deals a long run from the bundled photos on any seed", () => {
    for (let seed = 0; seed < 20; seed++)
      expect(dealClueMix(BUNDLED, seed).length).toBeGreaterThan(30);
  });

  it("ends before the ground when the deck's photos all share one cover", () => {
    const flat = lopsided();
    const grounds = Object.fromEntries(Object.keys(flat.grounds).map((id) => [id, "Grassland"]));
    const order = dealClueMix({ ...flat, grounds: grounds as ClueMaps["grounds"] }, 3);
    expect(order.map((s) => s.clue)).toEqual(["road", "climate", "continent"]);
  });
});

describe("the cycle", () => {
  it("asks four clues from the day the ground joined, three before it", () => {
    expect(CLUE_CYCLE).toEqual(["road", "climate", "continent", "ground"]);
    expect(GROUND_CLUE_FROM).toBe("2026-11-18");
    expect(clueCycleFor("2026-11-17")).toBe(THREE_CLUE_CYCLE);
    expect(clueCycleFor("2026-11-18")).toBe(CLUE_CYCLE);
    expect(clueCycleFor("2027-01-01")).toBe(CLUE_CYCLE);
  });

  it("names the clue at each place of a run's own cycle", () => {
    expect([0, 1, 2, 3, 4].map((i) => clueAt(i))).toEqual([
      "road",
      "climate",
      "continent",
      "ground",
      "road",
    ]);
    expect(clueAt(3, THREE_CLUE_CYCLE)).toBe("road");
  });
});

describe("clueAnswers", () => {
  it("offers both sides, the five climates and the continents the deck holds", () => {
    expect(clueAnswers("road", BUNDLED)).toEqual(["left", "right"]);
    expect(clueAnswers("climate", BUNDLED)).toEqual(CLIMATE_GROUPS);
    const maps = lopsided();
    expect(clueAnswers("continent", maps)).toEqual(["Africa", "Asia", "Europe"]);
    expect(clueAnswers("ground", BUNDLED)).toEqual(GROUND_COVERS);
  });

  it("names the ground's answers as What's on the ground? does", () => {
    expect(clueAnswers("ground", BUNDLED).map((g) => answerName("ground", g))).toEqual([
      "Built-up",
      "Trees",
      "Grassland",
      "Water",
      "Bare ground",
    ]);
  });

  it("never offers more than seven buttons, the keys the controls list", () => {
    expect(clueAnswers("continent", BUNDLED).length).toBeLessThanOrEqual(7);
  });
});

describe("clueTruth", () => {
  it("reads the photo's own label, and nothing for a missing or inherited key", () => {
    const maps = lopsided();
    expect(clueTruth("road", "p0", maps)).toBe("left");
    expect(clueTruth("climate", "p0", maps)).toBe("Polar");
    expect(clueTruth("continent", "p0", maps)).toBe("Asia");
    expect(clueTruth("ground", "p0", maps)).toBe("Permanent water bodies");
    expect(clueTruth("road", "nope", maps)).toBeNull();
    expect(clueTruth("road", "constructor", maps)).toBeNull();
  });
});

describe("atlasClueRead", () => {
  const atlas = {
    clues: [
      { label: "Drives on the left", p: 0.8 },
      { label: "Arid climate", p: 0.6 },
    ],
    topCountries: [
      { country: "FR", p: 0.2 },
      { country: "JP", p: 0.5 },
    ],
  };
  it("reads each clue the way the other games score Atlas", () => {
    expect(atlasClueRead("road", atlas)).toBe("left");
    expect(atlasClueRead("climate", atlas)).toBe("Arid");
    // The continent of the country it gave most, not the first listed.
    expect(atlasClueRead("continent", atlas)).toBe("Asia");
  });
  it("reads the ground from a scene clue that names a cover", () => {
    const city = { clues: [{ label: "City", p: 0.4 }], topCountries: [] };
    expect(atlasClueRead("ground", city)).toBe("Built-up");
    const coast = { clues: [{ label: "Coast", p: 0.4 }], topCountries: [] };
    expect(atlasClueRead("ground", coast)).toBe("Permanent water bodies");
    expect(atlasClueRead("ground", atlas)).toBeNull();
  });
  it("sits out what it said nothing about", () => {
    expect(atlasClueRead("climate", { clues: [], topCountries: [] })).toBeNull();
    expect(atlasClueRead("continent", { clues: [], topCountries: [] })).toBeNull();
    expect(atlasClueRead("road", null)).toBeNull();
  });
});

describe("clueMixReducer", () => {
  const order = [
    { id: "a", clue: "road" as const },
    { id: "b", clue: "climate" as const },
  ];
  const started = () => clueMixReducer(initialClueMix, { type: "start", order });

  it("counts right calls and Atlas's reads, and plays on to a cleared run", () => {
    let s: ClueMixState = started();
    expect(s.phase).toBe("picking");
    s = clueMixReducer(s, { type: "picked", answer: "left", truth: "left", atlas: "right" });
    expect(s).toMatchObject({ phase: "answered", streak: 1, atlasRight: 0, atlasPlayed: 1 });
    expect(clueMixOver(s)).toBe(false);
    s = clueMixReducer(s, { type: "next" });
    expect(s).toMatchObject({ phase: "picking", index: 1 });
    s = clueMixReducer(s, { type: "picked", answer: "Arid", truth: "Arid", atlas: null });
    expect(s).toMatchObject({ streak: 2, atlasPlayed: 1 });
    if (s.phase !== "answered") throw new Error("expected an answer");
    expect(s.verdict.clue).toBe("climate");
    s = clueMixReducer(s, { type: "next" });
    expect(s.phase).toBe("cleared");
    expect(clueMixOver(s)).toBe(true);
  });

  it("ends on a wrong call, and ignores picks out of turn", () => {
    let s: ClueMixState = started();
    s = clueMixReducer(s, { type: "picked", answer: "right", truth: "left", atlas: "left" });
    expect(s).toMatchObject({ streak: 0, atlasRight: 1 });
    expect(clueMixOver(s)).toBe(true);
    expect(clueMixReducer(s, { type: "next" })).toBe(s);
    expect(clueMixReducer(s, { type: "picked", answer: "a", truth: "a", atlas: null })).toBe(s);
  });

  it("starts cleared when nothing could be dealt", () => {
    expect(clueMixReducer(initialClueMix, { type: "start", order: [] }).phase).toBe("cleared");
  });

  it("picks a kept run up at the step after its streak, with Atlas's tally so far", () => {
    const from = { streak: 1, atlasRight: 1, atlasPlayed: 1 };
    const s = clueMixReducer(initialClueMix, { type: "start", order, from });
    expect(s).toMatchObject({ phase: "picking", index: 1, streak: 1, atlasRight: 1 });
    // A run kept past the last step dealt has nothing left to ask.
    const done = { streak: 2, atlasRight: 0, atlasPlayed: 2 };
    expect(clueMixReducer(initialClueMix, { type: "start", order, from: done }).phase).toBe(
      "cleared",
    );
  });
});

describe("words", () => {
  it("names the answer for each clue", () => {
    expect(clueTruthLine("road", "left", "JP")).toBe("In Japan they drive on the left.");
    expect(clueTruthLine("climate", "Arid", "EG")).toBe("An arid climate, in Egypt.");
    expect(clueTruthLine("climate", "Polar", "NO")).toBe("A polar climate, in Norway.");
    expect(clueTruthLine("continent", "Europe", "GB")).toBe(
      "Taken in the United Kingdom, in Europe.",
    );
    expect(clueTruthLine("ground", "Tree cover", "JP")).toBe(
      "Mostly trees around it, in Japan: woods and forest.",
    );
    expect(clueTruthLine("ground", "Bare / sparse vegetation", "EG")).toBe(
      "Mostly bare ground around it, in Egypt: rock, sand or soil, little growing.",
    );
  });
  it("says what Atlas read, or that it said nothing", () => {
    expect(clueAtlasLine("road", { picked: "left", correct: true })).toBe(
      "Atlas called the left, and got it.",
    );
    expect(clueAtlasLine("climate", { picked: "Arid", correct: false })).toBe(
      "Atlas read it as arid: wrong.",
    );
    expect(clueAtlasLine("continent", { picked: "Asia", correct: true })).toBe(
      "Atlas placed it in Asia, and got it.",
    );
    expect(clueAtlasLine("ground", { picked: "Permanent water bodies", correct: false })).toBe(
      "Atlas read the ground as water: wrong.",
    );
    expect(clueAtlasLine("ground", null)).toBe(
      "Atlas said nothing about the ground here: no call for it.",
    );
    expect(clueAtlasLine("climate", null)).toBe(
      "Atlas said nothing about the climate here: no call for it.",
    );
  });
});

describe("continentMap", () => {
  it("maps known countries and leaves unknown ones out", () => {
    expect(
      continentMap([
        { id: "a", country: "JP" },
        { id: "b", country: "br" },
        { id: "c", country: "ZZ" },
      ]),
    ).toEqual({ a: "Asia", b: "South America" });
  });
});

describe("the best", () => {
  it("keeps only a longer run, and refuses junk", () => {
    expect(loadBestClueMix()).toBe(0);
    expect(rememberClueMix(3)).toBe(3);
    expect(rememberClueMix(2)).toBe(3);
    expect(localStorage.getItem(BEST_CLUE_MIX_KEY)).toBe("3");
    localStorage.setItem(BEST_CLUE_MIX_KEY, '"lots"');
    expect(loadBestClueMix()).toBe(0);
    localStorage.setItem(BEST_CLUE_MIX_KEY, "-4");
    expect(loadBestClueMix()).toBe(0);
  });
});
