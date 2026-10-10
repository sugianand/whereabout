/**
 * Breakdowns of Atlas's guesses, computed from the two files the game already ships
 * (photos.json and atlas.json) with the same distance and points the game scores with.
 */
import { continentOf, type Continent } from "@/lib/continents";
import type { AtlasData, AtlasGuess, CatalogPhoto } from "@/lib/game/types";
import { haversineKm, scoreDistance } from "@/lib/geo";

export interface ScoredGuess {
  photo: CatalogPhoto;
  guess: AtlasGuess;
  distanceKm: number;
  score: number;
  /** The country of the place Atlas picked (what the evaluation's country accuracy counts). */
  guessedCountry: string | null;
  countryRight: boolean;
}

export interface ContinentRow {
  continent: Continent;
  n: number;
  medianKm: number;
  countryAccuracy: number;
}

/** "Kyoto, JP" → "JP"; falls back to Atlas's most likely country. */
export function guessedCountry(guess: AtlasGuess): string | null {
  const fromPlace = guess.guessedPlace?.match(/,\s*([A-Z]{2})$/)?.[1];
  return fromPlace ?? guess.topCountries[0]?.country ?? null;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median of an empty list");
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Every photo Atlas guessed, scored against its true location. */
export function scoreGuesses(photos: readonly CatalogPhoto[], atlas: AtlasData): ScoredGuess[] {
  return photos.flatMap((photo) => {
    const guess = atlas.guesses[photo.id];
    if (!guess) return [];
    const distanceKm = haversineKm(guess, photo);
    const country = guessedCountry(guess);
    return [
      {
        photo,
        guess,
        distanceKm,
        score: scoreDistance(distanceKm),
        guessedCountry: country,
        countryRight: country === photo.country,
      },
    ];
  });
}

/** One row per continent with photos, easiest (lowest median error) first. */
export function byContinent(rows: readonly ScoredGuess[]): ContinentRow[] {
  const groups = new Map<Continent, ScoredGuess[]>();
  for (const r of rows) {
    const c = continentOf(r.photo.country);
    if (!c) continue;
    groups.set(c, [...(groups.get(c) ?? []), r]);
  }
  return [...groups]
    .map(([continent, rs]) => ({
      continent,
      n: rs.length,
      medianKm: median(rs.map((r) => r.distanceKm)),
      countryAccuracy: rs.filter((r) => r.countryRight).length / rs.length,
    }))
    .sort((a, b) => a.medianKm - b.medianKm || a.continent.localeCompare(b.continent));
}

/** Atlas's closest and furthest guesses, `k` of each, ties broken by photo id. */
export function extremes(rows: readonly ScoredGuess[], k: number) {
  const sorted = [...rows].sort(
    (a, b) => a.distanceKm - b.distanceKm || a.photo.id.localeCompare(b.photo.id),
  );
  return { best: sorted.slice(0, k), worst: sorted.slice(-k).reverse() };
}
