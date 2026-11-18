import type { Metadata } from "next";
import Link from "next/link";

import Tour from "@/components/Tour";
import { bundledDeck } from "@/lib/game/bundled";
import { offeredRegions } from "@/lib/game/regions";
import { tourRoute } from "@/lib/tour";

export const metadata: Metadata = {
  title: "World Tour — Whereabout",
  description:
    "Beat Atlas, the AI player, on its home ground, continent by continent: a five-photo game on each, cleared the first time you outscore it there. Kept only in your browser.",
};

export default function TourPage() {
  const regions = bundledDeck.regions ?? {};
  const legs = tourRoute(offeredRegions(regions)).map((continent) => ({
    continent,
    photos: regions[continent]?.length ?? 0,
  }));
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-20 pt-10 sm:px-6 md:pt-16">
      <Link href="/" className="font-sign text-3xl font-extrabold tracking-tight">
        Whereabout
      </Link>
      <h1 className="mt-10 font-sign text-6xl font-extrabold leading-none tracking-tight sm:text-7xl">
        World Tour
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-chalk-dim">
        Beat Atlas on its home ground, one continent at a time. Each leg is five photos all taken on
        one continent; outscore Atlas over the five and the leg is yours. Any game on a continent
        counts. It stays in this browser.
      </p>
      <Tour legs={legs} />
    </main>
  );
}
