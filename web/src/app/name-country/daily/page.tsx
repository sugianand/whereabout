import type { Metadata } from "next";

import NameCountry from "@/components/NameCountry";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Name the country, today's run — Whereabout",
  description:
    "Today's Name the country: everyone gets the same photos and the same four names today. Tap the right one until your first miss, then share how far you got.",
};

// Today's run is dealt in the browser from the UTC date and the bundled deck
// (src/lib/game/nameDaily.ts), so the static page is the same every day.
export default function NameCountryDailyPage() {
  return <NameCountry deck={bundledDeck} daily />;
}
