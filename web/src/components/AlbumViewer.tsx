"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent } from "react";

import { stepIn, swipeStep } from "@/lib/album";
import { atlasKm, verdict, type CallVerdict } from "@/lib/closestCalls";
import type { Continent } from "@/lib/continents";
import { closenessOf } from "@/lib/feel";
import type { GameRecord } from "@/lib/game/deck";
import { formatDistance, formatPoints } from "@/lib/geo";
import { sources } from "@/lib/photoSources";
import { BANDS, type PlayedPhoto } from "@/lib/playedMap";
import { useColorScheme } from "@/lib/useTheme";
import { useUnits } from "@/lib/useUnits";

import ClosenessMark from "./ClosenessMark";
import { BAND_SCHEMES } from "./PlayedMap";
import PostcardNote from "./PostcardNote";

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

const VERDICT_TEXT: Record<CallVerdict, string> = {
  you: "You beat Atlas",
  atlas: "Atlas got closer",
  tie: "Dead heat",
};

export interface AlbumViewerProps {
  continent: Continent;
  /** The continent's found photos, in the album's order. */
  photos: readonly PlayedPhoto[];
  index: number;
  /** Each photo's record once loaded, or "failed". */
  loaded: Readonly<Record<string, GameRecord | "failed">>;
  onIndex: (index: number) => void;
  onClose: () => void;
}

/**
 * A found photo opened from the album, as a modal dialog: the photo large, where it was, the
 * day it was found, how close your pin and Atlas's landed, and its postcard. ← and → (or a
 * swipe on the photo, or the buttons) turn through the continent's page; Esc, the close button
 * or a tap outside close it, and focus goes back to the card it was opened from.
 */
export default function AlbumViewer({
  continent,
  photos,
  index,
  loaded,
  onIndex,
  onClose,
}: AlbumViewerProps) {
  const units = useUnits();
  const bands = BAND_SCHEMES[useColorScheme() === "light" ? "day" : "night"];
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const swipeFrom = useRef<{ x: number; y: number } | null>(null);
  const titleId = useId();

  useEffect(() => {
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    // The page behind stays still while the photo is open.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      returnTo?.focus({ preventScroll: true });
    };
  }, []);

  const p = photos[index];
  if (!p) return null;
  const got = loaded[p.id];
  const record = got && got !== "failed" && got.photo.id === p.id ? got : null;
  const photo = record?.photo ?? null;
  const atlas = atlasKm(p, record);
  const who = atlas === null || p.km === null ? null : verdict(p.km, atlas);
  const band = closenessOf(p.km);
  const first = index === 0;
  const last = index === photos.length - 1;
  const go = (delta: number) => {
    const next = stepIn(photos.length, index, delta);
    if (next !== index) onIndex(next);
  };

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      go(e.key === "ArrowRight" ? 1 : -1);
    } else if (e.key === "Tab") {
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

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    swipeFrom.current = { x: e.clientX, y: e.clientY };
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const from = swipeFrom.current;
    swipeFrom.current = null;
    if (from) go(swipeStep(e.clientX - from.x, e.clientY - from.y));
  }

  const src = photo ? sources(photo) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ocean-deep/80 sm:items-center sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKey}
        className="flex max-h-[100dvh] w-full max-w-3xl flex-col overflow-y-auto rounded-t-2xl border border-graticule bg-ocean-deep sm:max-h-[90vh] sm:rounded-2xl"
        data-testid="album-viewer"
      >
        <div
          className="relative aspect-[4/3] max-h-[55vh] w-full shrink-0 touch-pan-y bg-graticule/40 sm:aspect-[3/2]"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (swipeFrom.current = null)}
          data-testid="album-viewer-photo"
        >
          {src && (
            // Wikimedia thumbnails, already sized; next/image can't optimise a static export.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={p.id}
              src={src.src}
              srcSet={src.srcSet}
              sizes="(min-width: 768px) 48rem, 100vw"
              alt={`Your photo from ${p.place}`}
              draggable={false}
              className="h-full w-full select-none object-contain"
            />
          )}
          {got === "failed" && (
            <p className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-chalk-dim">
              This photo couldn&apos;t be loaded. Check your connection.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-chalk-dim tabular-nums">
                {continent} · {index + 1} of {photos.length}
              </p>
              <h2 id={titleId} className="font-sign text-2xl font-extrabold leading-tight">
                {p.place}
              </h2>
              <p className="text-sm text-chalk-dim">Found {p.day}</p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-full border border-chalk/30 px-3 py-1.5 text-sm font-semibold transition hover:border-chalk"
            >
              Close
            </button>
          </div>

          <dl className="grid max-w-xs grid-cols-[auto_1fr] gap-x-3 text-sm tabular-nums">
            <dt className="text-chalk-dim">You</dt>
            <dd className="flex items-center justify-end gap-1.5 font-semibold text-gold">
              <ClosenessMark band={BANDS.indexOf(band)} color={bands[band]} size={12} />
              {p.km === null ? "No pin" : `${formatDistance(p.km, units)} off`}
            </dd>
            {record && (
              <>
                <dt className="text-chalk-dim">Atlas</dt>
                <dd className="text-right">
                  {atlas === null ? "No guess" : `${formatDistance(atlas, units)} off`}
                </dd>
              </>
            )}
            <dt className="text-chalk-dim">Points</dt>
            <dd className="text-right">{formatPoints(p.score)}</dd>
          </dl>
          {who && (
            <p
              className={`text-sm font-semibold ${who === "you" ? "text-gold" : "text-chalk-dim"}`}
            >
              {VERDICT_TEXT[who]}
            </p>
          )}

          {photo?.postcard && (
            <PostcardNote
              postcard={photo.postcard}
              sourceUrl={photo.credit.sourceUrl}
              testId="album-postcard"
            />
          )}
          {photo && (
            <p className="text-xs text-chalk-dim">
              Photo:{" "}
              <a
                href={photo.credit.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-chalk"
              >
                {photo.credit.author}
              </a>
              , {photo.credit.license}
            </p>
          )}

          <div className="mt-2 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => go(-1)}
              aria-disabled={first}
              aria-label="Previous photo"
              className="rounded-full border border-chalk/30 px-4 py-2 text-sm font-semibold transition hover:border-chalk aria-disabled:opacity-40 aria-disabled:hover:border-chalk/30"
            >
              ← Previous
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-disabled={last}
              aria-label="Next photo"
              className="rounded-full border border-chalk/30 px-4 py-2 text-sm font-semibold transition hover:border-chalk aria-disabled:opacity-40 aria-disabled:hover:border-chalk/30"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
