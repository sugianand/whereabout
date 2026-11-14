import { beforeEach, describe, expect, it } from "vitest";

import { bundledClimateGroups } from "./bundled";
import { rememberClimateDay } from "./climateDaily";
import {
  CLIMATE_CALLS_KEY,
  MAX_CLIMATE_CALLS,
  canPractise,
  climateMisreads,
  dayCalls,
  groupsInWords,
  keepClimateCall,
  loadAllClimateCalls,
  loadClimateCalls,
  misreadLine,
  noteClimateCall,
  parseClimateCalls,
  photosByClimate,
  practiceDeal,
  practiceGroups,
  type ClimateCall,
} from "./climateMixUps";
import type { ClimateMap, ClimateResult } from "./whichClimate";

const GROUPS: ClimateMap = {
  t1: "Tropical",
  t2: "Tropical",
  a1: "Arid",
  a2: "Arid",
  m1: "Temperate",
  m2: "Temperate",
  m3: "Temperate",
  c1: "Continental",
  c2: "Continental",
  c3: "Continental",
  p1: "Polar",
};

const c = (truth: ClimateCall["truth"], picked: ClimateCall["picked"]): ClimateCall => ({
  truth,
  picked,
});

const result = (
  id: string,
  picked: ClimateResult["picked"],
  truth: ClimateResult["truth"],
): ClimateResult => ({ id, picked, truth, correct: picked === truth, atlas: null });

beforeEach(() => localStorage.clear());

describe("the calls log", () => {
  it("keeps the newest calls up to the cap", () => {
    let log: ClimateCall[] = [];
    for (let i = 0; i < 4; i++) log = noteClimateCall(log, c("Arid", i % 2 ? "Polar" : "Arid"), 3);
    expect(log).toEqual([c("Arid", "Polar"), c("Arid", "Arid"), c("Arid", "Polar")]);
  });

  it("reads back only well-formed calls, and never junk", () => {
    expect(parseClimateCalls("nope")).toEqual([]);
    expect(
      parseClimateCalls([
        c("Arid", "Polar"),
        { truth: "Arid" },
        { truth: "Desert", picked: "Arid" },
        null,
        ["Arid", "Polar"],
        c("Polar", "Polar"),
      ]),
    ).toEqual([c("Arid", "Polar"), c("Polar", "Polar")]);
    const many = Array.from({ length: MAX_CLIMATE_CALLS + 5 }, () => c("Arid", "Arid"));
    expect(parseClimateCalls(many)).toHaveLength(MAX_CLIMATE_CALLS);
  });

  it("keeps each free call in the browser, and survives junk in storage", () => {
    keepClimateCall("Continental", "Temperate");
    keepClimateCall("Arid", "Arid");
    expect(loadClimateCalls()).toEqual([c("Continental", "Temperate"), c("Arid", "Arid")]);
    localStorage.setItem(CLIMATE_CALLS_KEY, "{");
    expect(loadClimateCalls()).toEqual([]);
    keepClimateCall("Polar", "Arid");
    expect(loadClimateCalls()).toEqual([c("Polar", "Arid")]);
  });

  it("adds today's games, oldest day first, without the free log holding them", () => {
    rememberClimateDay("2026-11-15", [result("p1", "Arid", "Polar")]);
    rememberClimateDay("2026-11-14", [result("c1", "Temperate", "Continental")]);
    keepClimateCall("Tropical", "Tropical");
    expect(loadClimateCalls()).toHaveLength(1);
    expect(loadAllClimateCalls()).toEqual([
      c("Continental", "Temperate"),
      c("Polar", "Arid"),
      c("Tropical", "Tropical"),
    ]);
    expect(dayCalls({})).toEqual([]);
  });
});

