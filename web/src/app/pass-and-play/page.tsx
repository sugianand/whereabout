import type { Metadata } from "next";

import PassAndPlay from "@/components/PassAndPlay";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Pass and play — Whereabout",
  description:
    "Two to four players, one device: take turns pinning the same five photos on the globe, then see every pin, Atlas's too, and who wins.",
};

// Pass and play deals photos in the browser from the bundled deck, like Survival; it fetches
// each photo's record as it comes up (src/lib/game/deck.ts).
export default function PassAndPlayPage() {
  return <PassAndPlay deck={bundledDeck} />;
}
