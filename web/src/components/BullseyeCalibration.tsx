"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { RINGS } from "@/lib/game/bullseye";
import {
  calibrationLeader,
  calibrationLine,
  heldRate,
  loadCalibration,
  totals,
  type Calibration,
  type RingTally,
} from "@/lib/game/bullseyeCalibration";
import { formatDistance, formatPoints } from "@/lib/geo";
import { useUnits } from "@/lib/useUnits";

const LEADER_TEXT = {
  you: "You hold your rings more often than Atlas.",
  atlas: "Atlas holds its rings more often than you.",
  level: "You and Atlas hold your rings exactly as often.",
} as const;

const LINK =
  "rounded-full border border-chalk/30 px-4 py-2 font-semibold transition hover:border-chalk";

function heldText(t: RingTally): string {
  if (t.bet === 0) return "Not bet yet";
  return `${t.held} of ${t.bet} held · ${Math.round(heldRate(t)! * 100)}%`;
}

/** One side's bar on a ring's row: as long as the share of its bets that held. */
function HeldBar({
  who,
  tally,
  ring,
  color,
  testId,
}: {
  who: string;
  tally: RingTally;
  ring: string;
  color: string;
  testId: string;
}) {
  const rate = heldRate(tally);
  const value = rate === null ? 0 : Math.round(rate * 100);
  return (
    <div
      className="grid grid-cols-[3.5rem_1fr] items-center gap-x-3 gap-y-0.5"
      data-testid={testId}
      data-bet={tally.bet}
      data-held={tally.held}
    >
      <span className="text-sm font-semibold">{who}</span>
      <span className="text-right text-xs text-chalk-dim">{heldText(tally)}</span>
      <div
        className="col-span-2 h-2.5 overflow-hidden rounded-full bg-ocean-deep"
        role="meter"
        aria-label={`${who}: ${ring} held`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={heldText(tally)}
      >
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

/**
 * Your calibration on Your map: for each Bullseye ring, how often it held the photos you bet it
 * on, beside how often Atlas's same ring held, over every free game, challenge and today's game
 * played in this browser (`lib/game/bullseyeCalibration.ts`). A ring that rarely holds is being
 * bet too boldly. Read after mount, so the static page never guesses at it; nothing shows until
 * a photo has been bet on.
 */
export default function BullseyeCalibration() {
  const [cal, setCal] = useState<Calibration | null>(null);
  const units = useUnits();

  useEffect(() => {
    // Storage only exists in the browser, so the tallies are read once the page is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCal(loadCalibration());
  }, []);

  if (!cal || totals(cal.you).bet === 0) return null;
  const leader = calibrationLeader(cal);

  return (
    <section className="mt-12" aria-labelledby="calibration-heading" data-testid="calibration">
      <h2 id="calibration-heading" className="font-sign text-3xl font-extrabold">
        Your calibration
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-chalk-dim">
        How often each Bullseye ring held the photo you bet it on, in free games, challenges and
        today&apos;s, beside how often Atlas&apos;s did. A tight ring that rarely holds is a bet
        made too boldly; a wide one that always holds could have been tighter.
      </p>
      <p className="mt-4 max-w-2xl text-lg font-semibold" data-testid="calibration-line">
        {calibrationLine(cal)}
        {leader && <span className="block text-base font-normal">{LEADER_TEXT[leader]}</span>}
      </p>
      <ol
        className="mt-4 grid max-w-3xl gap-4 sm:grid-cols-2"
        aria-label="Rings held against rings bet"
      >
        {RINGS.map((r, i) => {
          const ring = `the ${formatDistance(r.km, units)} ring`;
          return (
            <li
              key={r.km}
              className="rounded-2xl border border-graticule p-4"
              data-testid={`calibration-ring-${i}`}
            >
              <h3 className="font-sign text-xl font-extrabold">
                {formatDistance(r.km, units)} ring{" "}
                <span className="font-sans text-sm font-normal text-chalk-dim">
                  {formatPoints(r.points)} points
                </span>
              </h3>
              <div className="mt-2 space-y-2">
                <HeldBar
                  who="You"
                  tally={cal.you[i]!}
                  ring={ring}
                  color="bg-flare"
                  testId={`calibration-ring-${i}-you`}
                />
                <HeldBar
                  who="Atlas"
                  tally={cal.atlas[i]!}
                  ring={ring}
                  color="bg-sonar"
                  testId={`calibration-ring-${i}-atlas`}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link href="/bullseye" className={LINK}>
          Play Bullseye
        </Link>
        <Link href="/bullseye/daily" className={LINK}>
          Today&apos;s Bullseye
        </Link>
      </div>
    </section>
  );
}
