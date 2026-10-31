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
  /**
   * Where Blitz opens when this screen can't start one itself (`/?blitz` from another mode's
   * page); `onPlayBlitz` wins when both are given.
   */
  blitzHref?: string;
  /** The mode being played on this screen: its card says so and isn't a link to itself. */
  current?: QuickMode;
  /**
   * Called when Blitz's button is picked, so a menu holding the cards can close; a link card
   * leaves the page instead, which closes it.
   */
  onPicked?: () => void;
  /** Tighter cards with the heading left to the caller, for the Games menu. */
  compact?: boolean;
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
const COMPACT_CARD =
  "block w-full rounded-xl border border-flare/40 px-4 py-3 text-left transition hover:border-flare hover:bg-flare/5";
const CURRENT_CARD =
  "block w-full rounded-xl border border-chalk/30 bg-chalk/5 px-4 py-3 text-left";

function CardBody({
  mode,
  best,
  compact = false,
  current = false,
}: {
  mode: QuickMode;
  best: string | null;
  compact?: boolean;
  current?: boolean;
}) {
  const { name, blurb } = BLURBS[mode];
  return (
    <>
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span
          className={`font-sign font-bold ${compact ? "text-xl" : "text-2xl"} ${current ? "text-chalk" : "text-flare"}`}
        >
          {name}
          {current && (
            <span className="ml-2 align-middle font-sans text-xs font-semibold text-chalk-dim">
              Playing now
            </span>
          )}
        </span>
        <span
          data-testid={`best-${mode}`}
          className={`tabular text-sm ${best ? "font-semibold text-gold" : "text-chalk-dim"}`}
        >
          {best ?? "No best yet"}
        </span>
      </span>
      <span className={`mt-1 block text-chalk-dim ${compact ? "text-sm" : ""}`}>{blurb}</span>
    </>
  );
}

/**
 * The quick modes, each with its best kept in this browser beside its name, so a player sees
 * what to beat before opening one (src/lib/game/quickBests.ts). The bests are read after
 * hydration: the static page is built with none, and storage only exists in the browser.
 */
export default function QuickGames({
  onPlayBlitz,
  streakHref,
  blitzBest,
  blitzHref,
  current,
  onPicked,
  compact = false,
}: QuickGamesProps) {
  const [bests, setBests] = useState<QuickBests>(NO_BESTS);
  useEffect(() => {
    const id = requestAnimationFrame(() => setBests(loadQuickBests()));
    return () => cancelAnimationFrame(id);
  }, []);
  const shown = blitzBest === undefined ? bests : { ...bests, blitz: blitzBest };
  const cardClass = compact ? COMPACT_CARD : CARD;

  // Each mode's card: the one being played reads "Playing now" and goes nowhere; the others
  // are a link, or Blitz's button, which also tells a holding menu to close.
  const card = (mode: QuickMode, href: string | undefined, onClick?: () => void) => {
    const body = (
      <CardBody
        mode={mode}
        best={bestLine(mode, shown)}
        compact={compact}
        current={mode === current}
      />
    );
    if (mode === current) {
      return (
        <div className={CURRENT_CARD} aria-current="page">
          {body}
        </div>
      );
    }
    if (onClick) {
      return (
        <button
          type="button"
          onClick={() => {
            onPicked?.();
            onClick();
          }}
          className={cardClass}
        >
          {body}
        </button>
      );
    }
    return (
      <Link href={href!} className={cardClass}>
        {body}
      </Link>
    );
  };

  const offerBlitz = current === "blitz" || !!onPlayBlitz || !!blitzHref;
  const offerStreak = current === "streak" || !!streakHref;
  const list = (
    <ul className={compact ? "space-y-2" : "mt-3 space-y-4"}>
      {offerBlitz && <li>{card("blitz", blitzHref, onPlayBlitz)}</li>}
      {offerStreak && <li>{card("streak", streakHref)}</li>}
      {(["survival", "further-north", "odd-one-out"] as const).map((mode) => (
        <li key={mode}>{card(mode, `/${mode}`)}</li>
      ))}
    </ul>
  );

  if (compact) return list;
  return (
    <section aria-labelledby="quick-games" className="mt-10">
      <h2 id="quick-games" className="font-sign text-xl font-bold">
        Quick games
      </h2>
      {list}
    </section>
  );
}
