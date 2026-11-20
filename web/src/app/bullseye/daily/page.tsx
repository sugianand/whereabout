import type { Metadata } from "next";

import Bullseye from "@/components/Bullseye";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Bullseye, today's game — Whereabout",
  description:
    "Today's Bullseye: everyone pins the same five photos today and bets a ring around each pin, against Atlas's own bets. One try, then share your rings.",
};

// Today's game is dealt in the browser from the UTC date (src/lib/game/bullseyeDaily.ts), so the
// static page is the same every day.
export default function BullseyeDailyPage() {
  return <Bullseye deck={bundledDeck} daily />;
}
