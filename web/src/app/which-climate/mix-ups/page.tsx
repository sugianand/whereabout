import type { Metadata } from "next";

import WhichClimate from "@/components/WhichClimate";
import { bundledClimateGroups, bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Which climate?, your mix-ups — Whereabout",
  description:
    "Which climate? dealt from the climates you misread most and the ones you took them for, so you learn to tell them apart.",
};

// Your mix-ups live in the browser, so the game is dealt there (src/lib/game/climateMixUps.ts)
// from each photo's climate group, which the page ships.
export default function WhichClimateMixUpsPage() {
  return <WhichClimate deck={bundledDeck} groups={bundledClimateGroups} practice />;
}
