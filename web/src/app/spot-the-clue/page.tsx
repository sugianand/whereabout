import type { Metadata } from "next";

import SpotClue from "@/components/SpotClue";
import { bundledDeck, bundledSpotIds } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Spot the clue — Whereabout",
  description:
    "Atlas names a country from a photo. Tap the part of the photo you think told it most, then see Atlas's real map of where it looked. Five photos.",
};

// The game is dealt in the browser from the photos with a map of where Atlas looked
// (src/lib/game/spotClue.ts), and each photo's record, map included, is fetched as it comes up.
export default function SpotTheCluePage() {
  return <SpotClue deck={bundledDeck} ids={bundledSpotIds} />;
}
