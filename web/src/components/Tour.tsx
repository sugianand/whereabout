"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { Continent } from "@/lib/continents";
import { regionSlug } from "@/lib/game/regions";
import { formatPoints } from "@/lib/geo";
import {
  clearedCount,
  loadTour,
  nextStop,
  type TourLap,
  type TourLeg,
  type TourRecord,
} from "@/lib/tour";

import TourGlobe from "./TourGlobe";
import TourShare from "./TourShare";

export interface TourProps {
  /** The legs in route order (`tourRoute`), each with the photos its continent game deals from. */
  legs: { continent: Continent; photos: number }[];
  /** For tests: the tour instead of this browser's. */
  record?: TourRecord;
  /** For tests: the Blitz lap instead of this browser's. */
  blitzRecord?: TourRecord;
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
export default function Tour({ legs, record: given, blitzRecord: givenBlitz }: TourProps) {
  const [stored, setStored] = useState<TourRecord | null>(null);
  const [storedBlitz, setStoredBlitz] = useState<TourRecord | null>(null);
  useEffect(() => {
    // Browser storage is only readable after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after hydration
    if (!given) setStored(loadTour());
    if (!givenBlitz) setStoredBlitz(loadTour(undefined, "blitz"));
  }, [given, givenBlitz]);
  const record = given ?? stored ?? {};
  const blitzRecord = givenBlitz ?? storedBlitz ?? {};
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

      <Legs legs={legs} record={record} lap="first" />

      {route.length > 0 && <BlitzLap legs={legs} record={blitzRecord} open={next === null} />}
    </>
  );
}

/** A game on one leg: the continent game, or on the Blitz lap the continent against the clock. */
function legHref(continent: Continent, lap: TourLap): string {
  return `/?region=${regionSlug(continent)}${lap === "blitz" ? "&blitz" : ""}`;
}

/** One lap's legs in route order, each cleared, the next stop, or still to beat, with its game. */
function Legs({
  legs,
  record,
  lap,
}: {
  legs: TourProps["legs"];
  record: TourRecord;
  lap: TourLap;
}) {
  const next = nextStop(
    legs.map((l) => l.continent),
    record,
  );
  const blitz = lap === "blitz";
  const name = (continent: Continent) => (blitz ? `${continent} Blitz` : continent);
  // Inside the Blitz lap's own section, its legs sit a level below its heading.
  const Heading = blitz ? "h3" : "h2";
  return (
    <ol
      className="mt-8 grid gap-4 sm:grid-cols-2"
      aria-label={blitz ? "The Blitz lap" : "The route"}
    >
      {legs.map(({ continent, photos }, i) => {
        const leg = record[continent];
        const isNext = continent === next;
        const done = Boolean(leg?.cleared);
        return (
          <li
            key={continent}
            data-testid={blitz ? "blitz-stop" : "tour-stop"}
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
            <Heading className="mt-1 font-sign text-3xl font-bold">{name(continent)}</Heading>
            <p className="mt-1 text-chalk-dim">{legStatus(leg)}</p>
            <p className="mt-1 text-sm text-chalk-dim">
              Five of {count(photos)} photos taken in {continent}
              {blitz ? ", 30 seconds each." : "."}
            </p>
            <Link
              href={legHref(continent, lap)}
              className={`mt-4 self-start rounded-full px-5 py-2 font-semibold transition ${
                isNext
                  ? "bg-gold text-ocean-deep hover:brightness-110"
                  : "border border-gold/50 text-gold hover:border-gold hover:bg-gold/5"
              }`}
            >
              {done ? `Play ${name(continent)} again` : `Play ${name(continent)}`}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The second lap: the same route against the 30-second Blitz clock, with its own record. Until
 * the first lap is complete it is a line saying what clearing it opens; a Blitz leg already won
 * is kept and shows once the lap opens.
 */
function BlitzLap({
  legs,
  record,
  open,
}: {
  legs: TourProps["legs"];
  record: TourRecord;
  open: boolean;
}) {
  const route = legs.map((l) => l.continent);
  const cleared = clearedCount(route, record);
  const done = nextStop(route, record) === null;
  return (
    <section className="mt-14" aria-labelledby="blitz-lap" data-testid="blitz-lap">
      <h2 id="blitz-lap" className="font-sign text-4xl font-extrabold tracking-tight">
        Second lap: Blitz
      </h2>
      {!open ? (
        <p className="mt-3 max-w-2xl text-chalk-dim" data-testid="blitz-locked">
          Clear every leg to open the Blitz lap: the same route again, with 30 seconds on each
          photo.
        </p>
      ) : (
        <>
          <p className="mt-3 max-w-2xl text-chalk-dim">
            The same route again, against the clock: 30 seconds on each photo, and outscore Atlas
            over the five to clear the leg.
          </p>
          <p className="mt-6 font-sign text-3xl font-bold" data-testid="blitz-progress">
            {done ? (
              <span className="text-gold">
                Blitz lap complete: you&apos;ve beaten Atlas against the clock on all {route.length}{" "}
                continents.
              </span>
            ) : (
              <>
                <span className="tabular text-gold">{cleared}</span> of {route.length} continents
                cleared against the clock
              </>
            )}
          </p>
          <div
            className="mt-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-graticule/60"
            role="progressbar"
            aria-label="Continents cleared on the Blitz lap"
            aria-valuemin={0}
            aria-valuemax={route.length}
            aria-valuenow={cleared}
          >
            <div
              className="h-full rounded-full bg-sonar transition-[width]"
              style={{ width: route.length ? `${(cleared / route.length) * 100}%` : 0 }}
            />
          </div>
          <Legs legs={legs} record={record} lap="blitz" />
        </>
      )}
    </section>
  );
}
