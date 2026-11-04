import type { Metadata } from "next";

import NameCountry from "@/components/NameCountry";
import { bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Name the country — Whereabout",
  description:
    "One photo, four countries from the same continent: tap the right one, and keep going until your first miss, with Atlas picking too.",
};

// Name the country deals in the browser from the bundled deck, and fetches each photo's record as
// it comes up (src/lib/game/deck.ts).
export default function NameCountryPage() {
  return <NameCountry deck={bundledDeck} />;
}
