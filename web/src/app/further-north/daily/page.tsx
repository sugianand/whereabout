import type { Metadata } from "next";

import FurtherNorth from "@/components/FurtherNorth";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Further North, today's run — Whereabout",
  description:
    "Today's Further North: everyone plays the same pairs today. Call which photo was taken further north until your first miss, then share how far you got.",
};

// Today's run is dealt in the browser from the UTC date and the bundled deck
// (src/lib/game/northDaily.ts), so the static page is the same every day.
export default function FurtherNorthDailyPage() {
  return <FurtherNorth deck={bundledDeck} daily />;
}
