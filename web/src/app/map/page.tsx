import type { Metadata } from "next";
import Link from "next/link";

import BullseyeCalibration from "@/components/BullseyeCalibration";
import FooledRead from "@/components/FooledRead";
import HedgeOdds from "@/components/HedgeOdds";
import HeadToHeadLog from "@/components/HeadToHeadLog";
import MixUps from "@/components/MixUps";
import PlayedMap from "@/components/PlayedMap";
import QuickRecord from "@/components/QuickRecord";
import SpotRead from "@/components/SpotRead";
import TrustRead from "@/components/TrustRead";
import { CONTINENTS } from "@/lib/continents";
import {
  bundledClimateGroups,
  bundledDeck,
  bundledGroundCovers,
  bundledPhotoCountries,
} from "@/lib/game/bundled";
import { photosByClimate } from "@/lib/game/climateMixUps";
import { photosByCover } from "@/lib/game/groundMixUps";
import { photosByCountry } from "@/lib/game/nameMixUps";
import { streakRegions } from "@/lib/game/regions";

// The continents a Country Streak can be dealt on, for the mix-ups' practice links.
const streakable = ((r) => CONTINENTS.filter((c) => r[c]))(
  streakRegions(bundledDeck.regions, bundledDeck.streakIds),
);

export const metadata: Metadata = {
  title: "Your map — Whereabout",
  description:
    "Every photo you've played in Whereabout on one globe, coloured by how close your pin landed, with the countries you've seen and how you stand against Atlas in the quick games, how often you read the road and the climate right, the climates and ground you misread, the countries you mix up, how often your Bullseye rings hold against Atlas's, how well you read where Atlas looks in Spot the clue, how well you call Atlas's answers in Trust Atlas? beside its own sureness, how well you read which photo fooled Atlas by how far apart its misses were, how true your Hedge your bets chips run beside Atlas's own odds, and every friend's challenge you've answered. Kept only in your browser.",
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
        landed. It stays in this browser and nowhere else.{" "}
        <Link href="/album" className="font-semibold text-sonar underline-offset-2 hover:underline">
          Your album →
        </Link>
      </p>
      {/* Only what the closest calls need: where records live, which photos are dealt, and
          the continents a game can be played on. */}
      <PlayedMap
        deck={{ version: bundledDeck.version, ids: bundledDeck.ids, regions: bundledDeck.regions }}
      />
      <MixUps streakable={streakable} photoCounts={photosByCountry(bundledPhotoCountries)} />
      <QuickRecord
        climateCounts={photosByClimate(bundledClimateGroups)}
        groundCounts={photosByCover(bundledGroundCovers)}
      />
      <BullseyeCalibration />
      <SpotRead />
      <TrustRead />
      <FooledRead />
      <HedgeOdds />
      <HeadToHeadLog />
    </main>
  );
}
