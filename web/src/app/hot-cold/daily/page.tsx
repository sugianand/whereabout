import type { Metadata } from "next";

import HotCold from "@/components/HotCold";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Hot and cold, today's game — Whereabout",
  description:
    "Today's Hot and cold: everyone gets the same five photos today. Three pins to find each country, an arrow after every miss, one try, then share your pins.",
};

// Today's game is dealt in the browser from the UTC date and the bundled deck
// (src/lib/game/hotDaily.ts), so the static page is the same every day.
export default function HotColdDailyPage() {
  return <HotCold deck={bundledDeck} daily />;
}
