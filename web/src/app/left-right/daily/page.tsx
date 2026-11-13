import type { Metadata } from "next";

import LeftRight from "@/components/LeftRight";
import { bundledDeck, bundledDrivingSides } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Left or right?, today's run — Whereabout",
  description:
    "Today's Left or right?: everyone plays the same photos today. Call which side of the road they drive on until your first miss, then share how far you got.",
};

// Today's run is dealt in the browser from the UTC date and each photo's driving side
// (src/lib/game/sideDaily.ts), so the static page is the same every day.
export default function LeftRightDailyPage() {
  return <LeftRight deck={bundledDeck} sides={bundledDrivingSides} daily />;
}
