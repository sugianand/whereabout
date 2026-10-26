import type {
  AtlasCalibrationSummary,
  AtlasClueHeadResult,
  AtlasGeocellHeadSummary,
  AtlasRetrievalSummary,
} from "@/lib/game/types";

/** The evaluation row for the pipeline Pocket Atlas runs in the browser ("Your photo"). */
export const POCKET_SYSTEM = "ViT-B-32/openai, country then city";

/** "ViT-L-14/openai, country then city" → a name people can read. */
export function systemLabel(name: string): string {
  return name
    .replace("ViT-L-14/openai", "CLIP ViT-L/14 (OpenAI)")
    .replace("ViT-B-32/openai", "CLIP ViT-B/32 (OpenAI)")
    .replace("ViT-B-32/laion2b_s34b_b79k", "CLIP ViT-B/32 (LAION-2B)")
    .replace(" (baseline)", "");
}

const wholeKm = (x: number) => `${Math.round(Math.abs(x)).toLocaleString("en-US")} km`;

/** How the refinement changed the median error, in words: "went down by 120 km". */
function change(deltaKm: number): string {
  if (Math.round(deltaKm) === 0) return "did not change";
  return deltaKm < 0 ? `went down by ${wholeKm(deltaKm)}` : `went up by ${wholeKm(deltaKm)}`;
}

/** A signed interval bound, "-340 km" or "+25 km", for the 95% interval. */
function signed(x: number): string {
  const r = Math.round(x);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${wholeKm(r)}`;
}

/**
 * One sentence on the retrieval refinement's run, for the results table: what it searched,
 * what it did to the median error, and whether it is the Atlas players meet.
 */
export function retrievalNote(r: AtlasRetrievalSummary): string {
  const [lo, hi] = r.ci95;
  const searched =
    `Atlas also tried moving its pin to the most similar of ` +
    `${r.references.toLocaleString("en-US")} geotagged reference photos ` +
    `(never game photos) in the country it chose. That moved the pin on ` +
    `${r.moved.toLocaleString("en-US")} of ${r.n.toLocaleString("en-US")} photos, and the ` +
    `median error ${change(r.median_km_delta)} ` +
    `(95% interval ${signed(lo)} to ${signed(hi)}).`;
  return r.ships
    ? `${searched} The whole interval is below zero, so this is the Atlas you play against.`
    : `${searched} It only plays once the whole interval is below zero, so the game keeps ` +
        `the Atlas without it for now.`;
}

/**
 * One sentence on the trained geocell head, for the results table: what it learned from, what
 * placing the pin with it did to the median error, and whether it places the pin players see.
 */
export function geocellNote(g: AtlasGeocellHeadSummary): string {
  const [lo, hi] = g.ci95;
  const measured =
    `Atlas also trained a map of its own: a classifier that sorts a photo into one of ` +
    `${g.cells.toLocaleString("en-US")} regions of the world, learned from ` +
    `${g.references.toLocaleString("en-US")} geotagged reference photos (never game photos). ` +
    `Keeping Atlas's country and letting the classifier place the pin inside it moved the pin ` +
    `on ${g.moved.toLocaleString("en-US")} of ${g.n.toLocaleString("en-US")} photos, and the ` +
    `median error ${change(g.median_km_delta)} (95% interval ${signed(lo)} to ${signed(hi)}).`;
  return g.ships
    ? `${measured} The whole interval is below zero, so it places the pin you play against.`
    : `${measured} It only plays once the whole interval is below zero, so the game keeps ` +
        `the pin without it for now.`;
}

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;

/**
 * What calibration did, for "How sure it is": the temperature, the held-out calibration error
 * before and after, and which probabilities the reveal shows.
 */
export function calibrationNote(c: AtlasCalibrationSummary): string {
  const t = c.temperature.toFixed(2);
  const lean =
    c.temperature > 1.05
      ? "a little overconfident"
      : c.temperature < 0.95
        ? "a little underconfident"
        : "close to honest already";
  const measured =
    `The atlas run also tried temperature scaling: one number that softens or sharpens every ` +
    `probability without changing which country comes first. Fitted on ${c.n.toLocaleString("en-US")} ` +
    `photos it came out at ${t}, so the raw model was ${lean}. On photos each fit never saw, ` +
    `the average gap between how sure Atlas said it was and how often it was right went from ` +
    `${pct1(c.raw.ece)} to ${pct1(c.calibrated.ece)}.`;
  return c.ships
    ? `${measured} That fit held up on unseen photos, so the percentages in the game are the scaled ones.`
    : `${measured} It did not hold up on unseen photos, so the game keeps the raw percentages.`;
}

const CONCEPT_NAMES: Record<string, string> = {
  driving_side: "which side of the road traffic drives on",
  climate_group: "the climate",
};

const pctWhole = (x: number) => `${Math.round(x * 100)}%`;

/** "+6 points" or "−3 points": an accuracy difference in percentage points. */
function points(x: number): string {
  const r = Math.round(x * 100);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)} point${Math.abs(r) === 1 ? "" : "s"}`;
}

/**
 * One sentence per clue head: how often it read its concept right on photos from places it
 * never trained on, against what the reveal used before, and whether it now writes that clue.
 */
export function clueHeadNote(h: AtlasClueHeadResult): string {
  const what = CONCEPT_NAMES[h.concept] ?? h.concept.replace(/_/g, " ");
  const [lo, hi] = h.ci95;
  const measured =
    `A probe trained on ${h.references.toLocaleString("en-US")} reference photos to read ` +
    `${what} got it right on ${pctWhole(h.headAccuracy)} of ${h.n.toLocaleString("en-US")} ` +
    `game photos from places it never trained on; ${h.baseline} got ` +
    `${pctWhole(h.baselineAccuracy)} (difference ${points(h.accuracyDelta)}, 95% interval ` +
    `${points(lo)} to ${points(hi)}).`;
  return h.ships
    ? `${measured} The whole interval is above zero, so the probe writes that clue at the reveal.`
    : `${measured} It only takes over once the whole interval is above zero, so the reveal keeps ` +
        `its old source for now.`;
}
