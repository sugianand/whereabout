import type { Metadata } from "next";
import Link from "next/link";

import HeadToHeadLog from "@/components/HeadToHeadLog";
import MixUps from "@/components/MixUps";
import PlayedMap from "@/components/PlayedMap";
import QuickRecord from "@/components/QuickRecord";
import { CONTINENTS } from "@/lib/continents";
import { bundledClimateGroups, bundledDeck, bundledPhotoCountries } from "@/lib/game/bundled";
import { photosByClimate } from "@/lib/game/climateMixUps";
import { photosByCountry } from "@/lib/game/nameMixUps";
import { streakRegions } from "@/lib/game/regions";

// The continents a Country Streak can be dealt on, for the mix-ups' practice links.
const streakable = ((r) => CONTINENTS.filter((c) => r[c]))(
  streakRegions(bundledDeck.regions, bundledDeck.streakIds),
);

export const metadata: Metadata = {
  title: "Your map — Whereabout",
  description:
    "Every photo you've played in Whereabout on one globe, coloured by how close your pin landed, with the countries you've seen and how you stand against Atlas in the quick games, how often you read the road and the climate right, the climates you misread, the countries you mix up, and every friend's challenge you've answered. Kept only in your browser.",
};

export default function YourMapPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-10 sm:px-6 md:pt-16">
      <Link href="/" className="font-sign text-3xl font-extrabold tracking-tight">
        Whereabout
      </Link>
      <h1 className="mt-10 font-sign text-6xl font-extrabold leading-none tracking-tight sm:text-7xl">
        Your map
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-chalk-dim">
        Every photo you&apos;ve played, where it was really taken, marked by how close your pin
        landed. It stays in this browser and nowhere else.
      </p>
      {/* Only what the closest calls need: where records live, which photos are dealt, and
          the continents a game can be played on. */}
      <PlayedMap
        deck={{ version: bundledDeck.version, ids: bundledDeck.ids, regions: bundledDeck.regions }}
      />
      <MixUps streakable={streakable} photoCounts={photosByCountry(bundledPhotoCountries)} />
      <QuickRecord climateCounts={photosByClimate(bundledClimateGroups)} />
      <HeadToHeadLog />
    </main>
  );
}
