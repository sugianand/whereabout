"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  averageAway,
  favouriteThird,
  loadSpotRead,
  lookLine,
  spotReadLine,
  thirdName,
  warmRate,
  type SpotRead as Read,
} from "@/lib/game/spotRead";

const LINK =
  "rounded-full border border-chalk/30 px-4 py-2 font-semibold transition hover:border-chalk";

/** One side's 3 × 3 of the photo: each third shaded by its share of that side's count. */
function ThirdsChart({
  who,
  counts,
  noun,
  color,
  testId,
}: {
  who: string;
  counts: readonly number[];
  noun: [one: string, many: string];
  color: string;
  testId: string;
}) {
  const top = Math.max(...counts);
  const favourite = favouriteThird(counts);
  return (
    <figure className="w-full" data-testid={testId}>
      <figcaption className="text-sm font-semibold">{who}</figcaption>
      <ol
        className="mt-2 grid aspect-square grid-cols-3 gap-1"
        aria-label={`Where ${who === "You" ? "you look" : "Atlas looks"}, by third of the photo`}
      >
        {counts.map((n, i) => (
          <li
            key={i}
            className={`relative grid place-items-center overflow-hidden rounded-md border text-sm font-semibold tabular-nums ${
              i === favourite ? "border-chalk" : "border-graticule"
            }`}
            aria-label={`${thirdName(i)}: ${n} ${n === 1 ? noun[0] : noun[1]}`}
            data-count={n}
          >
            <span
              aria-hidden
              className={`absolute inset-0 ${color}`}
              style={{ opacity: top > 0 ? (0.15 + 0.7 * (n / top)).toFixed(2) : 0 }}
            />
            <span aria-hidden className="relative rounded-full bg-ocean-deep px-1.5 leading-5">
              {n}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/**
 * Your read of Atlas on Your map: over every Spot the clue square locked in, in free games,
 * challenges and today's, how often it was warm or better and how far from Atlas's hottest it
 * landed, with where on the photo you look beside where Atlas does as two 3 × 3 charts
 * (`lib/game/spotRead.ts`). Read after mount, so the static page never guesses at it; nothing
 * shows until a square has been picked.
 */
export default function SpotRead() {
  const [read, setRead] = useState<Read | null>(null);

  useEffect(() => {
    // Storage only exists in the browser, so the counts are read once the page is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRead(loadSpotRead());
  }, []);

  if (!read || read.picked === 0) return null;
  const look = lookLine(read);

  return (
    <section className="mt-12" aria-labelledby="spot-read-heading" data-testid="spot-read">
      <h2 id="spot-read-heading" className="font-sign text-3xl font-extrabold">
        Your read of Atlas
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-chalk-dim">
        Every square you&apos;ve picked in Spot the clue, in free games, challenges and
        today&apos;s: how often it told Atlas a lot, and where on the photo you look for the clue
        beside where Atlas found it.
      </p>
      <p
        className="mt-4 max-w-2xl text-lg font-semibold"
        data-testid="spot-read-line"
        data-warm-rate={warmRate(read)?.toFixed(3)}
        data-away={averageAway(read)?.toFixed(3)}
      >
        {spotReadLine(read)}
        {look && <span className="block text-base font-normal">{look}</span>}
      </p>
      <div className="mt-4 grid max-w-md grid-cols-2 gap-4 sm:gap-6">
        <ThirdsChart
          who="You"
          counts={read.you}
          noun={["square", "squares"]}
          color="bg-flare"
          testId="spot-read-you"
        />
        <ThirdsChart
          who="Atlas"
          counts={read.atlas}
          noun={["photo", "photos"]}
          color="bg-sonar"
          testId="spot-read-atlas"
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link href="/spot-the-clue" className={LINK}>
          Play Spot the clue
        </Link>
        <Link href="/spot-the-clue/daily" className={LINK}>
          Today&apos;s Spot the clue
        </Link>
      </div>
    </section>
  );
}
