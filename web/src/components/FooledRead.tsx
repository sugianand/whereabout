"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  GAPS,
  fooledReadLeader,
  fooledReadLine,
  fooledReadTotals,
  loadFooledRead,
  tiesLine,
  type FooledRead as Read,
} from "@/lib/game/fooledRead";

const LEADER_TEXT = {
  you: "You read Atlas's misses better than its own sureness does.",
  atlas: "Atlas's own sureness reads its misses better than you so far.",
  level: "You and Atlas's own sureness have picked exactly as many right.",
} as const;

const LINK =
  "rounded-full border border-chalk/30 px-4 py-2 font-semibold transition hover:border-chalk";

/** One side's bar on a band's card: as long as the share of the band's pairs it picked right. */
function RightBar({
  who,
  correct,
  pairs,
  band,
  color,
  testId,
}: {
  who: string;
  correct: number;
  pairs: number;
  band: string;
  color: string;
  testId: string;
}) {
  const value = pairs === 0 ? 0 : Math.round((correct / pairs) * 100);
  const text = pairs === 0 ? "Not picked yet" : `${correct} of ${pairs} right · ${value}%`;
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5"
      data-testid={testId}
      data-correct={correct}
      data-pairs={pairs}
    >
      <span className="text-sm font-semibold">{who}</span>
      <span className="text-right text-xs text-chalk-dim">{text}</span>
      <div
        className="col-span-2 h-2.5 overflow-hidden rounded-full bg-ocean-deep"
        role="meter"
        aria-label={`${who}: pairs right with ${band}`}
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
 * What fools Atlas on Your map: over every Which fooled Atlas? pair picked in this browser, how
 * often you picked the photo Atlas missed by more, by how far apart the two misses were, beside
 * Atlas's own pick of the photo it was less sure of (`lib/game/fooledRead.ts`). Read after
 * mount, so the static page never guesses at it; nothing shows until a pair has been picked.
 */
export default function FooledRead() {
  const [read, setRead] = useState<Read | null>(null);

  useEffect(() => {
    // Storage only exists in the browser, so the counts are read once the page is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRead(loadFooledRead());
  }, []);

  if (!read || (fooledReadTotals(read).pairs === 0 && read.ties === 0)) return null;
  const leader = fooledReadLeader(read);
  const ties = tiesLine(read.ties);

  return (
    <section className="mt-12" aria-labelledby="fooled-read-heading" data-testid="fooled-read">
      <h2 id="fooled-read-heading" className="font-sign text-3xl font-extrabold">
        What fools Atlas
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-chalk-dim">
        How often you picked the photo Atlas missed by more in Which fooled Atlas?, by how far apart
        its two misses were. Beside you, Atlas&apos;s own sureness: it picks the photo it was less
        sure of.
      </p>
      <p className="mt-4 max-w-2xl text-lg font-semibold" data-testid="fooled-read-line">
        {fooledReadLine(read)}
        {leader && <span className="block text-base font-normal">{LEADER_TEXT[leader]}</span>}
      </p>
      {ties && (
        <p className="mt-1 text-sm text-chalk-dim" data-testid="fooled-read-ties">
          {ties}
        </p>
      )}
      <ol
        className="mt-4 grid max-w-4xl gap-4 md:grid-cols-3"
        aria-label="Pairs right by how far apart Atlas's misses were"
      >
        {GAPS.map((g, i) => {
          const t = read.bands[i]!;
          return (
            <li
              key={g.key}
              className="rounded-2xl border border-graticule p-4"
              data-testid={`fooled-read-${g.key}`}
              data-pairs={t.pairs}
            >
              <h3 className="font-sign text-xl font-extrabold">
                {g.name}{" "}
                <span className="font-sans text-sm font-normal text-chalk-dim">{g.label}</span>
              </h3>
              <p className="mt-1 text-sm text-chalk-dim">
                {t.pairs === 0
                  ? "No pairs this far apart yet."
                  : `${t.pairs} ${t.pairs === 1 ? "pair" : "pairs"} picked.`}
              </p>
              <div className="mt-2 space-y-2">
                <RightBar
                  who="You"
                  correct={t.you}
                  pairs={t.pairs}
                  band={g.label}
                  color="bg-flare"
                  testId={`fooled-read-${g.key}-you`}
                />
                <RightBar
                  who="Atlas's sureness"
                  correct={t.atlas}
                  pairs={t.pairs}
                  band={g.label}
                  color="bg-sonar"
                  testId={`fooled-read-${g.key}-atlas`}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link href="/fooled-atlas" className={LINK}>
          Play Which fooled Atlas?
        </Link>
        <Link href="/fooled-atlas/daily" className={LINK}>
          Today&apos;s Which fooled Atlas?
        </Link>
      </div>
    </section>
  );
}
