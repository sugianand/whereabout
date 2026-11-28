"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  ODDS,
  hedgeOddsLeader,
  hedgeOddsLine,
  hitRate,
  loadHedgeOdds,
  oddsBandText,
  saidRate,
  type HedgeOdds as Odds,
  type OddsBand,
} from "@/lib/game/hedgeOdds";

const LEADER_TEXT = {
  you: "You read the odds closer than Atlas's own probabilities.",
  atlas: "Atlas's probabilities read the odds closer than you so far.",
  level: "You and Atlas's probabilities read the odds exactly as closely.",
} as const;

const LINK =
  "rounded-full border border-chalk/30 px-4 py-2 font-semibold transition hover:border-chalk";

/**
 * One side's bar on a band's card: as long as how often its countries there were right, with a
 * tick where its chips said they would be, so a well-read band has the bar end at the tick.
 */
function OddsBar({
  who,
  band,
  label,
  color,
  testId,
}: {
  who: string;
  band: OddsBand;
  label: string;
  color: string;
  testId: string;
}) {
  const hit = hitRate(band);
  const said = saidRate(band);
  const text = oddsBandText(band);
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5"
      data-testid={testId}
      data-bets={band.bets}
      data-right={band.right}
      data-chips={band.chips}
    >
      <span className="text-sm font-semibold">{who}</span>
      <span className="text-right text-xs text-chalk-dim">{text}</span>
      <div
        className="relative col-span-2 h-2.5 overflow-hidden rounded-full bg-ocean-deep"
        role="meter"
        aria-label={`${who}: how often a country with ${label} was right`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={hit ?? 0}
        aria-valuetext={text}
      >
        <div className={`h-full rounded-full ${color}`} style={{ width: `${hit ?? 0}%` }} />
        {said !== null && (
          <div
            className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-chalk"
            style={{ left: `${said}%` }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

/**
 * Your odds on Your map: over every Hedge your bets photo played in this browser, how often a
 * country turned out right given the chips you put on it, beside Atlas's own chips on the same
 * photos (`lib/game/hedgeOdds.ts`). Read after mount, so the static page never guesses at it;
 * nothing shows until a bet has been placed.
 */
export default function HedgeOdds() {
  const [odds, setOdds] = useState<Odds | null>(null);

  useEffect(() => {
    // Storage only exists in the browser, so the counts are read once the page is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOdds(loadHedgeOdds());
  }, []);

  if (!odds || odds.photos === 0) return null;
  const leader = hedgeOddsLeader(odds);

  return (
    <section className="mt-12" aria-labelledby="hedge-odds-heading" data-testid="hedge-odds">
      <h2 id="hedge-odds-heading" className="font-sign text-3xl font-extrabold">
        Your odds
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-chalk-dim">
        In Hedge your bets, chips are odds: three chips on a country says it&apos;s about 30%
        likely. Here is how often the countries you gave each share of chips were really the right
        one, beside Atlas&apos;s own chips on the same photos. A bar that ends at its tick means the
        chips told the truth.
      </p>
      <p className="mt-4 max-w-2xl text-lg font-semibold" data-testid="hedge-odds-line">
        {hedgeOddsLine(odds)}
        {leader && <span className="block text-base font-normal">{LEADER_TEXT[leader]}</span>}
      </p>
      <ol
        className="mt-4 grid max-w-4xl gap-4 md:grid-cols-2 lg:grid-cols-4"
        aria-label="How often a country was right by the chips on it"
      >
        {ODDS.map((b, i) => (
          <li
            key={b.key}
            className="rounded-2xl border border-graticule p-4"
            data-testid={`hedge-odds-${b.key}`}
          >
            <h3 className="font-sign text-xl font-extrabold">
              {b.name}{" "}
              <span className="font-sans text-sm font-normal text-chalk-dim">{b.label}</span>
            </h3>
            <div className="mt-2 space-y-2">
              <OddsBar
                who="You"
                band={odds.you[i]!}
                label={b.label}
                color="bg-flare"
                testId={`hedge-odds-${b.key}-you`}
              />
              <OddsBar
                who="Atlas"
                band={odds.atlas[i]!}
                label={b.label}
                color="bg-sonar"
                testId={`hedge-odds-${b.key}-atlas`}
              />
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link href="/hedge" className={LINK}>
          Play Hedge your bets
        </Link>
        <Link href="/hedge/daily" className={LINK}>
          Today&apos;s Hedge your bets
        </Link>
      </div>
    </section>
  );
}
