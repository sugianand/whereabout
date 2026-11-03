import type { Metadata } from "next";

import Today from "@/components/Today";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Today — Whereabout",
  description:
    "Every daily game in Whereabout on one page: what you've played today, the time to the next deal, and one line that shares your whole day.",
};

// Each game's day is read in the browser (src/lib/game/today.ts), so the static page is the same
// every day.
export default function TodayPage() {
  return <Today deckIds={bundledDeck.ids} />;
}
