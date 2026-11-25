import type { Metadata } from "next";

import FooledAtlas from "@/components/FooledAtlas";
import { bundledDeck, bundledFooledIds } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Which fooled Atlas?, today's run — Whereabout",
  description:
    "Today's Which fooled Atlas?: everyone plays the same pairs today. Pick the photo Atlas, the AI, placed further from home until your first miss, then share how far you got.",
};

// Today's run is dealt in the browser from the UTC date and the photos Atlas pinned
// (src/lib/game/fooledDaily.ts), so the static page is the same every day.
export default function FooledAtlasDailyPage() {
  return <FooledAtlas deck={bundledDeck} ids={bundledFooledIds} daily />;
}
