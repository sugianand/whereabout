"use client";

import { useEffect, useState } from "react";

import { isMuted, prefersReducedMotion, primeAudio, setMuted } from "@/lib/feel";

/**
 * The header's sound-and-vibration toggle. Browser storage and the motion preference are only
 * readable after hydration, so it renders nothing until then, and nothing at all under reduced
 * motion, where the reveal is silent and still anyway.
 *
 * While it is mounted, the player's taps and key presses wake the page's audio (browsers only
 * allow sound after one), so the reveal's chime can play after a guess or a Blitz time-out.
 */
export default function FeelToggle() {
  const [muted, setMutedState] = useState<boolean | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    // Browser storage is only readable after hydration, as with the intro card.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after hydration
    setMutedState(isMuted());
    window.addEventListener("pointerdown", primeAudio, { passive: true });
    window.addEventListener("keydown", primeAudio);
    return () => {
      window.removeEventListener("pointerdown", primeAudio);
      window.removeEventListener("keydown", primeAudio);
    };
  }, []);

  if (muted === null) return null;

  return (
    <button
      type="button"
      aria-pressed={!muted}
      aria-label="Sound and vibration at the reveal"
      title={muted ? "Sound and vibration are off" : "Sound and vibration are on"}
      onClick={() => {
        setMuted(!muted);
        setMutedState(!muted);
      }}
      className="pointer-events-auto grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border border-chalk/30 bg-ocean-deep/60 text-chalk backdrop-blur transition hover:border-chalk"
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
        {muted ? (
          <path d="M16 9.5l5 5M21 9.5l-5 5" />
        ) : (
          <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
        )}
      </svg>
    </button>
  );
}
