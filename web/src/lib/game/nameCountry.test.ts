import { beforeEach, describe, expect, it } from "vitest";

import catalog from "@/data/photos.json";
import { continentOf } from "@/lib/continents";

import { bundledDeck } from "./bundled";
import {
  BEST_NAME_KEY,
  NAME_OPTIONS,
  atlasName,
  atlasPercent,
  buildCountryPool,
  initialName,
  loadBestName,
  nameIds,
  nameOptions,
  nameOver,
  nameReducer,
  nameSeed,
  rememberName,
  type NameState,
} from "./nameCountry";
import type { AtlasGuess, CatalogPhoto } from "./types";

function guess(top: [string, number][], belief?: Record<string, number>): AtlasGuess {
  return {
    lng: 0,
    lat: 0,
    confidence: top[0]?.[1] ?? 0,
    topCountries: top.map(([country, p]) => ({ country, p })),
    belief,
    clues: [],
  };
}

describe("the names offered", () => {
  const POOL = buildCountryPool(["JP", "KR", "CN", "VN", "TH", "FR", "DE", "ES", "BR", "ZZ"]);

  it("groups countries by continent and drops codes the table doesn't know", () => {
    expect(POOL.Asia?.sort()).toEqual(["CN", "JP", "KR", "TH", "VN"]);
    expect(POOL.Europe?.sort()).toEqual(["DE", "ES", "FR"]);
    expect(Object.values(POOL).flat()).not.toContain("ZZ");
  });

  it("are the truth and three others from its continent, none repeated", () => {
    for (let seed = 0; seed < 50; seed++) {
      const names = nameOptions("JP", POOL, seed);
      expect(names).toHaveLength(NAME_OPTIONS);
      expect(new Set(names).size).toBe(NAME_OPTIONS);
      expect(names).toContain("JP");
      expect(names.every((c) => continentOf(c) === "Asia")).toBe(true);
    }
  });

  it("are the same for the same seed, and vary with it", () => {
    expect(nameOptions("JP", POOL, 7)).toEqual(nameOptions("JP", POOL, 7));
    const draws = new Set(Array.from({ length: 30 }, (_, s) => nameOptions("JP", POOL, s).join()));
    expect(draws.size).toBeGreaterThan(3);
  });

  it("top up from the rest of the world when the continent runs short", () => {
    const names = nameOptions("BR", POOL, 3);
    expect(names).toHaveLength(NAME_OPTIONS);
    expect(new Set(names).size).toBe(NAME_OPTIONS);
    expect(names).toContain("BR");
  });

  it("put the right answer in every slot about as often", () => {
    const pool = bundledDeck.countryPool;
    const slots = [0, 0, 0, 0];
    for (let run = 0; run < 2000; run++) {
      slots[nameOptions("JP", pool, nameSeed(run, "wm001")).indexOf("JP")] += 1;
    }
    for (const n of slots) expect(n).toBeGreaterThan(400);
  });

  it("always fill four from the same continent for every photo the real deck can deal", () => {
    const byId = new Map((catalog as CatalogPhoto[]).map((p) => [p.id, p]));
    const ids = nameIds(bundledDeck.streakIds, bundledDeck.regions);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const { country } = byId.get(id)!;
      const names = nameOptions(country, bundledDeck.countryPool, nameSeed(1, id));
      expect(new Set(names).size).toBe(NAME_OPTIONS);
      expect(names).toContain(country);
      expect(names.every((c) => continentOf(c) === continentOf(country))).toBe(true);
    }
  });
});

describe("nameIds", () => {
  it("keeps deck order, and only photos a continent can deal", () => {
    expect(nameIds(["c", "a", "x"], { Asia: ["a", "b"], Europe: ["c"] })).toEqual(["c", "a"]);
  });
});

