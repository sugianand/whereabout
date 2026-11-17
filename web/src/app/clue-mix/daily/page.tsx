import type { Metadata } from "next";

import ClueMix from "@/components/ClueMix";
import {
  bundledClimateGroups,
  bundledContinents,
  bundledGroundCovers,
  bundledDeck,
  bundledDrivingSides,
} from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Clue mix, today's run — Whereabout",
  description:
    "Today's Clue mix: everyone reads the same photos and clues today. The road, the climate, the continent, then the ground, until your first miss, then share how far you got.",
};

// Today's run is dealt in the browser from the UTC date and each photo's four labels
// (src/lib/game/clueDaily.ts), so the static page is the same every day.
export default function ClueMixDailyPage() {
  return (
    <ClueMix
      deck={bundledDeck}
      maps={{
        sides: bundledDrivingSides,
        climates: bundledClimateGroups,
        continents: bundledContinents,
        grounds: bundledGroundCovers,
      }}
      daily
    />
  );
}
