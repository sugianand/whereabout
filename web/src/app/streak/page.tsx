import type { Metadata } from "next";

import CountryStreak from "@/components/CountryStreak";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Country Streak — Whereabout",
  description:
    "Name the country each photo was taken in by tapping it on the globe. How many can you get in a row?",
};

// Country Streak deals photos in the browser from the bundled deck, like a local game; it
// fetches each photo's record as it comes up (src/lib/game/deck.ts).
export default function CountryStreakPage() {
  return <CountryStreak deck={bundledDeck} />;
}
