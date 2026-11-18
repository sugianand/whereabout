import { beforeEach, describe, expect, it } from "vitest";

import { GROUND_COVERS } from "@/lib/trueClues";

import { bundledGroundCovers } from "./bundled";
import { rememberGroundDay } from "./groundDaily";
import {
  GROUND_CALLS_KEY,
  MAX_GROUND_CALLS,
  canPractiseGround,
  coversInWords,
  groundDayCalls,
  groundMisreadLine,
  groundMisreads,
  keepGroundCall,
  loadAllGroundCalls,
  loadGroundCalls,
  noteGroundCall,
  parseGroundCalls,
  photosByCover,
  practiceCovers,
  practiceGroundDeal,
  type GroundCall,
} from "./groundMixUps";
import type { GroundMap, GroundResult } from "./onTheGround";

const COVERS: GroundMap = {
  b1: "Built-up",
  b2: "Built-up",
  b3: "Built-up",
  t1: "Tree cover",
  t2: "Tree cover",
  t3: "Tree cover",
  g1: "Grassland",
  g2: "Grassland",
  w1: "Permanent water bodies",
  s1: "Bare / sparse vegetation",
};

const c = (truth: GroundCall["truth"], picked: GroundCall["picked"]): GroundCall => ({
  truth,
  picked,
});

const result = (
  id: string,
  picked: GroundResult["picked"],
  truth: GroundResult["truth"],
): GroundResult => ({ id, picked, truth, correct: picked === truth, atlas: null });

beforeEach(() => localStorage.clear());

describe("the ground calls log", () => {
  it("keeps the newest calls up to the cap", () => {
    let log: GroundCall[] = [];
    for (let i = 0; i < 4; i++)
      log = noteGroundCall(log, c("Grassland", i % 2 ? "Tree cover" : "Grassland"), 3);
    expect(log).toEqual([
      c("Grassland", "Tree cover"),
      c("Grassland", "Grassland"),
      c("Grassland", "Tree cover"),
    ]);
  });

  it("reads back only well-formed calls, and never junk", () => {
    expect(parseGroundCalls("nope")).toEqual([]);
    expect(
      parseGroundCalls([
        c("Grassland", "Tree cover"),
        { truth: "Grassland" },
        { truth: "Water", picked: "Grassland" },
        null,
        ["Grassland", "Built-up"],
        c("Built-up", "Built-up"),
      ]),
    ).toEqual([c("Grassland", "Tree cover"), c("Built-up", "Built-up")]);
    const many = Array.from({ length: MAX_GROUND_CALLS + 5 }, () => c("Grassland", "Grassland"));
    expect(parseGroundCalls(many)).toHaveLength(MAX_GROUND_CALLS);
  });

  it("keeps each free call in the browser, and survives junk in storage", () => {
    keepGroundCall("Grassland", "Tree cover");
    keepGroundCall("Built-up", "Built-up");
    expect(loadGroundCalls()).toEqual([c("Grassland", "Tree cover"), c("Built-up", "Built-up")]);
    localStorage.setItem(GROUND_CALLS_KEY, "{");
    expect(loadGroundCalls()).toEqual([]);
    keepGroundCall("Permanent water bodies", "Built-up");
    expect(loadGroundCalls()).toEqual([c("Permanent water bodies", "Built-up")]);
  });

  it("adds today's games, oldest day first, without the free log holding them", () => {
    rememberGroundDay("2026-11-18", [result("w1", "Built-up", "Permanent water bodies")]);
    rememberGroundDay("2026-11-17", [result("g1", "Tree cover", "Grassland")]);
    keepGroundCall("Built-up", "Built-up");
    expect(loadGroundCalls()).toHaveLength(1);
    expect(loadAllGroundCalls()).toEqual([
      c("Grassland", "Tree cover"),
      c("Permanent water bodies", "Built-up"),
      c("Built-up", "Built-up"),
    ]);
    expect(groundDayCalls({})).toEqual([]);
  });
});

