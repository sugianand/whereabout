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
