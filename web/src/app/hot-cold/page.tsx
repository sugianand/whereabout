import type { Metadata } from "next";

import HotCold from "@/components/HotCold";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Hot and cold — Whereabout",
  description:
    "One photo, three pins to find its country: every miss says how far off you were and which way to head. Five photos against Atlas's single pin.",
};

// Hot and cold deals photos in the browser from the bundled deck, like Survival; it fetches each
// photo's record as it comes up (src/lib/game/deck.ts).
export default function HotColdPage() {
  return <HotCold deck={bundledDeck} />;
}