describe("Atlas's pick", () => {
  const FOUR = ["JP", "KR", "CN", "VN"];

  it("is the name it gave the most, even when that isn't its top country", () => {
    const g = guess(
      [
        ["TH", 0.6],
        ["CN", 0.2],
      ],
      { TH: 0.6, CN: 0.2, KR: 0.05 },
    );
    expect(atlasName(g, FOUR, "CN")).toEqual({ picked: "CN", p: 0.2, correct: true });
    expect(atlasName(g, FOUR, "JP")).toEqual({ picked: "CN", p: 0.2, correct: false });
  });

  it("falls back on its top countries when it has no whole belief", () => {
    expect(atlasName(guess([["KR", 0.4]]), FOUR, "KR")?.picked).toBe("KR");
  });

  it("sits out a photo it never guessed, or when it gave none of the four anything", () => {
    expect(atlasName(null, FOUR, "JP")).toBeNull();
    expect(atlasName(guess([["TH", 0.9]], { TH: 0.9 }), FOUR, "JP")).toBeNull();
  });

  it("never shows as 0%", () => {
    expect(atlasPercent(0.005)).toBe(1);
    expect(atlasPercent(0.001)).toBe(1);
    expect(atlasPercent(0.62)).toBe(62);
  });
});

describe("the run", () => {
  const FOUR = ["JP", "KR", "CN", "VN"];
  const start = nameReducer(initialName, { type: "start", order: ["a", "b"], seed: 9 });
  const pick = (s: NameState, country: string, atlas: AtlasGuess | null = null) =>
    nameReducer(s, { type: "picked", country, options: FOUR, truth: "JP", atlas });

  it("has nothing to deal from an empty deck", () => {
    expect(nameReducer(initialName, { type: "start", order: [], seed: 1 }).phase).toBe("none");
  });

  it("counts a right tap and goes on to the next photo", () => {
    const after = pick(start, "JP");
    expect(after).toMatchObject({ phase: "answered", correct: true, streak: 1 });
    expect(nameOver(after)).toBe(false);
    expect(nameReducer(after, { type: "next" })).toMatchObject({
      phase: "guessing",
      index: 1,
      seed: 9,
      streak: 1,
    });
  });

  it("ends at the first wrong tap, and next doesn't get past it", () => {
    const after = pick(start, "KR");
    expect(after).toMatchObject({ phase: "answered", correct: false, streak: 0, truth: "JP" });
    expect(nameOver(after)).toBe(true);
    expect(nameReducer(after, { type: "next" })).toBe(after);
  });

  it("ignores a tap on a name that wasn't offered, and a second tap", () => {
    expect(pick(start, "FR")).toBe(start);
    const after = pick(start, "JP");
    expect(pick(after, "KR")).toBe(after);
  });

  it("clears the run after the last photo", () => {
    const one = pick(start, "JP");
    const two = pick(nameReducer(one, { type: "next" }), "JP");
    expect(nameReducer(two, { type: "next" })).toMatchObject({ phase: "cleared", streak: 2 });
  });

  it("tallies Atlas only on the photos it played", () => {
    const right = pick(start, "JP", guess([["JP", 0.5]]));
    expect(right).toMatchObject({ atlasRight: 1, atlasPlayed: 1 });
    const next = nameReducer(right, { type: "next" });
    expect(pick(next, "JP", null)).toMatchObject({ atlasRight: 1, atlasPlayed: 1 });
    expect(pick(next, "JP", guess([["KR", 0.5]]))).toMatchObject({
      atlasRight: 1,
      atlasPlayed: 2,
    });
  });
});

describe("a run picked back up", () => {
  const from = { streak: 2, atlasRight: 1, atlasPlayed: 2 };

  it("stands at the photo after the right taps, with the tally so far", () => {
    const state = nameReducer(initialName, { type: "start", order: ["a", "b", "c"], seed: 7, from });
    expect(state).toMatchObject({ phase: "guessing", index: 2, seed: 7, ...from });
  });

  it("is cleared when it stands past the end of the deck", () => {
    const state = nameReducer(initialName, { type: "start", order: ["a", "b"], seed: 7, from });
    expect(state).toMatchObject({ phase: "cleared", index: 1, ...from });
  });
});

describe("the best run", () => {
  beforeEach(() => localStorage.clear());

  it("keeps only a better run", () => {
    expect(rememberName(3)).toBe(3);
    expect(rememberName(2)).toBe(3);
    expect(loadBestName()).toBe(3);
  });

  it("reads junk as none", () => {
    localStorage.setItem(BEST_NAME_KEY, '"x"');
    expect(loadBestName()).toBe(0);
    localStorage.setItem(BEST_NAME_KEY, "-1");
    expect(loadBestName()).toBe(0);
  });
});
