import type { LngLat } from "@/lib/geo";

export interface Credit {
  author: string;
  license: string;
  sourceUrl: string;
}

/** A photo as bundled for the browser (src/data/photos.json, built from photos.csv). */
export interface CatalogPhoto extends LngLat {
  id: string;
  imageUrl: string;
  place: string;
  country: string;
  credit: Credit;
}

/** What the player may see before guessing: the photo, never its location. */
export interface RoundStart {
  roundId: string;
  photo: { id: string; imageUrl: string };
}

/** Everything revealed after a guess. */
export interface Reveal {
  roundId: string;
  distanceKm: number;
  score: number;
  answer: LngLat & {
    place: string;
    country: string | null;
    credit: Credit | null;
  };
}

/** One concept Atlas noticed in the photo, e.g. "drives on the left", with its probability. */
export interface AtlasClue {
  label: string;
  p: number;
}

/** Atlas's precomputed guess for one photo (src/data/atlas.json). */
export interface AtlasGuess extends LngLat {
  /** Probability Atlas gave its top country. */
  confidence: number;
  /** The place Atlas picked, e.g. "Kyoto, JP". */
  guessedPlace?: string;
  topCountries: { country: string; p: number }[];
  clues: AtlasClue[];
}

export interface AtlasData {
  model: string | null;
  version: string | null;
  generatedAt: string | null;
  guesses: Record<string, AtlasGuess>;
}

/** Where rounds come from: the FastAPI backend, or the bundled catalog (static demo). */
export interface GameBackend {
  readonly kind: "api" | "local";
  startRound(): Promise<RoundStart>;
  guess(roundId: string, at: LngLat): Promise<Reveal>;
}
