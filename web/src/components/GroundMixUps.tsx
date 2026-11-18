"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  BEST_GROUND_MIX_UPS_KEY,
  canPractiseGround,
  coversInWords,
  groundMisreadLine,
  groundMisreads,
  loadAllGroundCalls,
  practiceCovers,
  type GroundCall,
} from "@/lib/game/groundMixUps";
import { GROUND_NAME, GROUND_PHOTOS, loadBestGround } from "@/lib/game/onTheGround";
import type { GroundCover } from "@/lib/trueClues";

interface Props {
  /** How many photos What's on the ground? can deal in each cover, to offer a game only when it can. */
  counts: Readonly<Partial<Record<GroundCover, number>>>;
}

/**
 * Your ground mix-ups: the land covers you've misread most in What's on the ground? (free games
 * and today's), each with how often and what you called it instead, and a practice game dealt
 * from them (`lib/game/groundMixUps.ts`) with its own best. Read after mount, so the static page
 * never guesses at it; shows nothing until a cover has been called wrong.
 */
export default function GroundMixUps({ counts }: Props) {
  const [calls, setCalls] = useState<GroundCall[] | null>(null);
  const [best, setBest] = useState(0);

  useEffect(() => {
    // Storage only exists in the browser, so the calls are read once the page is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCalls(loadAllGroundCalls());
    setBest(loadBestGround(BEST_GROUND_MIX_UPS_KEY));
  }, []);

  if (!calls) return null;
  const misreads = groundMisreads(calls);
  if (misreads.length === 0) return null;
  const practice = practiceCovers(misreads);

  return (
    <div className="mt-6 max-w-2xl" data-testid="ground-mix-ups">
      <h3 id="ground-mix-ups-heading" className="font-sign text-2xl font-extrabold">
        Ground you misread
      </h3>
      <p className="mt-1 text-sm text-chalk-dim">
        {`From your last ${calls.length.toLocaleString("en-US")} ${calls.length === 1 ? "call" : "calls"} in What's on the ground?, free games and today's.`}
      </p>
      {canPractiseGround(counts, practice) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href="/on-the-ground/mix-ups"
            className="rounded-full bg-gold px-5 py-2.5 font-semibold text-ocean-deep transition hover:brightness-110"
          >
            Practise these covers
          </Link>
          <p className="text-sm text-chalk-dim" data-testid="ground-mix-ups-note">
            {`Five photos, ${coversInWords(practice)}, dealt evenly.`}
            {best > 0 && ` Your best: ${best} of ${GROUND_PHOTOS}.`}
          </p>
        </div>
      )}
      <ol className="mt-3 grid gap-3" aria-labelledby="ground-mix-ups-heading">
        {misreads.map((m) => (
          <li
            key={m.cover}
            className="rounded-2xl border border-graticule px-4 py-3"
            data-testid="ground-misread"
            data-cover={m.cover}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="font-semibold">{GROUND_NAME[m.cover]}</span>
              <span className="font-sign text-2xl font-extrabold">
                {`${m.missed} of ${m.photos}`}
              </span>
            </div>
            <p className="mt-1 text-sm text-chalk-dim">{groundMisreadLine(m)}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
