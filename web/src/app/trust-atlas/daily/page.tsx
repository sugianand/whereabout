import type { Metadata } from "next";

import TrustAtlas from "@/components/TrustAtlas";
import { bundledDeck, bundledTrustIds } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Trust Atlas?, today's game — Whereabout",
  description:
    "Today's Trust Atlas?: everyone calls Atlas's answers on the same ten photos today. Trust it or doubt it, against Atlas's own sureness. One try, then share your calls.",
};

// Today's game is dealt in the browser from the UTC date (src/lib/game/trustDaily.ts), so the
// static page is the same every day.
export default function TrustAtlasDailyPage() {
  return <TrustAtlas deck={bundledDeck} ids={bundledTrustIds} daily />;
}
