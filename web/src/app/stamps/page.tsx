import type { Metadata } from "next";

import Stamps from "@/components/Stamps";
import { bundledById, bundledDeck } from "@/lib/game/bundled";
import { countriesByContinent } from "@/lib/stamps";

export const metadata: Metadata = {
  title: "Stamps — Whereabout",
  description:
    "Stamps to collect in Whereabout: badges, every country of a continent pinned, full days of daily games. Each says how it is earned and how close you are. Kept only in your browser.",
};

// Which countries a continent's stamp asks for is settled at build time from the photos dealt;
// what the player has collected is read in the browser (src/lib/stamps.ts).
const countries = countriesByContinent(
  bundledDeck.ids.map((id) => bundledById.get(id)?.photo.country),
);

export default function StampsPage() {
  return <Stamps countries={countries} deckIds={bundledDeck.ids} />;
}
