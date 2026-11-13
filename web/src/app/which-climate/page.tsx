import type { Metadata } from "next";

import WhichClimate from "@/components/WhichClimate";
import { bundledClimateGroups, bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Which climate? — Whereabout",
  description:
    "One photo and the five Köppen climates: tropical, arid, temperate, continental or polar? Five photos a game against Atlas's own read of the climate.",
};

// The game is dealt in the browser from each photo's climate group (src/lib/game/whichClimate.ts),
// and each photo's record is fetched as it comes up (src/lib/game/deck.ts).
export default function WhichClimatePage() {
  return <WhichClimate deck={bundledDeck} groups={bundledClimateGroups} />;
}
