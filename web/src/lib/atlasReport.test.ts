import { describe, expect, it } from "vitest";

import atlasData from "@/data/atlas.json";
import catalog from "@/data/photos.json";
import type { AtlasData, AtlasGuess, CatalogPhoto } from "@/lib/game/types";

import { byContinent, extremes, guessedCountry, median, scoreGuesses } from "./atlasReport";
import { CONTINENTS, continentOf } from "./continents";

const photo = (id: string, country: string, lng: number, lat: number): CatalogPhoto => ({
  id,
  imageUrl: `https://example.org/${id}.jpg`,
  lng,
  lat,
  place: id,
  country,
  credit: { author: "A", license: "CC0", sourceUrl: "https://example.org" },
});
const guess = (lng: number, lat: number, place: string, top = "XX"): AtlasGuess => ({
  lng,
  lat,
  confidence: 0.5,
  guessedPlace: place,
  topCountries: [{ country: top, p: 0.5 }],
  clues: [],
});

const PHOTOS = [
  photo("kyoto", "JP", 135.7681, 35.0116),
  photo("lima", "PE", -77.0428, -12.0464),
  photo("oslo", "NO", 10.7522, 59.9139),
  photo("unguessed", "FR", 2.35, 48.85),
];
const ATLAS: AtlasData = {
  model: "test",
  version: "test",
  generatedAt: null,
  guesses: {
    kyoto: guess(135.7681, 35.0116, "Kyoto, JP"), // spot on
    lima: guess(-58.38, -34.6, "Buenos Aires, AR", "PE"), // wrong country, ~3,100 km
    oslo: guess(18.07, 59.33, "Stockholm, SE"), // wrong country, ~420 km
  },
};

describe("continentOf", () => {
  it("maps every country in the catalog, and each code to exactly one continent", () => {
    for (const p of catalog as CatalogPhoto[])
      expect(continentOf(p.country), p.country).not.toBeNull();
    expect(continentOf("jp")).toBe("Asia");
    expect(continentOf("PE")).toBe("South America");
    expect(continentOf("ZZ")).toBeNull();
    expect(continentOf(null)).toBeNull();
    expect(CONTINENTS).toHaveLength(7);
  });
});

describe("guessedCountry", () => {
  it("reads the country of the place Atlas picked, not its top country", () => {
    expect(guessedCountry(guess(0, 0, "Drammen, NO", "CH"))).toBe("NO");
    expect(guessedCountry({ ...guess(0, 0, ""), guessedPlace: undefined })).toBe("XX");
  });
});

describe("median", () => {
  it("handles odd and even lengths and refuses an empty list", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow();
  });
});

describe("Atlas report", () => {
  const rows = scoreGuesses(PHOTOS, ATLAS);

  it("scores only the photos Atlas guessed, with the game's distance and points", () => {
    expect(rows.map((r) => r.photo.id)).toEqual(["kyoto", "lima", "oslo"]);
    expect(rows[0]).toMatchObject({ distanceKm: 0, score: 5000, countryRight: true });
    expect(rows[1].countryRight).toBe(false);
    expect(rows[1].distanceKm).toBeGreaterThan(3000);
  });

  it("groups by continent, easiest first", () => {
    const table = byContinent(rows);
    expect(table.map((r) => r.continent)).toEqual(["Asia", "Europe", "South America"]);
    expect(table[0]).toEqual({ continent: "Asia", n: 1, medianKm: 0, countryAccuracy: 1 });
    expect(table[1].countryAccuracy).toBe(0);
  });

  it("finds the closest and furthest guesses", () => {
    const { best, worst } = extremes(rows, 2);
    expect(best.map((r) => r.photo.id)).toEqual(["kyoto", "oslo"]);
    expect(worst.map((r) => r.photo.id)).toEqual(["lima", "oslo"]);
  });

  it("works on the real shipped guesses", () => {
    const real = scoreGuesses(catalog as CatalogPhoto[], atlasData as AtlasData);
    const table = byContinent(real);
    expect(table.reduce((n, r) => n + r.n, 0)).toBe(real.length);
    for (const r of table) expect(r.medianKm).toBeGreaterThanOrEqual(0);
  });
});
