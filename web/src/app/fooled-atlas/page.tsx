import type { Metadata } from "next";

import FooledAtlas from "@/components/FooledAtlas";
import { bundledDeck, bundledFooledIds } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Which fooled Atlas? — Whereabout",
  description:
    "Two photos, one question: which one did Atlas, the AI, place further from where it was taken? Keep calling pairs until your first miss, against Atlas's own sureness.",
};

// The run is dealt in the browser from the photos Atlas pinned (src/lib/game/fooledAtlas.ts),
// and each photo's record, with Atlas's pin, is fetched as it comes up.
export default function FooledAtlasPage() {
  return <FooledAtlas deck={bundledDeck} ids={bundledFooledIds} />;
}
