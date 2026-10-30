import type { Metadata } from "next";

import FurtherNorth from "@/components/FurtherNorth";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Further North — Whereabout",
  description:
    "Two photos, one question: which was taken further north? Keep calling pairs until your first wrong pick, and see if Atlas would have got them.",
};

// Further North deals photos in the browser from the bundled deck, like Survival; it fetches
// each photo's record as it comes up (src/lib/game/deck.ts).
export default function FurtherNorthPage() {
  return <FurtherNorth deck={bundledDeck} />;
}
