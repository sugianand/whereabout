import { beliefFromProbabilities, type Belief } from "../belief";
import type { SurenessBand } from "../game/sureness";

import type { GateVerdict, PocketGate } from "./gate";

/**
 * Pocket Atlas, the browser half: decode the precomputed text index and run Atlas's
 * country-then-city math against one image embedding.
 *
 * A line-for-line port of `locate()` in ml/src/whereabout_ml/pocket_index.py; both are pinned to
 * data/fixtures/pocket_cases.json, so the browser and Python can't drift apart.
 */

export interface PocketMeta {
  version: number;
  model: string;
  hfModel: string;
  dim: number;
  rows: number;
  logitScale: number;
  topKCountries: number;
  minClueProbability: number;
  /** `cities` is [first row, count] of the country's cities in the vector matrix. */
  countries: { code: string; name: string; cities: number[] }[];
  cities: { name: string; country: string; lat: number; lng: number }[];
  clueGroups: { name: string; labels: string[]; start: number }[];
  scales: number[];
  /**
   * This model's own temperature, fitted by the Atlas run on the catalog photos
   * (`pocket_calibration` in ml/src/whereabout_ml/run_atlas_v0.py). Missing means 1, the raw model.
   */
  temperature?: number;
  /** Held-out "When Atlas is 60–80% sure..." bands for this model, as the reveal shows. */
  sureness?: SurenessBand[];
  /**
   * Clue heads that beat Pocket Atlas's zero-shot clues on the catalog photos (`pocket_clue_heads`
   * in ml/src/whereabout_ml/run_atlas_v0.py): each an affine map on the image embedding, one
   * weight row per class. A head replaces the zero-shot clue of its `group`. Missing when none won.
   */
  clueHeads?: PocketClueHead[];
  /**
   * A country head taught by the game's ViT-L/14 Atlas that beat zero-shot Pocket Atlas on the
   * catalog photos (`pocket_distillation` in ml/src/whereabout_ml/run_atlas_v0.py). Added to the
   * tempered zero-shot country logits, it leads the pin, "% sure", shortlist and heatmap; `sureness`
   * above is then its own held-out bands. Missing when it did not win.
   */
  distillation?: PocketDistillation;
  /** The privacy gate (people and indoor), see gate.ts. Missing in indexes built before it. */
  gate?: PocketGate;
  /** Python's guess for the parity photo; indexes built before the heatmap have no `belief`. */
  parity?: {
    image: string;
    embedding: number[];
    guess: Omit<PocketGuess, "belief"> & { belief?: Belief };
    gate?: GateVerdict;
  };
}

export interface PocketClueHead {
  concept: string;
  group: string;
  /** The clue with `{}` where the class goes, e.g. "Drives on the {}". */
  clue: string;
  classes: string[];
  /** classes × dim */
  weights: number[][];
  bias: number[];
}

export interface PocketDistillation {
  /** The model that taught it, e.g. "ViT-L-14/openai". */
  teacher: string;
  /** countries × dim int8, one row per country in index order; row × scales[row] is the weight. */
  weights: number[][];
  scales: number[];
  bias: number[];
  sureness: SurenessBand[];
}

export interface PocketIndex {
  meta: PocketMeta;
  /** rows × dim unit vectors, row-major. */
  vectors: Float64Array;
}

