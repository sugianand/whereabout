"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  NO_BESTS,
  bestLine,
  loadQuickBests,
  type QuickBests,
  type QuickMode,
} from "@/lib/game/quickBests";

type QuickGamesProps = {
  /** Start a Blitz game; omitted (the API backend plays untimed), Blitz isn't offered. */
  onPlayBlitz?: () => void;
  /** Where Country Streak opens; omitted when the deck has no photos it can deal. */
  streakHref?: string;
  /** The best Blitz just set or kept, when the game on the summary was a Blitz. */
  blitzBest?: number;
};

const BLURBS: Record<QuickMode, { name: string; blurb: string }> = {
  blitz: {
    name: "Blitz",
    blurb: "Five photos, 30 seconds each: your pin goes in when time runs out.",
  },
  streak: {
    name: "Country Streak",
    blurb: "Name the country each photo was taken in, one after another, until your first miss.",
  },
  survival: {
    name: "Survival",
    blurb:
      "One photo after another until your misses empty a 5,000-point health bar. A pin within 25 km heals.",
  },
  "further-north": {
    name: "Further North",
    blurb:
      "Two photos, one question: which was taken further north? Call pairs until your first miss, and see if Atlas would have got them.",
  },
  "odd-one-out": {
    name: "Odd one out",
    blurb:
      "Four photos, three from one continent: tap the one from somewhere else, until your first miss.",
  },
};

const CARD =
  "block w-full rounded-2xl border border-flare/40 p-5 text-left transition hover:border-flare hover:bg-flare/5";

function CardBody({ mode, best }: { mode: QuickMode; best: string | null }) {
  const { name, blurb } = BLURBS[mode];
  return (
    <>
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="font-sign text-2xl font-bold text-flare">{name}</span>
        <span
          data-testid={`best-${mode}`}
          className={`tabular text-sm ${best ? "font-semibold text-gold" : "text-chalk-dim"}`}
        >
          {best ?? "No best yet"}
        </span>
      </span>
      <span className="mt-1 block text-chalk-dim">{blurb}</span>
    </>
  );
}

/**
 * The quick modes, each with its best kept in this browser beside its name, so a player sees
 * what to beat before opening one (src/lib/game/quickBests.ts). The bests are read after
 * hydration: the static page is built with none, and storage only exists in the browser.
 */
export default function QuickGames({ onPlayBlitz, streakHref, blitzBest }: QuickGamesProps) {
  const [bests, setBests] = useState<QuickBests>(NO_BESTS);
  useEffect(() => {
    const id = requestAnimationFrame(() => setBests(loadQuickBests()));
    return () => cancelAnimationFrame(id);
  }, []);
  const shown = blitzBest === undefined ? bests : { ...bests, blitz: blitzBest };
  const line = (mode: QuickMode) => bestLine(mode, shown);

  return (
    <section aria-labelledby="quick-games" className="mt-10">
      <h2 id="quick-games" className="font-sign text-xl font-bold">
        Quick games
      </h2>
      <ul className="mt-3 space-y-4">
        {onPlayBlitz && (
          <li>
            <button type="button" onClick={onPlayBlitz} className={CARD}>
              <CardBody mode="blitz" best={line("blitz")} />
            </button>
          </li>
        )}
        {streakHref && (
          <li>
            <Link href={streakHref} className={CARD}>
              <CardBody mode="streak" best={line("streak")} />
            </Link>
          </li>
        )}
        {(["survival", "further-north", "odd-one-out"] as const).map((mode) => (
          <li key={mode}>
            <Link href={`/${mode}`} className={CARD}>
              <CardBody mode={mode} best={line(mode)} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
