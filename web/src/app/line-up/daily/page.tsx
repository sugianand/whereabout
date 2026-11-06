import type { Metadata } from "next";

import LineUp from "@/components/LineUp";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Line them up, today's game — Whereabout",
  description:
    "Today's Line them up: everyone gets the same five rows today. Put each row's four photos in order from west to east, then share how many stood in place.",
};

// Today's rows are dealt in the browser from the UTC date and the bundled deck
// (src/lib/game/lineDaily.ts), so the static page is the same every day.
export default function LineUpDailyPage() {
  return <LineUp deck={bundledDeck} daily />;
}
