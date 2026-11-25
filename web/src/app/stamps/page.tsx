import type { Metadata } from "next";

import Stamps from "@/components/Stamps";
import { bundledById, bundledContinents, bundledDeck } from "@/lib/game/bundled";
import { offeredRegions } from "@/lib/game/regions";
import { countriesByContinent } from "@/lib/stamps";
import { tourRoute } from "@/lib/tour";

export const metadata: Metadata = {
  title: "Stamps — Whereabout",
  description:
    "Stamps to collect in Whereabout: badges, every country of a continent pinned, full days of daily games, your album filled, World Tour legs cleared, Bullseye rings held, Atlas's clues spotted, Atlas's sureness read. Each says how it is earned and how close you are. Kept only in your browser.",
};

// Which countries a continent's stamp asks for is settled at build time from the photos dealt;
// what the player has collected is read in the browser (src/lib/stamps.ts).
const countries = countriesByContinent(
  bundledDeck.ids.map((id) => bundledById.get(id)?.photo.country),
);

// The tour's legs are the continents the deck deals a game on, as on the tour page.
const route = tourRoute(offeredRegions(bundledDeck.regions ?? {}));

export default function StampsPage() {
  return (
    <Stamps
      countries={countries}
      deckIds={bundledDeck.ids}
      album={bundledContinents}
      tourRoute={route}
    />
  );
}
