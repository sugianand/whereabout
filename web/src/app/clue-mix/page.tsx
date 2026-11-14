import type { Metadata } from "next";

import ClueMix from "@/components/ClueMix";
import {
  bundledClimateGroups,
  bundledContinents,
  bundledDeck,
  bundledDrivingSides,
} from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Clue mix — Whereabout",
  description:
    "Every photo asks a different clue: the side of the road, the climate, then the continent. Read each one right until your first miss, against Atlas's own reads.",
};

// The run is dealt in the browser from each photo's three labels (src/lib/game/clueMix.ts), and
// each photo's record is fetched as it comes up (src/lib/game/deck.ts).
export default function ClueMixPage() {
  return (
    <ClueMix
      deck={bundledDeck}
      maps={{
        sides: bundledDrivingSides,
        climates: bundledClimateGroups,
        continents: bundledContinents,
      }}
    />
  );
}
