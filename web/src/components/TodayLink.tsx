"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { runToday } from "@/lib/game/dailyRuns";
import { TODAY_GAMES, gamesDone, todayGames } from "@/lib/game/today";

/**
 * The way to Today, on the results screen and in the Games menu, saying how many of the day's
 * games are finished. No photo ids here: a Daily Five in progress counts as not finished either
 * way, so the count needs none. Read after mount, so the static page never guesses at it.
 */
export default function TodayLink({
  compact = false,
  current = false,
}: {
  compact?: boolean;
  /** On Today itself: the card says so and isn't a link. */
  current?: boolean;
}) {
  const [done, setDone] = useState<number | null>(null);

  useEffect(() => {
    // Storage only exists in the browser, so the count is read once the page is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDone(gamesDone(todayGames(runToday(), [])));
  }, []);

  const total = TODAY_GAMES.length;
  const line = done === null || done === 0 ? `${total} daily games` : `${done} of ${total} played`;
  const box = compact ? "mt-4 rounded-xl px-4 py-3" : "mt-4 rounded-2xl p-5";
  const title = `block font-sign font-bold ${compact ? "text-xl" : "text-2xl"}`;
  const body = (
    <>
      <span className={`${title} ${current ? "text-chalk" : "text-gold"}`}>
        Today
        {current && (
          <span className="ml-2 align-middle font-sans text-xs font-semibold text-chalk-dim">
            You&apos;re here
          </span>
        )}
      </span>
      <span className={`mt-1 block text-chalk-dim ${compact ? "text-sm" : ""}`}>
        {line}: everyone gets the same deal, and one line shares your whole day.
      </span>
    </>
  );

  if (current) {
    return (
      <div aria-current="page" className={`${box} block border border-chalk/30 bg-chalk/5`}>
        {body}
      </div>
    );
  }
  return (
    <Link
      href="/today"
      className={`${box} block border border-gold/40 transition hover:border-gold hover:bg-gold/5`}
    >
      {body}
    </Link>
  );
}
