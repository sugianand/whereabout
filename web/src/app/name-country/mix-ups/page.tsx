import type { Metadata } from "next";

import NameCountry from "@/components/NameCountry";
import { bundledDeck, bundledPhotoCountries } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Name the country, your mix-ups — Whereabout",
  description:
    "Name the country dealt from the countries you mix up most, with the one you took each for among the four names, so you learn to tell them apart.",
};

// The mix-ups live in the browser, so the run is dealt there (src/lib/game/nameMixUps.ts); the
// page ships each dealable photo's country so it can pick photos without fetching every record.
export default function NameCountryMixUpsPage() {
  return <NameCountry deck={bundledDeck} practice={bundledPhotoCountries} />;
}
