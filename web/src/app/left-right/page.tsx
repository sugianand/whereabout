import type { Metadata } from "next";

import LeftRight from "@/components/LeftRight";
import { bundledDeck, bundledDrivingSides } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Left or right? — Whereabout",
  description:
    "One photo, one question: do they drive on the left or the right where it was taken? Swipe or tap your call until your first miss, against Atlas's read of the road.",
};

// The run is dealt in the browser from each photo's driving side (src/lib/game/leftRight.ts),
// and each photo's record is fetched as it comes up (src/lib/game/deck.ts).
export default function LeftRightPage() {
  return <LeftRight deck={bundledDeck} sides={bundledDrivingSides} />;
}
