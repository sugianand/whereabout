"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

import {
  isZoomed,
  panBy,
  RESET,
  TAP_ZOOM,
  toTransform,
  zoomAt,
  ZOOM_STEP,
  type Frame,
  type Point,
  type View,
} from "@/lib/photoView";
import { placeholderUrl, sources } from "@/lib/photoSources";

type PhotoViewerProps = {
  src: string;
  /** Changes every round, so zoom and load state reset with each new photo. */
  roundKey: string;
  /** Original file size in pixels, when known; enables sharper sources on big screens. */
  width?: number;
  height?: number;
};

/** Kept so older callers can still read how far a tap zooms. */
export const ZOOM = TAP_ZOOM;

/** A press that moves less than this many pixels is a tap, not a drag. */
const TAP_SLOP = 6;

/**
 * The round's photo, filling its frame, with pan and zoom. Tap or click a spot to zoom in on
 * it and tap again to zoom out; drag to look around; pinch or scroll to zoom about the
 * fingers or cursor. Keyboard: Enter or Space zooms on the centre, arrow keys pan, + and -
 * zoom, Escape or 0 resets. A "Reset view" button appears while zoomed.
 */
export default function PhotoViewer(props: PhotoViewerProps) {
  // Keyed by round so state never leaks from one photo to the next.
  return <PhotoViewerInner key={props.roundKey} {...props} />;
}

