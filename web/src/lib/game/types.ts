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
  /** Original file size in pixels, when known (from data/curation/quality.csv). */
  width?: number;
  height?: number;
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
  /**
   * Atlas's guess, when the backend supplies it (the API does, scored server-side). `null`
   * means Atlas sat this photo out; absent means the backend leaves Atlas to the client.
   */
  atlas?: AtlasGuess | null;
}

/** One concept Atlas noticed in the photo, e.g. "drives on the left", with its probability. */
export interface AtlasClue {
  label: string;
  p: number;
}

/**
 * Where Atlas looked: occlusion saliency over the square crop CLIP sees
 * (ml/src/whereabout_ml/saliency.py).
 */
export interface AtlasLooked {
  grid: number;
  /** The square CLIP saw, as [x, y, width, height] fractions of the full photo. */
  crop: number[];
  /** Row-major grid × grid importances in [0, 1]; 1 is the cell that mattered most. */
  cells: number[];
}

/** Atlas's precomputed guess for one photo (src/data/atlas.json). */
export interface AtlasGuess extends LngLat {
  /** Present once atlas.yml has run with saliency. */
  looked?: AtlasLooked;
  /** Probability Atlas gave its top country. */
  confidence: number;
  /** The place Atlas picked, e.g. "Kyoto, JP". */
  guessedPlace?: string;
  topCountries: { country: string; p: number }[];
  /**
   * Atlas's whole country distribution for the reveal heatmap: ISO alpha-2 to probability, only
   * countries at p >= 0.005. Absent from atlas.json files made before the heatmap.
   */
  belief?: Record<string, number>;
  clues: AtlasClue[];
}

/**
 * The retrieval refinement's run (`summary` in ml/src/whereabout_ml/retrieval.py): Atlas's pin
 * moved to the look-alike reference photos, and whether that beat Atlas without it.
 */
export interface AtlasRetrievalSummary {
  /** The system it refines. */
  versus: string;
  /** The CLIP model whose image embeddings were compared. */
  model: string;
  references: number;
  countries: number;
  /** Photos whose pin moved (the rest had too few reference photos in their country). */
  moved: number;
  n: number;
  dropped: Record<string, number>;
  k: number;
  /** Refined minus unrefined median error, km, with a paired-bootstrap 95% interval. */
  median_km_delta: number;
  ci95: number[];
  /** True only when the whole interval is below zero; then it is the Atlas in the game. */
  ships: boolean;
}

/** One row of the evaluation that produced Atlas's guesses (ml/src/whereabout_ml/run_atlas_v0.py). */
export interface AtlasSystemResult {
  name: string;
  playsInGame: boolean;
  n: number;
  /** Share of photos within each distance, keyed by kilometres ("1", "25", "200", ...). */
  accuracy_at_km: Record<string, number>;
  median_km: number;
  /** [low, high] of a 95% bootstrap interval; JSON arrays, so typed as number[]. */
  median_km_ci95: number[] | null;
  mean_km: number;
  mean_score: number;
  country_accuracy: number | null;
}

/** Deletion test for the saliency maps: hide the top-k cells, or k random ones. */
export interface AtlasSaliencySummary {
  n: number;
  k: number;
  grid: number;
  /** Mean relative drop in p(country) after hiding the k most important cells. */
  mean_top_k_drop: number;
  /** The same after hiding k random cells (mean of three draws per photo). */
  mean_random_k_drop: number;
  /** Share of photos where hiding the top cells hurt more than hiding random ones. */
  share_top_worse: number;
}

export interface AtlasData {
  model: string | null;
  version: string | null;
  generatedAt: string | null;
  guesses: Record<string, AtlasGuess>;
  /** Present once atlas.yml has run with evaluation export. */
  evaluation?: {
    n: number;
    systems: AtlasSystemResult[];
    saliency?: AtlasSaliencySummary;
    retrieval?: AtlasRetrievalSummary;
  };
}

/** Where rounds come from: the FastAPI backend, or the bundled catalog (static demo). */
export interface GameBackend {
  readonly kind: "api" | "local";
  startRound(): Promise<RoundStart>;
  guess(roundId: string, at: LngLat): Promise<Reveal>;
}
