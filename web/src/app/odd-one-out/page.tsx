import type { Metadata } from "next";

import OddOneOut from "@/components/OddOneOut";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Odd one out — Whereabout",
  description:
    "Four photos, three from one continent: tap the one from somewhere else. Keep going until your first miss, and see if Atlas would have spotted it.",
};

// Odd one out deals quads in the browser from the bundled deck's continents, like Further North;
// it fetches each photo's record as its quad comes up (src/lib/game/deck.ts).
export default function OddOneOutPage() {
  return <OddOneOut deck={bundledDeck} />;
}
