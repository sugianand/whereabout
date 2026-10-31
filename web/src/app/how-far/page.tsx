import type { Metadata } from "next";

import HowFar from "@/components/HowFar";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "How far apart? — Whereabout",
  description:
    "Two photos, one slider: how far apart were they taken? Five pairs a game, scored by how many times off you were, with Atlas's own estimate beside yours.",
};

// How far apart? deals photos in the browser from the bundled deck, like Further North; it
// fetches each pair's records as they come up (src/lib/game/deck.ts).
export default function HowFarPage() {
  return <HowFar deck={bundledDeck} />;
}
