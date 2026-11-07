import type { Metadata } from "next";

import CloseUp from "@/components/CloseUp";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Close-up, today's game — Whereabout",
  description:
    "Today's Close-up: everyone gets the same five crops and names today. Each wrong name zooms out and costs a point; share how few clues you needed.",
};

// Today's photos are dealt in the browser from the UTC date and the bundled deck
// (src/lib/game/closeDaily.ts), so the static page is the same every day.
export default function CloseUpDailyPage() {
  return <CloseUp deck={bundledDeck} daily />;
}
