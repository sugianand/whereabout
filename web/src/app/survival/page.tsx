import type { Metadata } from "next";

import Survival from "@/components/Survival";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Survival — Whereabout",
  description:
    "Pin one photo after another on the globe until your misses empty a 5,000-point health bar. How many can you survive?",
};

// Survival deals photos in the browser from the bundled deck, like Country Streak; it fetches
// each photo's record as it comes up (src/lib/game/deck.ts).
export default function SurvivalPage() {
  return <Survival deck={bundledDeck} />;
}
