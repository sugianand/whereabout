"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import type { QuickMode } from "@/lib/game/quickBests";

import QuickGames from "./QuickGames";

/** A screen the Games menu can be opened from: a five-round game or one of the quick modes. */
export type GamesScreen = "round" | QuickMode;

type GamesMenuProps = {
  /** The screen the menu sits on: its own card reads "Playing now" and isn't a link. */
  screen: GamesScreen;
  /** Start a Blitz on this screen (the five-round game); elsewhere Blitz opens `/?blitz`. */
  onPlayBlitz?: () => void;
  /** Whether Blitz is offered at all (the API backend plays untimed). */
  blitz?: boolean;
  /** Where Country Streak opens; omitted when the deck has no photos it can deal. */
  streakHref?: string;
  /** Deal a fresh five-round game on this screen (from a Blitz); elsewhere the card opens `/`. */
  onPlayRound?: () => void;
};

const ROUND_CARD = "mt-4 block w-full rounded-xl border px-4 py-3 text-left";
const ROUND_LINK = "border-gold/40 transition hover:border-gold hover:bg-gold/5";

function RoundBody({ current = false }: { current?: boolean }) {
  return (
    <>
      <span className={`block font-sign text-xl font-bold ${current ? "text-chalk" : "text-gold"}`}>
        Five rounds
        {current && (
          <span className="ml-2 align-middle font-sans text-xs font-semibold text-chalk-dim">
            Playing now
          </span>
        )}
      </span>
      <span className="mt-1 block text-sm text-chalk-dim">
        The full game: pin five photos on the globe and see if you beat Atlas.
      </span>
    </>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Every way to play, from any screen: the Games button opens one sheet listing the five-round
 * game, each quick mode with its best kept in this browser (`QuickGames`), and pass and play.
 * Before it, a first-time player saw only Blitz and Country Streak until they finished a game.
 *
 * The sheet is a modal dialog: focus moves to its close button and Tab stays inside it, its key
 * presses stop at it (so a round's H or a quick game's 1 to 4 never act behind it), and Esc, the
 * close button, a tap outside or picking a game close it. A link to another page leaves the
 * sheet open until that page replaces this one: unmounting a Next link inside its own click can
 * drop the navigation.
 */
export default function GamesMenu({
  screen,
  onPlayBlitz,
  blitz = true,
  streakHref,
  onPlayRound,
}: GamesMenuProps) {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();

  const show = useCallback(() => {
    returnTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);

  // Closing gives focus back, unless a pick is taking the player somewhere else.
  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) returnTo.current?.focus({ preventScroll: true });
    returnTo.current = null;
  }, []);
  const picked = useCallback(() => close(false), [close]);

  useEffect(() => {
    if (open) closeRef.current?.focus({ preventScroll: true });
  }, [open]);

  function onSheetKey(e: KeyboardEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      // Tab and Shift+Tab cycle through the sheet's own links and buttons.
      const items = Array.from(sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey
        ? at <= 0
          ? items.length - 1
          : at - 1
        : at === -1 || at === items.length - 1
          ? 0
          : at + 1;
      e.preventDefault();
      items[next]!.focus();
    }
  }

  const current = screen === "round" ? undefined : screen;

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Every way to play"
        className="pointer-events-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-flare/50 bg-ocean-deep/60 px-3 py-1 text-xs font-semibold text-flare backdrop-blur transition hover:border-flare"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor">
          <rect x="1" y="1" width="6" height="6" rx="1.5" />
          <rect x="9" y="1" width="6" height="6" rx="1.5" />
          <rect x="1" y="9" width="6" height="6" rx="1.5" />
          <rect x="9" y="9" width="6" height="6" rx="1.5" />
        </svg>
        Games
      </button>
      {open && (
        <div
          className="pointer-events-auto fixed inset-0 z-50 flex items-end justify-center bg-ocean-deep/70 p-0 backdrop-blur-sm md:items-center md:p-6"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={onSheetKey}
            className="wb-games max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-graticule/70 bg-ocean-deep p-4 text-left text-chalk shadow-2xl md:rounded-2xl md:p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id={titleId} className="font-sign text-2xl font-extrabold leading-tight">
                Ways to play
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={() => close()}
                className="shrink-0 rounded-full border border-chalk/30 px-3 py-1 text-sm font-semibold transition hover:border-chalk"
              >
                Close
              </button>
            </div>

            {screen === "round" ? (
              <div aria-current="page" className={`${ROUND_CARD} border-chalk/30 bg-chalk/5`}>
                <RoundBody current />
              </div>
            ) : onPlayRound ? (
              <button
                type="button"
                onClick={() => {
                  picked();
                  onPlayRound();
                }}
                className={`${ROUND_CARD} ${ROUND_LINK}`}
              >
                <RoundBody />
              </button>
            ) : (
              <Link href="/" className={`${ROUND_CARD} ${ROUND_LINK}`}>
                <RoundBody />
              </Link>
            )}

            <h3 className="mt-4 text-sm font-semibold text-gold">Quick games</h3>
            <div className="mt-2">
              <QuickGames
                compact
                current={current}
                onPlayBlitz={blitz ? onPlayBlitz : undefined}
                blitzHref={blitz && !onPlayBlitz ? "/?blitz" : undefined}
                streakHref={streakHref}
                onPicked={picked}
              />
            </div>

            <h3 className="mt-4 text-sm font-semibold text-gold">With friends</h3>
            <Link
              href="/pass-and-play"
              className="mt-2 block rounded-xl border border-flare/40 px-4 py-3 transition hover:border-flare hover:bg-flare/5"
            >
              <span className="block font-sign text-xl font-bold text-flare">Pass and play</span>
              <span className="mt-1 block text-sm text-chalk-dim">
                Two to four players take turns on this device, then one reveal shows every pin.
              </span>
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
