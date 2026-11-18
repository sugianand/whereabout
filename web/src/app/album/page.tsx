import type { Metadata } from "next";
import Link from "next/link";

import Album from "@/components/Album";
import { bundledContinents, bundledDeck } from "@/lib/game/bundled";

export const metadata: Metadata = {
  title: "Your album — Whereabout",
  description:
    "Every photo Whereabout deals, collected as you play: the ones you've found, continent by continent, with how close your pin landed, and how many each continent still holds. Kept only in your browser.",
};

export default function AlbumPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-10 sm:px-6 md:pt-16">
      <Link href="/" className="font-sign text-3xl font-extrabold tracking-tight">
        Whereabout
      </Link>
      <h1 className="mt-10 font-sign text-6xl font-extrabold leading-none tracking-tight sm:text-7xl">
        Your album
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-chalk-dim">
        Every photo you play is collected here, under its continent. The ones you haven&apos;t
        played yet stay blank, so nothing is given away. It stays in this browser.{" "}
        <Link href="/map" className="font-semibold text-sonar underline-offset-2 hover:underline">
          See them on Your map →
        </Link>
      </p>
      {/* Only each photo's continent reaches the page: what's left to find stays unseen. */}
      <Album
        deck={{ version: bundledDeck.version, regions: bundledDeck.regions }}
        continents={bundledContinents}
      />
    </main>
  );
}
