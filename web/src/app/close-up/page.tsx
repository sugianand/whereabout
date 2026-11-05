import type { Metadata } from "next";

import CloseUp from "@/components/CloseUp";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Close-up — Whereabout",
  description:
    "A tight crop of a photo and four country names: each wrong name zooms out and costs a point. Five photos against Atlas.",
};

// Close-up deals in the browser from the bundled deck, and fetches each photo's record as it comes
// up (src/lib/game/deck.ts).
export default function CloseUpPage() {
  return <CloseUp deck={bundledDeck} />;
}
