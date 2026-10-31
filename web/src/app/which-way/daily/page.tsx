import type { Metadata } from "next";

import WhichWay from "@/components/WhichWay";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Which way?, today's run — Whereabout",
  description:
    "Today's Which way?: everyone sets off on the same journey today. Pick the compass point from photo to photo until your first miss, then share how far you travelled.",
};

// Today's journey is dealt in the browser from the UTC date and the bundled deck
// (src/lib/game/wayDaily.ts), so the static page is the same every day.
export default function WhichWayDailyPage() {
  return <WhichWay deck={bundledDeck} daily />;
}
