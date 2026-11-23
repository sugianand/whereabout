import type { Metadata } from "next";

import TrustAtlas from "@/components/TrustAtlas";
import { bundledDeck, bundledTrustIds } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Trust Atlas? — Whereabout",
  description:
    "Atlas names the country a photo was taken in and says how sure it is. Call whether it got it right, against Atlas's own sureness. Ten photos.",
};

// The game is dealt in the browser from the photos Atlas named a country for
// (src/lib/game/trustAtlas.ts), and each photo's record is fetched as it comes up.
export default function TrustAtlasPage() {
  return <TrustAtlas deck={bundledDeck} ids={bundledTrustIds} />;
}
