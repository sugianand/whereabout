import type { AtlasRetrievalSummary } from "@/lib/game/types";

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