describe("climateMisreads", () => {
  it("lists the climates called wrong most, each with what it was taken for", () => {
    const calls = [
      c("Continental", "Temperate"),
      c("Continental", "Temperate"),
      c("Continental", "Arid"),
      c("Continental", "Continental"),
      c("Arid", "Tropical"),
      c("Temperate", "Temperate"),
    ];
    expect(climateMisreads(calls)).toEqual([
      {
        group: "Continental",
        photos: 4,
        missed: 3,
        as: [
          { group: "Temperate", times: 2 },
          { group: "Arid", times: 1 },
        ],
      },
      { group: "Arid", photos: 1, missed: 1, as: [{ group: "Tropical", times: 1 }] },
    ]);
  });

  it("breaks a tie by the miss rate, then Köppen's order, and keeps the top few", () => {
    const calls = [
      c("Polar", "Arid"),
      c("Polar", "Polar"),
      c("Tropical", "Arid"),
      c("Arid", "Polar"),
      c("Temperate", "Arid"),
    ];
    expect(climateMisreads(calls).map((m) => m.group)).toEqual(["Tropical", "Arid", "Temperate"]);
    expect(climateMisreads(calls, 5).map((m) => m.group)).toEqual([
      "Tropical",
      "Arid",
      "Temperate",
      "Polar",
    ]);
  });

  it("is empty when every call was right", () => {
    expect(climateMisreads([c("Arid", "Arid"), c("Polar", "Polar")])).toEqual([]);
  });

  it("says each in words", () => {
    const [m] = climateMisreads([
      c("Continental", "Temperate"),
      c("Continental", "Temperate"),
      c("Continental", "Arid"),
      c("Continental", "Polar"),
      c("Continental", "Continental"),
    ]);
    expect(misreadLine(m)).toBe(
      "You called 4 of 5 continental photos wrong: temperate twice, arid once and polar once.",
    );
    expect(misreadLine(climateMisreads([c("Arid", "Tropical")])[0])).toBe(
      "You called 1 of 1 arid photo wrong: tropical once.",
    );
  });
});

describe("the practice game", () => {
  const calls = [
    c("Continental", "Temperate"),
    c("Continental", "Temperate"),
    c("Polar", "Arid"),
    c("Tropical", "Temperate"),
    c("Tropical", "Tropical"),
  ];

  it("is dealt from the top two misreads and what each was taken for", () => {
    // Continental (as temperate) and polar (as arid, 1 of 1); tropical (1 of 2) sits out.
    expect(practiceGroups(climateMisreads(calls))).toEqual([
      "Arid",
      "Temperate",
      "Continental",
      "Polar",
    ]);
    expect(practiceGroups(climateMisreads([c("Polar", "Arid")]))).toEqual(["Arid", "Polar"]);
    expect(practiceGroups([])).toEqual([]);
  });

  it("deals five photos of only those climates, pure in the seed", () => {
    const practice = ["Temperate", "Continental"] as const;
    const deal = practiceDeal(GROUPS, practice, 7);
    expect(deal).toHaveLength(5);
    expect(new Set(deal).size).toBe(5);
    expect(deal.every((id) => practice.includes(GROUPS[id] as (typeof practice)[number]))).toBe(
      true,
    );
    expect(practiceDeal(GROUPS, practice, 7)).toEqual(deal);
    // Over many seeds both climates come up, near evenly.
    let continental = 0;
    for (let seed = 0; seed < 200; seed++) {
      continental += practiceDeal(GROUPS, practice, seed).filter(
        (id) => GROUPS[id] === "Continental",
      ).length;
    }
    expect(continental / 1000).toBeGreaterThan(0.4);
    expect(continental / 1000).toBeLessThan(0.62);
  });

  it("deals nothing when those climates can't fill a game", () => {
    expect(practiceDeal(GROUPS, ["Tropical", "Arid"], 1)).toEqual([]);
    expect(practiceDeal(GROUPS, [], 1)).toEqual([]);
  });

  it("is offered only when the photos are there", () => {
    const counts = photosByClimate(GROUPS);
    expect(counts).toEqual({ Tropical: 2, Arid: 2, Temperate: 3, Continental: 3, Polar: 1 });
    expect(canPractise(counts, ["Temperate", "Continental"])).toBe(true);
    expect(canPractise(counts, ["Tropical", "Arid"])).toBe(false);
    expect(canPractise({ Temperate: 9 }, ["Temperate", "Polar"])).toBe(false);
  });

  it("can practise any two climates the bundled photos hold", () => {
    const counts = photosByClimate(bundledClimateGroups);
    const held = (Object.keys(counts) as (keyof typeof counts)[]).filter((g) => counts[g]! > 0);
    for (const a of held) {
      for (const b of held) {
        if (a >= b || counts[a]! + counts[b]! < 5) continue;
        expect(canPractise(counts, [a, b])).toBe(true);
        expect(practiceDeal(bundledClimateGroups, [a, b], 3)).toHaveLength(5);
      }
    }
  });

  it("names its climates in words", () => {
    expect(groupsInWords(["Temperate", "Continental"])).toBe("temperate and continental");
    expect(groupsInWords(["Arid", "Temperate", "Polar"])).toBe("arid, temperate and polar");
    expect(groupsInWords([])).toBe("");
  });
});
