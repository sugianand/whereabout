import { describe, expect, it } from "vitest";

import type { MixUp } from "@/lib/mixUps";

import { NAME_OPTIONS, buildCountryPool, nameOptions } from "./nameCountry";
import {
  MIN_PRACTICE_PHOTOS,
  photosByCountry,
  practiceIds,
  practiceOptions,
  practiceOrder,
  practicePartners,
  practiceSize,
} from "./nameMixUps";

const POOL = buildCountryPool(["JP", "KR", "CN", "TW", "VN", "TH", "FR", "DE", "ES", "IT", "PT"]);

const COUNTRIES = {
  j1: "JP",
  j2: "JP",
  j3: "JP",
  j4: "JP",
  j5: "JP",
  k1: "KR",
  f1: "FR",
  f2: "FR",
  s1: "ES",
  p1: "PT",
};
const IDS = Object.keys(COUNTRIES);

const log = (...pairs: [string, string][]): MixUp[] =>
  pairs.map(([truth, picked]) => ({ truth, picked }));

describe("practicePartners", () => {
  it("pairs each country of the top pairs with those it was mixed up with, most mixed-up first", () => {
    const partners = practicePartners(
      log(["JP", "KR"], ["KR", "JP"], ["JP", "CN"], ["ES", "PT"], ["JP", "KR"]),
    );
    expect(partners.get("JP")).toEqual(["KR", "CN"]);
    expect(partners.get("KR")).toEqual(["JP"]);
    expect(partners.get("CN")).toEqual(["JP"]);
    expect(partners.get("ES")).toEqual(["PT"]);
    expect(partners.get("PT")).toEqual(["ES"]);
    expect(partners.has("FR")).toBe(false);
  });

  it("is empty with nothing mixed up", () => {
    expect(practicePartners([]).size).toBe(0);
  });

  it("only takes the top pairs, the ones Your map lists", () => {
    const many = log(
      ["NO", "SE"],
      ["PT", "ES"],
      ["AR", "CL"],
      ["FI", "EE"],
      ["AT", "DE"],
      ["IE", "GB"],
    );
    // Six pairs once each: the newest five are listed, so the oldest pair is left out.
    const partners = practicePartners(many);
    expect(partners.has("NO")).toBe(false);
    expect(partners.get("IE")).toEqual(["GB"]);
  });
});

describe("practiceIds and practiceSize", () => {
  it("keeps the photos in a country of the pairs, in deck order", () => {
    const partners = practicePartners(log(["JP", "KR"], ["ES", "PT"]));
    expect(practiceIds(IDS, COUNTRIES, partners)).toEqual([
      "j1",
      "j2",
      "j3",
      "j4",
      "j5",
      "k1",
      "s1",
      "p1",
    ]);
  });

  it("counts the photos a run would deal from each country's tally", () => {
    const counts = photosByCountry(COUNTRIES);
    expect(counts).toEqual({ JP: 5, KR: 1, FR: 2, ES: 1, PT: 1 });
    expect(practiceSize(log(["ES", "PT"]), counts)).toBe(2);
    expect(practiceSize(log(["ES", "PT"]), counts)).toBeLessThan(MIN_PRACTICE_PHOTOS);
    expect(practiceSize(log(["JP", "KR"], ["ES", "PT"]), counts)).toBe(8);
    // A country with no photos to deal adds nothing.
    expect(practiceSize(log(["DE", "AT"]), counts)).toBe(0);
    expect(practiceSize([], counts)).toBe(0);
  });
});

describe("practiceOrder", () => {
  const ids = ["j1", "j2", "j3", "j4", "j5", "k1", "s1", "p1"];

  it("deals every photo once, the same way for the same seed", () => {
    const order = practiceOrder(ids, COUNTRIES, 42);
    expect([...order].sort()).toEqual([...ids].sort());
    expect(practiceOrder(ids, COUNTRIES, 42)).toEqual(order);
  });

  it("takes the countries in turn, so a country with many photos never crowds out the rest", () => {
    for (const seed of [1, 2, 3, 99, 2 ** 31]) {
      const order = practiceOrder(ids, COUNTRIES, seed);
      // Every country comes up within the first four photos.
      expect(
        new Set(order.slice(0, 4).map((id) => COUNTRIES[id as keyof typeof COUNTRIES])),
      ).toEqual(new Set(["JP", "KR", "ES", "PT"]));
    }
  });

  it("shuffles with the seed", () => {
    const orders = new Set([1, 2, 3, 4, 5, 6].map((s) => practiceOrder(ids, COUNTRIES, s).join()));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("deals nothing from nothing", () => {
    expect(practiceOrder([], COUNTRIES, 1)).toEqual([]);
  });
});

describe("practiceOptions", () => {
  it("always offers the country the photo was taken for, with the truth, four names in all", () => {
    for (let seed = 0; seed < 200; seed++) {
      const names = practiceOptions("JP", ["KR"], POOL, seed);
      expect(names).toHaveLength(NAME_OPTIONS);
      expect(new Set(names).size).toBe(NAME_OPTIONS);
      expect(names).toContain("JP");
      expect(names).toContain("KR");
    }
  });

  it("offers every partner, up to three, most mixed-up first", () => {
    const names = practiceOptions("JP", ["KR", "CN", "TW", "VN"], POOL, 7);
    expect([...names].sort()).toEqual(["CN", "JP", "KR", "TW"]);
  });

  it("fills the rest from Name the country's usual draw, so a partner on another continent still comes with neighbours", () => {
    const names = practiceOptions("ES", ["JP"], POOL, 11);
    const usual = nameOptions("ES", POOL, 11).filter((c) => c !== "ES");
    expect(names).toContain("JP");
    expect(names.filter((c) => c !== "ES" && c !== "JP").every((c) => usual.includes(c))).toBe(
      true,
    );
  });

  it("is pure in the seed, and puts the truth in more than one place", () => {
    expect(practiceOptions("JP", ["KR"], POOL, 5)).toEqual(practiceOptions("JP", ["KR"], POOL, 5));
    const places = new Set(
      Array.from({ length: 40 }, (_, s) => practiceOptions("JP", ["KR"], POOL, s).indexOf("JP")),
    );
    expect(places.size).toBeGreaterThan(1);
  });

  it("ignores the truth among its partners, and plays as usual without any", () => {
    const names = practiceOptions("JP", ["JP", "KR"], POOL, 3);
    expect(names.filter((c) => c === "JP")).toHaveLength(1);
    expect(names).toContain("KR");
    expect([...practiceOptions("JP", [], POOL, 3)].sort()).toEqual(
      [...nameOptions("JP", POOL, 3)].sort(),
    );
  });
});
