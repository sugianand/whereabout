import type { Metadata } from "next";

import OnTheGround from "@/components/OnTheGround";
import { bundledDeck, bundledGroundCovers } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "What's on the ground?, today's game — Whereabout",
  description:
    "Today's What's on the ground?: everyone names the land cover of the same five photos today, against Atlas's read. One try, then share your score.",
};

// Today's game is dealt in the browser from the UTC date and each photo's land cover
// (src/lib/game/groundDaily.ts), so the static page is the same every day.
export default function OnTheGroundDailyPage() {
  return <OnTheGround deck={bundledDeck} covers={bundledGroundCovers} daily />;
}
