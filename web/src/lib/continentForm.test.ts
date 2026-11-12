import { describe, expect, it } from "vitest";

import type { PlayedPhoto } from "@/lib/playedMap";

import {
  LATELY_ROUNDS,
  MIN_FORM_ROUNDS,
  continentForms,
  formBar,
  formExtremes,
  median,
  practiceHref,
} from "./continentForm";

let n = 0;
function round(country: string | null, km: number | null): PlayedPhoto {
  n += 1;
  return {
    id: `p${n}`,
    lng: 0,
    lat: 0,
    place: `Place ${n}`,
    country,
    km,
    score: km === null ? 0 : 3000,
    day: "2026-11-01",
  };
}

const many = (country: string, kms: (number | null)[]) => kms.map((km) => round(country, km));

describe("median", () => {
  it("takes the middle value, or the mean of the middle two", () => {
    expect(median([])).toBeNull();
    expect(median([7])).toBe(7);
    expect(median([9, 1, 5])).toBe(5);
    expect(median([10, 2, 4, 100])).toBe(7);
  });
});

describe("continentForms", () => {
  it("groups rounds by continent in the usual order, with the median of the pinned ones", () => {
    const forms = continentForms([
      ...many("JP", [100, 3000, 200]),
      ...many("FR", [50, null, 900, 10_000]),
      round(null, 20),
      round("ZZ", 20),
    ]);
    expect(forms.map((f) => f.continent)).toEqual(["Asia", "Europe"]);
    const [asia, europe] = forms;
    expect(asia).toMatchObject({ rounds: 3, pinned: 3, medianKm: 200, close: 2 });
    // The round with no pin is counted, not ranked, and doesn't move the median.
    expect(europe).toMatchObject({ rounds: 4, pinned: 3, medianKm: 900, close: 1 });
  });

  it("ranks a continent once it has enough pinned rounds", () => {
    const pinned = Array(MIN_FORM_ROUNDS - 1).fill(100);
    expect(continentForms(many("BR", [...pinned, null]))[0].ranked).toBe(false);
    expect(continentForms(many("BR", [...pinned, 100]))[0].ranked).toBe(true);
  });

  it("compares the newest five pinned rounds with the five before them", () => {
    const before = Array(LATELY_ROUNDS).fill(2000);
    expect(continentForms(many("KE", [...before, 100, 100, 100, 100]))[0].lately).toBeNull();

    const better = continentForms(many("KE", [9999, ...before, 300, 300, 300, 300, 300]))[0];
    expect(better.lately).toEqual({ trend: "better", beforeKm: 2000, nowKm: 300 });

    const worse = continentForms(many("KE", [...before, null, 5000, 5000, 5000, 5000, 5000]))[0];
    expect(worse.lately).toEqual({ trend: "worse", beforeKm: 2000, nowKm: 5000 });

    // Within a tenth is the same form.
    const same = continentForms(many("KE", [...before, 2150, 2150, 2150, 2150, 2150]))[0];
    expect(same.lately?.trend).toBe("same");
  });
});

describe("formExtremes", () => {
  const ranked = (country: string, km: number) => many(country, Array(MIN_FORM_ROUNDS).fill(km));

  it("names the furthest and the nearest ranked continents", () => {
    const forms = continentForms([
      ...ranked("JP", 800),
      ...ranked("FR", 60),
      ...ranked("AU", 4000),
      ...many("BR", [19_000]), // Not ranked: one round says little.
    ]);
    const ex = formExtremes(forms)!;
    expect(ex.weak.continent).toBe("Oceania");
    expect(ex.strong.continent).toBe("Europe");
  });

  it("says nothing until two ranked continents differ", () => {
    expect(formExtremes(continentForms(ranked("JP", 800)))).toBeNull();
    expect(formExtremes(continentForms([...ranked("JP", 800), ...ranked("FR", 800)]))).toBeNull();
    expect(formExtremes(continentForms([...ranked("JP", 800), ...many("FR", [5])]))).toBeNull();
  });

  it("breaks a tie on the median by the steadier figure", () => {
    const forms = continentForms([
      ...ranked("JP", 800),
      ...ranked("FR", 800),
      ...many("FR", [800, 800]),
      ...ranked("US", 50),
    ]);
    expect(formExtremes(forms)!.weak.continent).toBe("Europe");
  });
});

describe("practiceHref", () => {
  it("links a continent game only where the deck can deal one", () => {
    const regions = { Europe: ["a", "b", "c", "d", "e"] };
    expect(practiceHref("Europe", regions)).toBe("/?region=europe");
    expect(practiceHref("North America", { "North America": ["x"] })).toBe(
      "/?region=north-america",
    );
    expect(practiceHref("Asia", regions)).toBeNull();
    expect(practiceHref("Asia", { Asia: [] })).toBeNull();
  });
});

describe("formBar", () => {
  it("grows with distance on a log scale, never empty and never past full", () => {
    expect(formBar(0)).toBe(0.03);
    expect(formBar(10)).toBe(0.03);
    expect(formBar(20_000)).toBe(1);
    expect(formBar(25_000)).toBe(1);
    expect(formBar(50)).toBeLessThan(formBar(500));
    expect(formBar(500)).toBeLessThan(formBar(5000));
    // A tenfold miss always adds the same length.
    expect(formBar(5000) - formBar(500)).toBeCloseTo(formBar(500) - formBar(50), 10);
  });
});