function PhotoViewerInner({ src, width }: PhotoViewerProps) {
  const photoSources = sources({ imageUrl: src, width });
  const blurSrc = placeholderUrl(src);
  const [fullLoaded, setFullLoaded] = useState(false);
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
  const [view, setViewState] = useState<View>(RESET);
  const [interacting, setInteracting] = useState(false);

  const viewRef = useRef<View>(RESET);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const press = useRef({ moved: 0, multi: false });
  const suppressClick = useRef(false);
  const pinch = useRef<{ dist: number; mid: Point } | null>(null);

  function setView(next: View) {
    viewRef.current = next;
    setViewState(next);
  }

  function frameOf(): { frame: Frame; left: number; top: number } {
    const box = buttonRef.current?.getBoundingClientRect();
    return {
      frame: { w: box?.width ?? 0, h: box?.height ?? 0 },
      left: box?.left ?? 0,
      top: box?.top ?? 0,
    };
  }

  function centre(frame: Frame): Point {
    return { x: frame.w / 2, y: frame.h / 2 };
  }

  function toggleAt(point: Point | null) {
    const { frame } = frameOf();
    if (isZoomed(viewRef.current)) {
      setView(RESET);
    } else {
      setView(zoomAt(RESET, TAP_ZOOM, point ?? centre(frame), frame));
    }
  }

  // React's onWheel is passive, so preventDefault needs a native non-passive listener.
  useEffect(() => {
    const el = buttonRef.current;
    if (!el) return;
    function onWheel(event: WheelEvent) {
      const box = el!.getBoundingClientRect();
      const frame = { w: box.width, h: box.height };
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.height : 1;
      const factor = Math.exp((-event.deltaY * unit) / 400);
      if (!isZoomed(viewRef.current) && factor < 1) return; // let the page scroll
      event.preventDefault();
      const point = { x: event.clientX - box.left, y: event.clientY - box.top };
      viewRef.current = zoomAt(viewRef.current, factor, point, frame);
      setViewState(viewRef.current);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [status]);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    suppressClick.current = false;
    if (pointers.current.size === 0) press.current = { moved: 0, multi: false };
    const { left, top } = frameOf();
    pointers.current.set(event.pointerId, { x: event.clientX - left, y: event.clientY - top });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (pointers.current.size >= 2) {
      press.current.multi = true;
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    }
    setInteracting(true);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const prev = pointers.current.get(event.pointerId);
    if (!prev) return;
    const { frame, left, top } = frameOf();
    const now = { x: event.clientX - left, y: event.clientY - top };
    pointers.current.set(event.pointerId, now);

    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let next = viewRef.current;
      if (pinch.current.dist > 0 && dist > 0) {
        next = zoomAt(next, dist / pinch.current.dist, mid, frame);
      }
      next = panBy(next, mid.x - pinch.current.mid.x, mid.y - pinch.current.mid.y, frame);
      pinch.current = { dist, mid };
      setView(next);
      return;
    }

    const dx = now.x - prev.x;
    const dy = now.y - prev.y;
    press.current.moved += Math.hypot(dx, dy);
    if (press.current.moved >= TAP_SLOP && isZoomed(viewRef.current)) {
      setView(panBy(viewRef.current, dx, dy, frame));
    }
  }

  function onPointerEnd(event: PointerEvent<HTMLButtonElement>) {
    if (!pointers.current.delete(event.pointerId)) return;
    if (press.current.multi || press.current.moved >= TAP_SLOP) suppressClick.current = true;
    pinch.current = null;
    if (pointers.current.size === 0) setInteracting(false);
  }

  function onClick(event: MouseEvent<HTMLButtonElement>) {
    if (suppressClick.current) {
      suppressClick.current = false; // the tail of a drag or pinch, not a tap
      return;
    }
    const { left, top } = frameOf();
    // Keyboard-triggered clicks carry no pointer position; zoom on the centre.
    const keyboard = event.detail === 0 && event.clientX === 0 && event.clientY === 0;
    toggleAt(keyboard ? null : { x: event.clientX - left, y: event.clientY - top });
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const { frame } = frameOf();
    const current = viewRef.current;
    const zoomed = isZoomed(current);
    switch (event.key) {
      case "Escape":
        if (zoomed) {
          event.preventDefault();
          setView(RESET);
        }
        return;
      case "0":
        event.preventDefault();
        setView(RESET);
        return;
      case "+":
      case "=":
        event.preventDefault();
        setView(zoomAt(current, ZOOM_STEP, centre(frame), frame));
        return;
      case "-":
      case "_":
        event.preventDefault();
        setView(zoomAt(current, 1 / ZOOM_STEP, centre(frame), frame));
        return;
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown": {
        if (!zoomed) return;
        event.preventDefault();
        const step = event.key === "ArrowLeft" || event.key === "ArrowRight" ? frame.w : frame.h;
        const sign = event.key === "ArrowLeft" || event.key === "ArrowUp" ? 1 : -1;
        // Moving the view left means shifting the image right, hence the sign.
        const d = sign * step * 0.1;
        setView(
          event.key === "ArrowLeft" || event.key === "ArrowRight"
            ? panBy(current, d, 0, frame)
            : panBy(current, 0, d, frame),
        );
        return;
      }
    }
  }

  const zoomed = isZoomed(view);

  // Once zoomed, preload the largest source and swap to it only when ready (no flash).
  const full = photoSources.full;
  const wantsFull = zoomed && full !== photoSources.src;
  useEffect(() => {
    if (!wantsFull || fullLoaded) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setFullLoaded(true);
    };
    img.src = full;
    return () => {
      cancelled = true;
    };
  }, [wantsFull, fullLoaded, full]);

  const cursor = interacting && zoomed ? "cursor-grabbing" : zoomed ? "cursor-grab" : "cursor-zoom-in";

  return (
    <div className="relative h-full w-full overflow-hidden bg-ocean-deep">
      {/* Holds the photo's place until it arrives: its own tiny thumbnail, blurred. No spinner. */}
      {status !== "failed" && (
        <div
          className="wb-photo-placeholder absolute inset-0"
          data-photo-placeholder={status === "loaded" ? "covered" : "showing"}
          aria-hidden="true"
        >
          {blurSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={blurSrc} alt="" draggable={false} className="h-full w-full object-cover" />
          )}
        </div>
      )}
      {status === "failed" ? (
        <p role="alert" className="absolute inset-0 grid place-items-center p-6 text-chalk-dim">
          This photo didn&apos;t load. Place your best guess anyway, or try reloading the page.
        </p>
      ) : (
        <>
          <button
            ref={buttonRef}
            type="button"
            onClick={onClick}
            onKeyDown={onKeyDown}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            aria-pressed={zoomed}
            aria-label={zoomed ? "Zoom out of the photo" : "Zoom in on the photo"}
            style={{ touchAction: "none" }}
            className={`block h-full w-full ${cursor}`}
          >
            {/* A plain img: the photos are hot-linked from Wikimedia at a fixed size. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fullLoaded ? full : photoSources.src}
              srcSet={fullLoaded ? undefined : photoSources.srcSet}
              sizes="100vw"
              decoding="async"
              alt="The photo to locate. Look for clues: signs, plants, roads, buildings, the sky."
              draggable={false}
              onLoad={() => setStatus("loaded")}
              onError={() => setStatus("failed")}
              style={{ transform: toTransform(view), transformOrigin: "0 0" }}
              className={`h-full w-full select-none object-cover ${
                interacting ? "transition-opacity duration-300" : "transition-[transform,opacity] duration-200"
              } ${status === "loaded" ? "opacity-100" : "opacity-0"}`}
            />
          </button>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-ocean-deep/60 px-3 py-1 text-xs text-chalk-dim backdrop-blur transition-opacity"
          >
            {zoomed ? "Drag to look around · scroll to zoom" : "Tap to zoom"}
          </span>
          {zoomed && (
            <button
              type="button"
              onClick={() => setView(RESET)}
              aria-label="Reset photo view"
              className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-ocean-deep/60 text-chalk-dim backdrop-blur hover:text-chalk"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </>
      )}
    </div>
  );
}