export interface PocketGuess {
  city: string;
  country: string;
  lat: number;
  lng: number;
  confidence: number;
  topCountries: { country: string; p: number }[];
  clues: { label: string; p: number }[];
  /** The heatmap: every country at p >= 0.5%, from the same tempered probabilities as "% sure". */
  belief: Belief;
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Unit-normalise in place and return the array. */
export function normalise<T extends { length: number; [i: number]: number }>(v: T): T {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** int8 rows × per-row scales → unit vectors, as Python's `dequantize`. */
export function decodeIndex(meta: PocketMeta, int8: Int8Array): PocketIndex {
  if (int8.length !== meta.rows * meta.dim) {
    throw new Error(`index has ${int8.length} values, expected ${meta.rows} × ${meta.dim}`);
  }
  if (meta.scales.length !== meta.rows) throw new Error("index has the wrong number of scales");
  const vectors = new Float64Array(int8.length);
  for (let r = 0; r < meta.rows; r++) {
    const row = vectors.subarray(r * meta.dim, (r + 1) * meta.dim);
    for (let d = 0; d < meta.dim; d++) row[d] = int8[r * meta.dim + d] * meta.scales[r];
    normalise(row);
  }
  return { meta, vectors };
}

export function softmax(xs: number[]): number[] {
  const m = Math.max(...xs);
  const e = xs.map((x) => Math.exp(x - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

/** logitScale × (rows [start, start+count) · image). */
function scores(index: PocketIndex, img: Float64Array, start: number, count: number): number[] {
  const { dim, logitScale } = index.meta;
  const out: number[] = [];
  for (let r = start; r < start + count; r++) {
    let dot = 0;
    const off = r * dim;
    for (let d = 0; d < dim; d++) dot += index.vectors[off + d] * img[d];
    out.push(logitScale * dot);
  }
  return out;
}

const argmax = (xs: number[]) => xs.reduce((best, x, i) => (x > xs[best] ? i : best), 0);

/** softmax(weights · image + bias) for one clue head, on the unit-length image embedding. */
export function headProbabilities(head: PocketClueHead, img: ArrayLike<number>): number[] {
  return softmax(
    head.weights.map((row, c) => {
      if (row.length !== img.length) {
        throw new Error(`clue head ${head.concept} has ${row.length} dims, not ${img.length}`);
      }
      let z = head.bias[c];
      for (let d = 0; d < row.length; d++) z += row[d] * img[d];
      return z;
    }),
  );
}

/**
 * The distilled head's correction to the tempered zero-shot country logits, on the unit-length
 * image embedding: (int8 rows × scales) · image + bias, as Python's `distilled_logits`.
 */
export function distilledLogits(d: PocketDistillation, img: ArrayLike<number>): number[] {
  return d.weights.map((row, c) => {
    if (row.length !== img.length) {
      throw new Error(`distilled head has ${row.length} dims, not ${img.length}`);
    }
    let dot = 0;
    for (let k = 0; k < row.length; k++) dot += row[k] * img[k];
    return d.scales[c] * dot + d.bias[c];
  });
}

/** The index's temperature, or 1 (the raw model) when it has none or a broken one. */
export function temperatureOf(meta: PocketMeta): number {
  const t = meta.temperature;
  return typeof t === "number" && Number.isFinite(t) && t > 0 ? t : 1;
}

/**
 * p(country | image), untempered: what "Where Atlas looked" measures, as the game's maps do
 * (`country_log_prob` in ml/src/whereabout_ml/run_atlas_v0.py). In index order. With a distilled
 * head it is the head's distribution, the one that chose the country being explained (the head
 * was trained on the tempered logits, so it has no untempered form).
 */
export function countryProbabilities(index: PocketIndex, image: ArrayLike<number>): number[] {
  const { meta } = index;
  if (image.length !== meta.dim)
    throw new Error(`embedding has ${image.length} dims, not ${meta.dim}`);
  const img = normalise(Float64Array.from(image));
  const logits = scores(index, img, 0, meta.countries.length);
  if (!meta.distillation) return softmax(logits);
  const t = temperatureOf(meta);
  const head = distilledLogits(meta.distillation, img);
  return softmax(logits.map((x, i) => x / t + head[i]));
}

/**
 * Atlas's guess for one image embedding. The pin comes from the raw probabilities, as the scored
 * pipeline picks it; "% sure" and the shortlist are divided by the index's temperature, as in
 * the game, which never reorders countries, and so is the heatmap (`belief`).
 *
 * With a distilled head, the countries are the head's, softmax(logits / T + head): one
 * distribution leads the city step (as it was scored) and is what "% sure" shows.
 */
export function locate(index: PocketIndex, image: ArrayLike<number>): PocketGuess {
  const { meta } = index;
  if (image.length !== meta.dim)
    throw new Error(`embedding has ${image.length} dims, not ${meta.dim}`);
  const img = normalise(Float64Array.from(image));
  const nc = meta.countries.length;

  const countryLogits = scores(index, img, 0, nc);
  const t = temperatureOf(meta);
  let pRaw: number[];
  let pCountry: number[];
  if (meta.distillation) {
    if (meta.distillation.weights.length !== nc) {
      throw new Error(
        `distilled head has ${meta.distillation.weights.length} countries, not ${nc}`,
      );
    }
    const head = distilledLogits(meta.distillation, img);
    pCountry = softmax(countryLogits.map((x, i) => x / t + head[i]));
    pRaw = pCountry;
  } else {
    pRaw = softmax(countryLogits);
    pCountry = softmax(countryLogits.map((x) => x / t));
  }
  // Stable: ties keep index order, like numpy's argsort(kind="stable").
  const order = pRaw
    .map((p, i) => [p, i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    .slice(0, meta.topKCountries)
    .map(([, i]) => i);

  let best: { joint: number; row: number } | null = null;
  for (const i of order) {
    const [s, n] = meta.countries[i].cities;
    const pCity = softmax(scores(index, img, s, n));
    const j = argmax(pCity);
    const joint = pRaw[i] * pCity[j];
    if (!best || joint > best.joint) best = { joint, row: s + j };
  }
  if (!best) throw new Error("index has no countries");
  const city = meta.cities[best.row - nc];

  // A clue head replaces the zero-shot clue of its group, shown or not: it read it better.
  const heads = meta.clueHeads ?? [];
  const learned = new Set(heads.map((h) => h.group));
  const clues = meta.clueGroups.flatMap((g) => {
    if (learned.has(g.name)) return [];
    const p = softmax(scores(index, img, g.start, g.labels.length));
    const k = argmax(p);
    return p[k] >= meta.minClueProbability ? [{ label: g.labels[k], p: round4(p[k]) }] : [];
  });
  for (const h of heads) {
    const p = headProbabilities(h, img);
    const k = argmax(p);
    if (p[k] >= meta.minClueProbability) {
      clues.push({ label: h.clue.replace("{}", h.classes[k]), p: round4(p[k]) });
    }
  }

  return {
    city: city.name,
    country: city.country,
    lat: city.lat,
    lng: city.lng,
    confidence: round4(pCountry[order[0]]),
    topCountries: order.map((i) => ({ country: meta.countries[i].code, p: round4(pCountry[i]) })),
    clues: clues.sort((a, b) => b.p - a.p),
    belief: beliefFromProbabilities(
      meta.countries.map((c) => c.code),
      pCountry,
    ),
  };
}

/** Cosine similarity of two embeddings (for the browser-vs-PyTorch parity check). */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.sqrt(na * nb);
}
