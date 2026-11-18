import type { Metadata } from "next";

import OnTheGround from "@/components/OnTheGround";
import { bundledDeck, bundledGroundCovers } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "What's on the ground?, your mix-ups — Whereabout",
  description:
    "What's on the ground? dealt from the land covers you misread most and the ones you took them for, so you learn to tell them apart.",
};

// Your mix-ups live in the browser, so the game is dealt there (src/lib/game/groundMixUps.ts)
// from each photo's land cover, which the page ships.
export default function OnTheGroundMixUpsPage() {
  return <OnTheGround deck={bundledDeck} covers={bundledGroundCovers} practice />;
}
