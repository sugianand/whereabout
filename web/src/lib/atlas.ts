import type { AtlasCalibrationSummary, AtlasRetrievalSummary } from "@/lib/game/types";

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
