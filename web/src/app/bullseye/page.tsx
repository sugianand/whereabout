import type { Metadata } from "next";

import Bullseye from "@/components/Bullseye";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Bullseye — Whereabout",
  description:
    "Pin each photo and bet a ring around your pin: the tighter the ring, the more it pays, but only if the photo is inside. Five photos against Atlas's own bets.",
};

// Bullseye deals photos in the browser from the bundled deck, like Hot and cold; it fetches each
// photo's record as it comes up (src/lib/game/deck.ts).
export default function BullseyePage() {
  return <Bullseye deck={bundledDeck} />;
}
