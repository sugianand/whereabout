import type { LngLat } from "@/lib/geo";
import type { Clue } from "@/lib/hints";
import type { PhotoClues } from "@/lib/trueClues";

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
  /**
   * Concept labels for the hints and the reveal's real clues (data/labels/concept_labels.csv),
   * when the maps gave one.
   */
  drivingSide?: "left" | "right";
  climateGroup?: string;
  /** ESA WorldCover 2021 class around the spot, e.g. "Built-up". */
  landCover?: string;
}

/** What the player may see before guessing: the photo, never its location. */
export interface RoundStart {
  roundId: string;
  photo: { id: string; imageUrl: string };
  /** How many hints this photo offers (0 to 3). What they say is only known once taken. */
  hintsAvailable: number;
}

/** Everything revealed after a guess. */
export interface Reveal {
  roundId: string;
  /** How far the pin was from the answer, or null when a Blitz clock ran out with no pin. */
  distanceKm: number | null;
  /** Already lowered for the hints taken: the backend scores them. */
  score: number;
  hintsUsed: number;
  answer: LngLat & {
    place: string;
    country: string | null;
    credit: Credit | null;
    /** What the maps say about the spot, for the reveal's real clues. Absent from the API. */
    clues?: PhotoClues;
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

/** One confidence bin of a calibration report (`reliability` in ml/src/whereabout_ml/calibration.py). */
export interface AtlasReliabilityBin {
  lo: number;
  hi: number;
  n: number;
  /** Mean probability Atlas gave its top country in this bin. */
  confidence: number;
  /** Share of the bin where that country was right. */
  accuracy: number;
}

/**
 * Temperature scaling of Atlas's country probabilities (`calibrate` in
 * ml/src/whereabout_ml/calibration.py), cross-fitted over geographic folds.
 */
export interface AtlasCalibrationSummary {
  method: string;
  n: number;
  folds: number;
  blockDeg: number;
  /** Fitted on every labelled photo; above 1 means the raw model was overconfident. */
  temperature: number;
  raw: { nll: number; ece: number; bins: AtlasReliabilityBin[] };
  /** Measured on photos each fold's fit never saw. */
  calibrated: { nll: number; ece: number; bins: AtlasReliabilityBin[] };
  /** True when the scaled probabilities lowered held-out NLL; then the game shows them. */
  ships: boolean;
}

/**
 * One clue head's run (`HeadResult.as_dict` in ml/src/whereabout_ml/clue_heads.py): a probe on
 * frozen CLIP embeddings that reads one concept, scored against today's source of that clue on
 * game photos from places it never trained on.
 */
export interface AtlasClueHeadResult {
  /** The labels column it reads: "driving_side" or "climate_group". */
  concept: string;
  /** The reveal clue group it writes when it ships. */
  clueGroup: string;
  classes: string[];
  /** What it was compared with, in words. */
  baseline: string;
  model: string;
  /** Labelled game photos scored. */
  n: number;
  /** Labelled reference photos the probe was fitted on. */
  references: number;
  headAccuracy: number;
  baselineAccuracy: number;
  /** Always naming the commonest class, for context. */
  majorityAccuracy: number;
  /** Probe minus baseline accuracy, with a paired-bootstrap 95% interval. */
  accuracyDelta: number;
  ci95: number[];
  l2: number;
  /** True only when the whole interval is above zero; then the probe writes the clue. */
  ships: boolean;
}

/**
 * The trained geocell head's run (`summary` in ml/src/whereabout_ml/geocell_head.py): a linear
 * classifier over adaptive geocells on frozen CLIP embeddings of the reference photos, scored
 * as the pin within the playing Atlas's country.
 */
export interface AtlasGeocellHeadSummary {
  /** The system whose country it keeps and whose pin it would replace. */
  versus: string;
  /** The CLIP model whose image embeddings it reads. */
  model: string;
  /** Reference photos it was fitted on (never game photos). */
  references: number;
  cells: number;
  l2: number;
  /** Haversine label-smoothing distance. */
  tauKm: number;
  /** Photos whose pin it moved (the rest are in countries with too few reference photos). */
  moved: number;
  n: number;
  /** In-country head minus playing median error, km, with a paired-bootstrap 95% interval. */
  median_km_delta: number;
  ci95: number[];
  /** True only when the whole interval is below zero; then it places the pin in the game. */
  ships: boolean;
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
    calibration?: AtlasCalibrationSummary;
    clueHeads?: AtlasClueHeadResult[];
    /** The same probes on Pocket Atlas's model, against its clues; they decide the browser only. */
    pocketClueHeads?: AtlasClueHeadResult[];
    geocellHead?: AtlasGeocellHeadSummary;
  };
}

/** Where rounds come from: the FastAPI backend, or the bundled catalog (static demo). */
export interface GameBackend {
  readonly kind: "api" | "local";
  startRound(): Promise<RoundStart>;
  /** Take the round's next hint; resolves to every hint taken so far, newest last. */
  hint(roundId: string): Promise<Clue[]>;
  /**
   * Score the round. `null` is a Blitz round whose clock ran out before any pin: it reveals the
   * answer for 0 points. Only the browser backend deals Blitz games.
   */
  guess(roundId: string, at: LngLat | null): Promise<Reveal>;
}
