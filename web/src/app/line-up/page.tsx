import type { Metadata } from "next";

import LineUp from "@/components/LineUp";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Line them up — Whereabout",
  description:
    "Four photos to put in order from west to east, by drag or by tap, five rows a game against Atlas.",
};

// Line them up deals in the browser from the bundled deck, and fetches each row's records as it
// comes up (src/lib/game/deck.ts).
export default function LineUpPage() {
  return <LineUp deck={bundledDeck} />;
}
