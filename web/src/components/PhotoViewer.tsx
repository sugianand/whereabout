"use client";

import { useState, type KeyboardEvent, type MouseEvent } from "react";

type PhotoViewerProps = {
  src: string;
  /** Changes every round, so zoom and load state reset with each new photo. */
  roundKey: string;
};

/** How far a tap zooms in, so players can read a sign or a number plate. */
export const ZOOM = 2.5;

/**
 * The round's photo, filling its frame. Tap or click a spot to zoom in on it; tap again to
 * zoom back out. Keyboard: Enter or Space zooms on the centre.
 */
export default function PhotoViewer(props: PhotoViewerProps) {
  // Keyed by round so state never leaks from one photo to the next.
  return <PhotoViewerInner key={props.roundKey} {...props} />;
}

function PhotoViewerInner({ src }: PhotoViewerProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);

  function toggleAt(x: number, y: number) {
    setFocus((current) => (current ? null : { x, y }));
  }

  function onClick(event: MouseEvent<HTMLButtonElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const x = box.width ? ((event.clientX - box.left) / box.width) * 100 : 50;
    const y = box.height ? ((event.clientY - box.top) / box.height) * 100 : 50;
    toggleAt(x, y);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && focus) {
      event.preventDefault();
      setFocus(null);
    }
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-ocean-deep">
      {status === "loading" && <div className="wb-shimmer absolute inset-0" aria-hidden="true" />}
      {status === "failed" ? (
        <p role="alert" className="absolute inset-0 grid place-items-center p-6 text-chalk-dim">
          This photo didn&apos;t load. Place your best guess anyway, or try reloading the page.
        </p>
      ) : (
        <button
          type="button"
          onClick={onClick}
          onKeyDown={onKeyDown}
          aria-pressed={!!focus}
          aria-label={focus ? "Zoom out of the photo" : "Zoom in on the photo"}
          className={`block h-full w-full ${focus ? "cursor-zoom-out" : "cursor-zoom-in"}`}
        >
          {/* A plain img: the photos are hot-linked from Wikimedia at a fixed size. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt="The photo to locate. Look for clues: signs, plants, roads, buildings, the sky."
            draggable={false}
            onLoad={() => setStatus("loaded")}
            onError={() => setStatus("failed")}
            style={{
              transform: focus ? `scale(${ZOOM})` : undefined,
              transformOrigin: focus ? `${focus.x}% ${focus.y}%` : undefined,
            }}
            className={`h-full w-full select-none object-cover transition-[transform,opacity] duration-300 ${
              status === "loaded" ? "opacity-100" : "opacity-0"
            }`}
          />
        </button>
      )}
    </div>
  );
}
