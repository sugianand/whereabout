import type { Metadata } from "next";

import Hedge from "@/components/Hedge";
import { bundledDeck, bundledHedgeIds } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Hedge your bets — Whereabout",
  description:
    "Four countries and ten chips for each photo: spread them the way you rate the odds, scored by a rule that pays an honest hedge. Five photos against Atlas's own probabilities.",
};

// The game is dealt in the browser from the photos Atlas weighed another country for
// (src/lib/game/hedge.ts), and each photo's record is fetched as it comes up.
export default function HedgePage() {
  return <Hedge deck={bundledDeck} ids={bundledHedgeIds} />;
}
