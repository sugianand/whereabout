"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  BEST_CLIMATE_MIX_UPS_KEY,
  canPractise,
  climateMisreads,
  groupsInWords,
  loadAllClimateCalls,
  misreadLine,
  practiceGroups,
  type ClimateCall,
} from "@/lib/game/climateMixUps";
import { CLIMATE_PHOTOS, loadBestClimate } from "@/lib/game/whichClimate";
import type { ClimateGroup } from "@/lib/trueClues";

interface Props {
  /** How many photos Which climate? can deal in each climate, to offer a game only when it can. */
  counts: Readonly<Partial<Record<ClimateGroup, number>>>;
}

/**
 * Your climate mix-ups: the climates you've misread most in Which climate? (free games and
 * today's), each with how often and what you called it instead, and a practice game dealt from
 * them (`lib/game/climateMixUps.ts`) with its own best. Read after mount, so the static page
 * never guesses at it; shows nothing until a climate has been called wrong.
 */
export default function ClimateMixUps({ counts }: Props) {
  const [calls, setCalls] = useState<ClimateCall[] | null>(null);
  const [best, setBest] = useState(0);

  useEffect(() => {
    // Storage only exists in the browser, so the calls are read once the page is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCalls(loadAllClimateCalls());
    setBest(loadBestClimate(BEST_CLIMATE_MIX_UPS_KEY));
  }, []);

  if (!calls) return null;
  const misreads = climateMisreads(calls);
  if (misreads.length === 0) return null;
  const practice = practiceGroups(misreads);

  return (
    <div className="mt-6 max-w-2xl" data-testid="climate-mix-ups">
      <h3 id="climate-mix-ups-heading" className="font-sign text-2xl font-extrabold">
        Climates you misread
      </h3>
      <p className="mt-1 text-sm text-chalk-dim">
        {`From your last ${calls.length.toLocaleString("en-US")} ${calls.length === 1 ? "call" : "calls"} in Which climate?, free games and today's.`}
      </p>
      {canPractise(counts, practice) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link
            href="/which-climate/mix-ups"
            className="rounded-full bg-gold px-5 py-2.5 font-semibold text-ocean-deep transition hover:brightness-110"
          >
            Practise these climates
          </Link>
          <p className="text-sm text-chalk-dim" data-testid="climate-mix-ups-note">
            {`Five photos, ${groupsInWords(practice)}, dealt evenly.`}
            {best > 0 && ` Your best: ${best} of ${CLIMATE_PHOTOS}.`}
          </p>
        </div>
      )}
      <ol className="mt-3 grid gap-3" aria-labelledby="climate-mix-ups-heading">
        {misreads.map((m) => (
          <li
            key={m.group}
            className="rounded-2xl border border-graticule px-4 py-3"
            data-testid="climate-misread"
            data-group={m.group}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="font-semibold">{m.group}</span>
              <span className="font-sign text-2xl font-extrabold">
                {`${m.missed} of ${m.photos}`}
              </span>
            </div>
            <p className="mt-1 text-sm text-chalk-dim">{misreadLine(m)}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
