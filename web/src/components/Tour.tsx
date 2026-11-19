"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { Continent } from "@/lib/continents";
import { regionSlug } from "@/lib/game/regions";
import { formatPoints } from "@/lib/geo";
import { clearedCount, loadTour, nextStop, type TourLeg, type TourRecord } from "@/lib/tour";

import TourGlobe from "./TourGlobe";
import TourShare from "./TourShare";

export interface TourProps {
  /** The legs in route order (`tourRoute`), each with the photos its continent game deals from. */
  legs: { continent: Continent; photos: number }[];
  /** For tests: the tour instead of this browser's. */
  record?: TourRecord;
}

const count = (n: number) => n.toLocaleString("en-US");

/** "18 Nov 2026" from a UTC day key, the same wherever the page is read. */
function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** What a leg's card says under its name: cleared and when, or how close the best try came. */
export function legStatus(leg: TourLeg | undefined): string {
  if (!leg) return "Not visited yet.";
  const { you, atlas } = leg.best;
  const tries = leg.tries === 1 ? "1 game" : `${count(leg.tries)} games`;
  if (leg.cleared)
    return `Cleared ${dayLabel(leg.cleared)}. Best: ${formatPoints(you)} to Atlas's ${formatPoints(atlas)}.`;
  if (you === atlas) return `Your best tied Atlas at ${formatPoints(you)}, over ${tries}.`;
  return `Atlas holds it. Your closest: ${formatPoints(atlas - you)} points behind, over ${tries}.`;
}

/**
 * The World Tour page: the route's legs in order, each cleared, the next stop, or still to beat,
 * with a game on each. The tour is read after hydration, as the page is the same for everyone
 * until then.
 */
export default function Tour({ legs, record: given }: TourProps) {
  const [stored, setStored] = useState<TourRecord | null>(null);
  useEffect(() => {
    if (given) return;
    // Browser storage is only readable after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after hydration
    setStored(loadTour());
  }, [given]);
  const record = given ?? stored ?? {};
  const route = legs.map((l) => l.continent);
  const cleared = clearedCount(route, record);
  const next = nextStop(route, record);

  return (
    <>
      <p className="mt-8 font-sign text-3xl font-bold" data-testid="tour-progress">
        {next === null && route.length > 0 ? (
          <span className="text-gold">
            Tour complete: you&apos;ve beaten Atlas on all {route.length} continents.
          </span>
        ) : (
          <>
            <span className="tabular text-gold">{cleared}</span> of {route.length} continents
            cleared
          </>
        )}
      </p>
      <div
        className="mt-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-graticule/60"
        role="progressbar"
        aria-label="Continents cleared"
        aria-valuemin={0}
        aria-valuemax={route.length}
        aria-valuenow={cleared}
      >
        <div
          className="h-full rounded-full bg-gold transition-[width]"
          style={{ width: route.length ? `${(cleared / route.length) * 100}%` : 0 }}
        />
      </div>

      {route.some((c) => record[c]) && <TourShare route={route} record={record} />}

      <TourGlobe route={route} record={given ?? stored} />

      <ol className="mt-8 grid gap-4 sm:grid-cols-2" aria-label="The route">
        {legs.map(({ continent, photos }, i) => {
          const leg = record[continent];
          const isNext = continent === next;
          const done = Boolean(leg?.cleared);
          return (
            <li
              key={continent}
              data-testid="tour-stop"
              data-continent={continent}
              data-state={done ? "cleared" : isNext ? "next" : "ahead"}
              className={`flex flex-col rounded-2xl border p-5 ${
                done ? "border-gold/60 bg-gold/5" : isNext ? "border-sonar" : "border-graticule"
              }`}
            >
              <p className="text-sm text-chalk-dim">
                Leg {i + 1}
                {isNext && <span className="ml-2 font-semibold text-sonar">Next stop</span>}
                {done && <span className="ml-2 font-semibold text-gold">✓ Cleared</span>}
              </p>
              <h2 className="mt-1 font-sign text-3xl font-bold">{continent}</h2>
              <p className="mt-1 text-chalk-dim">{legStatus(leg)}</p>
              <p className="mt-1 text-sm text-chalk-dim">
                Five of {count(photos)} photos taken in {continent}.
              </p>
              <Link
                href={`/?region=${regionSlug(continent)}`}
                className={`mt-4 self-start rounded-full px-5 py-2 font-semibold transition ${
                  isNext
                    ? "bg-gold text-ocean-deep hover:brightness-110"
                    : "border border-gold/50 text-gold hover:border-gold hover:bg-gold/5"
                }`}
              >
                {done ? `Play ${continent} again` : `Play ${continent}`}
              </Link>
            </li>
          );
        })}
      </ol>
    </>
  );
}
