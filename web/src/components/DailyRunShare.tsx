"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { untilNextRun } from "@/lib/game/dailyRuns";
import { sendShare, type ShareOutcome } from "@/lib/share";

const SHARE_NOTE: Record<ShareOutcome, string> = {
  shared: "Result shared.",
  copied: "Result copied. Paste it anywhere.",
  cancelled: "",
  failed: "Couldn't copy. Your browser blocked the clipboard.",
};

/**
 * Share today's run of a quick game, and the way on to a free run. `shareText` builds the line
 * from the page's address; it is counts only, so it spoils nothing for a friend who hasn't played.
 */
export function ShareDay({
  shareText,
  freeHref,
  focus = false,
}: {
  shareText: (href: string) => string;
  freeHref: string;
  focus?: boolean;
}) {
  const [note, setNote] = useState("");
  const shareRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focus) shareRef.current?.focus({ preventScroll: true });
  }, [focus]);
  async function share() {
    setNote(SHARE_NOTE[await sendShare(shareText(window.location.href), navigator)]);
  }
  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          ref={shareRef}
          type="button"
          onClick={share}
          className="rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          {"Share today's run"}
        </button>
        <Link
          href={freeHref}
          className="text-chalk-dim underline underline-offset-2 hover:text-chalk"
        >
          Play a free run
        </Link>
      </div>
      <p className="mt-2 min-h-5 text-sm text-chalk-dim" role="status">
        {note}
      </p>
    </>
  );
}

/** Today's run once it has ended: how it went, the share, and when the next one is dealt. */
export function DailyRunResult({
  game,
  day,
  headline,
  summary,
  shareText,
  freeHref,
  now,
}: {
  game: string;
  day: string;
  headline: string;
  /** What happened, as a sentence or two; the time to the next run follows it. */
  summary: string;
  shareText: (href: string) => string;
  freeHref: string;
  now?: () => Date;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-sm text-gold">{`${game} · today's run · ${day}`}</p>
      <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
        {headline}
      </h1>
      <p className="mt-4 text-lg text-chalk-dim">
        {`${summary} The next run is dealt in ${untilNextRun(now?.())}.`}
      </p>
      <div className="mt-4">
        <ShareDay shareText={shareText} freeHref={freeHref} focus />
      </div>
    </main>
  );
}
