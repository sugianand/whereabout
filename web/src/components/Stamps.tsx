"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { Continent } from "@/lib/continents";
import { runToday } from "@/lib/game/dailyRuns";
import { dayTallies } from "@/lib/game/today";
import { loadPlayed } from "@/lib/playedMap";
import { loadRecord } from "@/lib/playerRecord";
import {
  STAMP_GROUPS,
  keepStamps,
  loadBullseyeSources,
  loadClueSources,
  nextStamp,
  readStamps,
  toGo,
  type Stamp,
  type StampId,
} from "@/lib/stamps";
import { loadTour } from "@/lib/tour";
import { useUnits } from "@/lib/useUnits";

import GamesMenu from "./GamesMenu";

const systemNow = () => new Date();

function progressWords(stamp: Stamp): string | null {
  const p = stamp.progress;
  if (!p) return null;
  const [one, many] = p.unit;
  return `${Math.min(p.have, p.need)} of ${p.need} ${p.need === 1 ? one : many}`;
}

function StampCard({ stamp, fresh }: { stamp: Stamp; fresh: boolean }) {
  const p = stamp.progress;
  const words = stamp.earned ? null : progressWords(stamp);
  return (
    <li
      data-testid={`stamp-${stamp.id}`}
      data-earned={stamp.earned}
      className={`flex min-w-0 gap-3 rounded-2xl border p-4 ${
        stamp.earned ? "border-gold/60 bg-gold/5" : "border-graticule"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex size-14 shrink-0 items-center justify-center rounded-xl border-2 border-dashed text-3xl ${
          stamp.earned ? "border-gold bg-ocean-deep" : "border-chalk/20 opacity-40 grayscale"
        }`}
      >
        {stamp.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-sign text-xl font-bold">{stamp.name}</span>
          {fresh && (
            <span className="rounded-full bg-flare px-2 text-xs font-semibold text-ocean-deep">
              New
            </span>
          )}
        </span>
        <span className="block text-sm text-chalk-dim">{stamp.how}.</span>
        <span className="sr-only">{stamp.earned ? "Collected." : "Not collected yet."}</span>
        {words && p && (
          <span className="mt-2 block">
            <span
              role="progressbar"
              aria-label={`${stamp.name}: ${words}`}
              aria-valuemin={0}
              aria-valuemax={p.need}
              aria-valuenow={Math.min(p.have, p.need)}
              className="block h-1.5 overflow-hidden rounded-full bg-chalk/10"
            >
              <span
                className="block h-full rounded-full bg-sonar"
                style={{ width: `${(100 * Math.min(p.have, p.need)) / p.need}%` }}
              />
            </span>
            <span className="tabular mt-1 block text-sm" data-testid={`stamp-${stamp.id}-progress`}>
              {words}
            </span>
          </span>
        )}
        {!stamp.earned && stamp.note && (
          <span className="mt-1 block text-sm text-gold">{stamp.note}</span>
        )}
      </span>
    </li>
  );
}

/**
 * Stamps: every stamp there is, collected or not, each with how it is earned and how far along
 * it is (`lib/stamps.ts`). Read after mount, since everything it shows lives in this browser, and
 * a stamp seen earned for the first time is kept and marked new.
 */
export default function Stamps({
  countries,
  deckIds,
  album,
  tourRoute,
  now = systemNow,
}: {
  /** The countries the game deals photos from, by continent. */
  countries: Partial<Record<Continent, readonly string[]>>;
  deckIds: readonly string[];
  /** Each photo the album holds, with its continent; no album stamps without it. */
  album?: Readonly<Record<string, Continent>>;
  /** The World Tour's legs in route order; no tour stamps without it. */
  tourRoute?: readonly Continent[];
  now?: () => Date;
}) {
  const units = useUnits();
  const [view, setView] = useState<{ stamps: Stamp[]; fresh: StampId[] } | null>(null);

  useEffect(() => {
    // Storage only exists in the browser, so the stamps are read once the page is mounted.
    const at = now();
    const today = runToday(at);
    const stamps = readStamps({
      record: loadRecord(),
      played: loadPlayed(),
      tallies: dayTallies(today, deckIds, at),
      countries,
      now: at,
      units,
      clues: loadClueSources(),
      album,
      tour: tourRoute ? { route: tourRoute, record: loadTour() } : undefined,
      bullseye: loadBullseyeSources(),
    });
    const { stamps: collected, fresh } = keepStamps(stamps, today);
    // Units change only the closest pin's words, so a new stamp stays new across a switch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView((was) => ({ stamps: collected, fresh: was ? was.fresh : fresh }));
  }, [countries, deckIds, album, tourRoute, now, units]);

  const earned = view?.stamps.filter((s) => s.earned).length ?? 0;
  const next = view ? nextStamp(view.stamps) : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="font-sign text-3xl font-extrabold tracking-tight">
          Whereabout
        </Link>
        <GamesMenu screen="stamps" streakHref="/streak" />
      </div>
      <h1 className="mt-8 font-sign text-6xl font-extrabold leading-none tracking-tight">Stamps</h1>
      <p className="mt-3 min-h-7 text-lg" role="status" data-testid="stamps-standing">
        {view ? `${earned} of ${view.stamps.length} collected.` : ""}
        {view && view.fresh.length > 0 && (
          <span className="text-flare">
            {" "}
            {view.fresh.length === 1 ? "1 new stamp" : `${view.fresh.length} new stamps`} since you
            last looked.
          </span>
        )}
      </p>
      {next?.progress && (
        <p className="mt-1 text-chalk-dim" data-testid="stamps-next">
          Next up: <span className="font-semibold text-chalk">{next.name}</span>,{" "}
          {toGo(next.progress)}.
        </p>
      )}

      {view &&
        STAMP_GROUPS.map((group) => {
          const stamps = view.stamps.filter((s) => s.group === group.id);
          if (stamps.length === 0) return null;
          return (
            <section key={group.id} aria-labelledby={`stamps-${group.id}`} className="mt-8">
              <h2 id={`stamps-${group.id}`} className="font-sign text-2xl font-bold">
                {group.title}
              </h2>
              {group.id === "atlas" && (
                <p className="mt-1 text-sm text-chalk-dim" data-testid="stamps-atlas-intro">
                  One for each daily game, on a day you beat Atlas on the same photos.{" "}
                  <Link href="/today" className="underline underline-offset-2 hover:text-chalk">
                    Atlas&apos;s day on Today
                  </Link>{" "}
                  shows how today&apos;s games stand.
                </p>
              )}
              {group.id === "clues" && (
                <p className="mt-1 text-sm text-chalk-dim" data-testid="stamps-clues-intro">
                  From{" "}
                  <Link
                    href="/left-right"
                    className="underline underline-offset-2 hover:text-chalk"
                  >
                    Left or right?
                  </Link>
                  ,{" "}
                  <Link
                    href="/which-climate"
                    className="underline underline-offset-2 hover:text-chalk"
                  >
                    Which climate?
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/on-the-ground"
                    className="underline underline-offset-2 hover:text-chalk"
                  >
                    What&apos;s on the ground?
                  </Link>
                  , free games and today&apos;s, and your clue reading on Your map.
                </p>
              )}
              {group.id === "album" && (
                <p className="mt-1 text-sm text-chalk-dim" data-testid="stamps-album-intro">
                  From the photos in{" "}
                  <Link href="/album" className="underline underline-offset-2 hover:text-chalk">
                    your album
                  </Link>
                  .{" "}
                  <Link href="/?find" className="underline underline-offset-2 hover:text-chalk">
                    Find the rest
                  </Link>{" "}
                  deals only photos you haven&apos;t found.
                </p>
              )}
              {group.id === "tour" && (
                <p className="mt-1 text-sm text-chalk-dim" data-testid="stamps-tour-intro">
                  From the{" "}
                  <Link href="/tour" className="underline underline-offset-2 hover:text-chalk">
                    World Tour
                  </Link>
                  : any five-photo game on a continent counts toward its leg.
                </p>
              )}
              {group.id === "bullseye" && (
                <p className="mt-1 text-sm text-chalk-dim" data-testid="stamps-bullseye-intro">
                  From{" "}
                  <Link href="/bullseye" className="underline underline-offset-2 hover:text-chalk">
                    Bullseye
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/bullseye/daily"
                    className="underline underline-offset-2 hover:text-chalk"
                  >
                    today&apos;s Bullseye
                  </Link>
                  . How often your rings hold is{" "}
                  <Link href="/map" className="underline underline-offset-2 hover:text-chalk">
                    your calibration on Your map
                  </Link>
                  .
                </p>
              )}
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {stamps.map((s) => (
                  <StampCard key={s.id} stamp={s} fresh={view.fresh.includes(s.id)} />
                ))}
              </ul>
            </section>
          );
        })}

      <p className="mt-10 text-sm text-chalk-dim">
        Stamps come from what you&apos;ve played in this browser: your record, your map and album,
        the clue games, the World Tour, Bullseye and the days kept on{" "}
        <Link href="/today" className="underline underline-offset-2 hover:text-chalk">
          Today
        </Link>
        . Once collected, a stamp stays. Nothing leaves this browser.
      </p>
    </main>
  );
}
