"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { countryName } from "@/lib/countries";
import type { Continent } from "@/lib/continents";
import { loadBestName } from "@/lib/game/nameCountry";
import { BEST_MIX_UPS_KEY, MIN_PRACTICE_PHOTOS, practiceSize } from "@/lib/game/nameMixUps";
import { regionSlug } from "@/lib/game/regions";
import {
  loadMixUps,
  mixUpLine,
  mixUpPairs,
  practiceContinent,
  timesWord,
  type MixUp,
} from "@/lib/mixUps";

interface Props {
  /** The continents Country Streak can deal a run from, for the practice links. */
  streakable: readonly Continent[];
  /**
   * How many photos Name the country can deal in each country, so the list offers a practice
   * run only when it would deal enough of them.
   */
  photoCounts: Readonly<Record<string, number>>;
}

/**
 * Countries you mix up: the pairs of countries a player has taken for each other most often in
 * Name the country, Close-up and Country Streak (`lib/mixUps.ts`), each with how often, which way
 * round, and a Country Streak on the continent to practise them. Above the list, a Name the
 * country run dealt from these countries (`lib/game/nameMixUps.ts`), with its own best. Read after
 * mount, so the static page never guesses at it; shows nothing until a wrong country has been
 * tapped.
 */
export default function MixUps({ streakable, photoCounts }: Props) {
  const [log, setLog] = useState<MixUp[] | null>(null);
  const [best, setBest] = useState(0);

  useEffect(() => {
    // Storage only exists in the browser, so the log is read once the page is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLog(loadMixUps());
    setBest(loadBestName(BEST_MIX_UPS_KEY));
  }, []);

  if (!log || log.length === 0) return null;
  const pairs = mixUpPairs(log);
  const practicePhotos = practiceSize(log, photoCounts);

  return (
    <section className="mt-12" aria-labelledby="mix-ups-heading">
      <h2 id="mix-ups-heading" className="font-sign text-3xl font-extrabold">
        Countries you mix up
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-chalk-dim">
        The countries you&apos;ve most often taken for each other in Name the country, Close-up and
        Country Streak, from your last {log.length.toLocaleString("en-US")} wrong{" "}
        {log.length === 1 ? "answer" : "answers"}.
      </p>
      {practicePhotos >= MIN_PRACTICE_PHOTOS && (
        <div className="mt-4 flex max-w-2xl flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href="/name-country/mix-ups"
            className="rounded-full bg-gold px-5 py-2.5 font-semibold text-ocean-deep transition hover:brightness-110"
          >
            Practise your mix-ups
          </Link>
          <p className="text-sm text-chalk-dim" data-testid="mix-ups-practice-note">
            {`Name the country with ${practicePhotos.toLocaleString("en-US")} photos from these countries, the one you took each for among the four.`}
            {best > 0 && ` Your best: ${best} in a row.`}
          </p>
        </div>
      )}
      <ol className="mt-4 grid max-w-2xl gap-3" aria-label="Countries you mix up">
        {pairs.map((p) => {
          const continent = practiceContinent(p, streakable);
          return (
            <li
              key={`${p.a}-${p.b}`}
              className="rounded-2xl border border-graticule px-4 py-3"
              data-testid="mix-up"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="min-w-0 font-semibold">
                  {countryName(p.a)} and {countryName(p.b)}
                </h3>
                <span className="font-sign text-2xl font-extrabold" data-testid="mix-up-times">
                  {timesWord(p.times)}
                </span>
              </div>
              <p className="mt-1 text-sm text-chalk-dim">{mixUpLine(p)}</p>
              {continent && (
                <Link
                  href={`/streak?region=${regionSlug(continent)}`}
                  className="mt-2 inline-block rounded-full border border-gold/60 px-3 py-1.5 text-sm font-semibold text-gold transition hover:border-gold"
                >
                  Country Streak in {continent}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
