import type { Metadata } from "next";

import HowFar from "@/components/HowFar";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "How far apart?, today's game — Whereabout",
  description:
    "Today's How far apart?: everyone gets the same five pairs of photos today. Set how far apart each was taken, then share your score.",
};

// Today's pairs are dealt in the browser from the UTC date and the bundled deck
// (src/lib/game/farDaily.ts), so the static page is the same every day.
export default function HowFarDailyPage() {
  return <HowFar deck={bundledDeck} daily />;
}
