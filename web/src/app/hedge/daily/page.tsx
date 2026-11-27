import type { Metadata } from "next";

import Hedge from "@/components/Hedge";
import { bundledDeck, bundledHedgeIds } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Hedge your bets, today's game — Whereabout",
  description:
    "Today's Hedge your bets: everyone spreads ten chips over the same four countries on the same five photos today, against Atlas's own probabilities. One try, then share your points.",
};

// Today's game is dealt in the browser from the UTC date (src/lib/game/hedgeDaily.ts), so the
// static page is the same every day.
export default function HedgeDailyPage() {
  return <Hedge deck={bundledDeck} ids={bundledHedgeIds} daily />;
}
