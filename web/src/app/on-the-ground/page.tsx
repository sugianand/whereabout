import type { Metadata } from "next";

import OnTheGround from "@/components/OnTheGround";
import { bundledDeck, bundledGroundCovers } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "What's on the ground? — Whereabout",
  description:
    "One photo and five land covers: built-up, trees, grassland, water or bare ground? Five photos a game against Atlas's own read of the scene.",
};

// The game is dealt in the browser from each photo's land cover (src/lib/game/onTheGround.ts),
// and each photo's record is fetched as it comes up (src/lib/game/deck.ts).
export default function OnTheGroundPage() {
  return <OnTheGround deck={bundledDeck} covers={bundledGroundCovers} />;
}
