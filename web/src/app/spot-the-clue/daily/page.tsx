import type { Metadata } from "next";

import SpotClue from "@/components/SpotClue";
import { bundledDeck, bundledSpotIds } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Spot the clue, today's game — Whereabout",
  description:
    "Today's Spot the clue: everyone reads Atlas's eyes on the same five photos today. Tap the part of each photo you think told it most. One try, then share your squares.",
};

// Today's game is dealt in the browser from the UTC date (src/lib/game/spotDaily.ts), so the
// static page is the same every day.
export default function SpotTheClueDailyPage() {
  return <SpotClue deck={bundledDeck} ids={bundledSpotIds} daily />;
}