describe("groundMisreads", () => {
  it("lists the covers called wrong most, each with what it was taken for", () => {
    const calls = [
      c("Grassland", "Tree cover"),
      c("Grassland", "Tree cover"),
      c("Grassland", "Built-up"),
      c("Grassland", "Grassland"),
      c("Bare / sparse vegetation", "Grassland"),
      c("Built-up", "Built-up"),
    ];
    expect(groundMisreads(calls)).toEqual([
      {
        cover: "Grassland",
        photos: 4,
        missed: 3,
        as: [
          { cover: "Tree cover", times: 2 },
          { cover: "Built-up", times: 1 },
        ],
      },
      {
        cover: "Bare / sparse vegetation",
        photos: 1,
        missed: 1,
        as: [{ cover: "Grassland", times: 1 }],
      },
    ]);
  });

  it("breaks a tie by the miss rate, then the buttons' order, and keeps the top few", () => {
    const calls = [
      c("Built-up", "Grassland"),
      c("Built-up", "Built-up"),
      c("Bare / sparse vegetation", "Grassland"),
      c("Permanent water bodies", "Built-up"),
      c("Tree cover", "Grassland"),
    ];
    expect(groundMisreads(calls).map((m) => m.cover)).toEqual([
      "Tree cover",
      "Permanent water bodies",
      "Bare / sparse vegetation",
    ]);
    expect(groundMisreads(calls, 5).map((m) => m.cover)).toEqual([
      "Tree cover",
      "Permanent water bodies",
      "Bare / sparse vegetation",
      "Built-up",
    ]);
  });

  it("is empty when every call was right", () => {
    expect(groundMisreads([c("Grassland", "Grassland"), c("Built-up", "Built-up")])).toEqual([]);
  });

  it("says each in words, with the covers' own names", () => {
    const [m] = groundMisreads([
      c("Grassland", "Tree cover"),
      c("Grassland", "Tree cover"),
      c("Grassland", "Bare / sparse vegetation"),
      c("Grassland", "Permanent water bodies"),
      c("Grassland", "Grassland"),
    ]);
    expect(groundMisreadLine(m)).toBe(
      "You called 4 of 5 grassland photos wrong: trees twice, water once and bare ground once.",
    );
    expect(groundMisreadLine(groundMisreads([c("Tree cover", "Grassland")])[0])).toBe(
      "You called 1 of 1 tree photo wrong: grassland once.",
    );
    expect(groundMisreadLine(groundMisreads([c("Bare / sparse vegetation", "Built-up")])[0])).toBe(
      "You called 1 of 1 bare-ground photo wrong: built-up once.",
    );
  });
});

describe("the ground practice game", () => {
  const calls = [
    c("Grassland", "Tree cover"),
    c("Grassland", "Tree cover"),
    c("Bare / sparse vegetation", "Grassland"),
    c("Permanent water bodies", "Built-up"),
    c("Permanent water bodies", "Permanent water bodies"),
  ];

  it("is dealt from the top two misreads and what each was taken for", () => {
    // Grassland (as trees) and bare ground (as grassland, 1 of 1); water (1 of 2) sits out.
    expect(practiceCovers(groundMisreads(calls))).toEqual([
      "Tree cover",
      "Grassland",
      "Bare / sparse vegetation",
    ]);
    expect(practiceCovers(groundMisreads([c("Grassland", "Tree cover")]))).toEqual([
      "Tree cover",
      "Grassland",
    ]);
    expect(practiceCovers([])).toEqual([]);
  });

  it("deals five photos of only those covers, pure in the seed", () => {
    const practice = ["Built-up", "Tree cover"] as const;
    const deal = practiceGroundDeal(COVERS, practice, 7);
    expect(deal).toHaveLength(5);
    expect(new Set(deal).size).toBe(5);
    expect(deal.every((id) => practice.includes(COVERS[id] as (typeof practice)[number]))).toBe(
      true,
    );
    expect(practiceGroundDeal(COVERS, practice, 7)).toEqual(deal);
    // Over many seeds both covers come up, near evenly.
    let trees = 0;
    for (let seed = 0; seed < 200; seed++) {
      trees += practiceGroundDeal(COVERS, practice, seed).filter(
        (id) => COVERS[id] === "Tree cover",
      ).length;
    }
    expect(trees / 1000).toBeGreaterThan(0.4);
    expect(trees / 1000).toBeLessThan(0.6);
  });

  it("deals nothing when those covers can't fill a game", () => {
    expect(practiceGroundDeal(COVERS, ["Grassland", "Permanent water bodies"], 1)).toEqual([]);
    expect(practiceGroundDeal(COVERS, [], 1)).toEqual([]);
  });

  it("is offered only when the photos are there", () => {
    const counts = photosByCover(COVERS);
    expect(counts).toEqual({
      "Built-up": 3,
      "Tree cover": 3,
      Grassland: 2,
      "Permanent water bodies": 1,
      "Bare / sparse vegetation": 1,
    });
    expect(canPractiseGround(counts, ["Built-up", "Tree cover"])).toBe(true);
    expect(canPractiseGround(counts, ["Grassland", "Permanent water bodies"])).toBe(false);
    expect(canPractiseGround({ Grassland: 9 }, ["Grassland", "Tree cover"])).toBe(false);
  });

  it("can practise any two covers the bundled photos hold", () => {
    const counts = photosByCover(bundledGroundCovers);
    const held = GROUND_COVERS.filter((g) => (counts[g] ?? 0) > 0);
    expect(held.length).toBeGreaterThanOrEqual(2);
    for (const a of held) {
      for (const b of held) {
        if (a >= b || counts[a]! + counts[b]! < 5) continue;
        expect(canPractiseGround(counts, [a, b])).toBe(true);
        expect(practiceGroundDeal(bundledGroundCovers, [a, b], 3)).toHaveLength(5);
      }
    }
  });

  it("names its covers in words", () => {
    expect(coversInWords(["Tree cover", "Grassland"])).toBe("trees and grassland");
    expect(coversInWords(["Built-up", "Permanent water bodies", "Bare / sparse vegetation"])).toBe(
      "built-up, water and bare ground",
    );
    expect(coversInWords([])).toBe("");
  });
});
