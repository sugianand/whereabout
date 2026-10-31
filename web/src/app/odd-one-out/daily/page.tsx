import type { Metadata } from "next";

import OddOneOut from "@/components/OddOneOut";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Odd one out, today's run — Whereabout",
  description:
    "Today's Odd one out: everyone gets the same four photos today. Tap the one from another continent until your first miss, then share how far you got.",
};

// Today's run is dealt in the browser from the UTC date and the bundled deck
// (src/lib/game/oddDaily.ts), so the static page is the same every day.
export default function OddOneOutDailyPage() {
  return <OddOneOut deck={bundledDeck} daily />;
}
