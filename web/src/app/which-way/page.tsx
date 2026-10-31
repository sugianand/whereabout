import type { Metadata } from "next";

import WhichWay from "@/components/WhichWay";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Which way? — Whereabout",
  description:
    "Two photos, eight compass points: which way would you set off from the first to reach the second? The reveal draws the route on the globe.",
};

// Which way? deals photos in the browser from the bundled deck, like Further North; it fetches
// each stop's record as it comes up (src/lib/game/deck.ts).
export default function WhichWayPage() {
  return <WhichWay deck={bundledDeck} />;
}
