"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  SURENESS,
  bandDetail,
  loadTrustRead,
  ruleCorrect,
  trustReadLeader,
  trustReadLine,
  trustReadTotals,
  youCorrect,
  type TrustRead as Read,
} from "@/lib/game/trustRead";

const LEADER_TEXT = {
  you: "You read Atlas better than its own sureness does.",
  atlas: "Atlas's own sureness calls its answers better than you so far.",
  level: "You and Atlas's own sureness have called exactly as many right.",
} as const;

const LINK =
  "rounded-full border border-chalk/30 px-4 py-2 font-semibold transition hover:border-chalk";

/** One side's bar on a band's card: as long as the share of the band's calls it got right. */
function RightBar({
  who,
  correct,
  photos,
  band,
  color,
  testId,
}: {
  who: string;
  correct: number;
  photos: number;
  band: string;
  color: string;
  testId: string;
}) {
  const value = photos === 0 ? 0 : Math.round((correct / photos) * 100);
  const text = photos === 0 ? "Not called yet" : `${correct} of ${photos} right · ${value}%`;
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5"
      data-testid={testId}
      data-correct={correct}
      data-photos={photos}
    >
      <span className="text-sm font-semibold">{who}</span>
      <span className="text-right text-xs text-chalk-dim">{text}</span>
      <div
        className="col-span-2 h-2.5 overflow-hidden rounded-full bg-ocean-deep"
        role="meter"
        aria-label={`${who}: calls right when Atlas was ${band}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={text}
      >
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

/**
 * Your trust on Your map: over every Trust Atlas? call made in this browser, how often you called
 * Atlas's answer right at each band of its sureness, beside how its own fixed rule did on the same
 * photos (`lib/game/trustRead.ts`). Read after mount, so the static page never guesses at it;
 * nothing shows until a call has been made.
 */
export default function TrustRead() {
  const [read, setRead] = useState<Read | null>(null);

  useEffect(() => {
    // Storage only exists in the browser, so the counts are read once the page is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRead(loadTrustRead());
  }, []);

  if (!read || trustReadTotals(read).photos === 0) return null;
  const leader = trustReadLeader(read);

  return (
    <section className="mt-12" aria-labelledby="trust-read-heading" data-testid="trust-read">
      <h2 id="trust-read-heading" className="font-sign text-3xl font-extrabold">
        Your trust
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-chalk-dim">
        How often you called Atlas&apos;s answer right in Trust Atlas?, trusting it when its country
        was right and doubting it when it wasn&apos;t, by how sure Atlas said it was. Beside you,
        Atlas&apos;s own rule: it trusts itself from 50% sure.
      </p>
      <p className="mt-4 max-w-2xl text-lg font-semibold" data-testid="trust-read-line">
        {trustReadLine(read)}
        {leader && <span className="block text-base font-normal">{LEADER_TEXT[leader]}</span>}
      </p>
      <ol
        className="mt-4 grid max-w-4xl gap-4 md:grid-cols-3"
        aria-label="Calls right by how sure Atlas was"
      >
        {SURENESS.map((b, i) => {
          const t = read[i]!;
          return (
            <li
              key={b.key}
              className="rounded-2xl border border-graticule p-4"
              data-testid={`trust-read-${b.key}`}
              data-right={t.right}
            >
              <h3 className="font-sign text-xl font-extrabold">
                {b.name}{" "}
                <span className="font-sans text-sm font-normal text-chalk-dim">{b.label}</span>
              </h3>
              <p className="mt-1 text-sm text-chalk-dim">
                {t.photos === 0
                  ? "No photos called at this sureness yet."
                  : `Atlas was right on ${t.right} of ${t.photos}. ${bandDetail(t)}`}
              </p>
              <div className="mt-2 space-y-2">
                <RightBar
                  who="You"
                  correct={youCorrect(t)}
                  photos={t.photos}
                  band={b.label}
                  color="bg-flare"
                  testId={`trust-read-${b.key}-you`}
                />
                <RightBar
                  who="Atlas's rule"
                  correct={ruleCorrect(t, i)}
                  photos={t.photos}
                  band={b.label}
                  color="bg-sonar"
                  testId={`trust-read-${b.key}-atlas`}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link href="/trust-atlas" className={LINK}>
          Play Trust Atlas?
        </Link>
        <Link href="/trust-atlas/daily" className={LINK}>
          Today&apos;s Trust Atlas?
        </Link>
      </div>
    </section>
  );
}
