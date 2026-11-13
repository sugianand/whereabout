import type { Metadata } from "next";

import WhichClimate from "@/components/WhichClimate";
import { bundledClimateGroups, bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Which climate?, today's game — Whereabout",
  description:
    "Today's Which climate?: everyone names the Köppen climate of the same five photos today, against Atlas's read. One try, then share your score.",
};

// Today's game is dealt in the browser from the UTC date and each photo's climate group
// (src/lib/game/climateDaily.ts), so the static page is the same every day.
export default function WhichClimateDailyPage() {
  return <WhichClimate deck={bundledDeck} groups={bundledClimateGroups} daily />;
}
