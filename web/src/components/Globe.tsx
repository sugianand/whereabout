"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { MAP_COLORS, buildGlobeStyle } from "@/lib/basemap";
import { formatLngLat, normalize, nudge, type Direction, type LngLat } from "@/lib/geo";
import { MIN_SUPPORTED_ZOOM, ZOOM_OUT_SLACK, fitGlobeZoom } from "@/lib/globe-view";
import { maplibreWorkerUrl } from "@/lib/maplibre-worker";
import {
  REVEAL_DRAW_MS,
  easeOut,
  revealCamera,
  revealLines,
  revealPadding,
  visibleFrame,
  type RevealLines,
  type RevealView,
} from "@/lib/reveal";

export type GlobeProps = {
  /** The player's pin, or null before they have placed one. */
  pin: LngLat | null;
  /** Called with the new location whenever the player places or moves the pin. */
  onPinChange: (pin: LngLat) => void;
  /** Disable pin placement, e.g. while a guess is being scored. */
  disabled?: boolean;
  /** After a guess: the true location and every guess, drawn as arcs that land on the truth. */
  reveal?: RevealView | null;
  /** Called when the player spins, zooms or clicks the globe, so the frame can stay open. */
  onInteract?: () => void;
  className?: string;
};

const REVEAL_SOURCE = "reveal";
const EMPTY_LINES: RevealLines = { type: "FeatureCollection", features: [] };

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/** Adds the arc layers once the style has loaded. Colors follow docs/design.md. */
function addRevealLayers(map: MapLibreMap) {
  map.addSource(REVEAL_SOURCE, { type: "geojson", data: EMPTY_LINES });
  const color = [
    "match",
    ["get", "actor"],
    "player",
    MAP_COLORS.flare,
    "atlas",
    MAP_COLORS.sonar,
    MAP_COLORS.gold,
  ] as unknown as string;
  map.addLayer({
    id: "reveal-glow",
    type: "line",
    source: REVEAL_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": color, "line-width": 9, "line-opacity": 0.22, "line-blur": 4 },
  });
  map.addLayer({
    id: "reveal-line",
    type: "line",
    source: REVEAL_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": color, "line-width": 2.5 },
  });
}

function setRevealLines(map: MapLibreMap, data: RevealLines) {
  const source = map.getSource(REVEAL_SOURCE) as { setData(d: RevealLines): void } | undefined;
  source?.setData(data);
}

const ARROW_KEYS: Record<string, Direction> = {
  ArrowUp: "north",
  ArrowDown: "south",
  ArrowLeft: "west",
  ArrowRight: "east",
};

/** Degrees moved per arrow key press; Shift moves ten times as far. */
export const KEY_STEP_DEGREES = 1;
export const KEY_STEP_LARGE_DEGREES = 10;

/** The opening view. `zoom` is only a fallback: the globe is sized to fit its frame. */
export const INITIAL_VIEW = { center: { lng: 10, lat: 20 } satisfies LngLat, zoom: 1.4 };

const RESET_MS = 450;

function createPinElement(variant: "player" | "atlas" | "truth" = "player"): HTMLElement {
  // MapLibre positions the outer element with its own `transform`, so the drop shape is
  // drawn by an inner element that can be rotated freely.
  const el = document.createElement("div");
  el.className = variant === "player" ? "globe-pin" : `globe-pin globe-pin--${variant}`;
  el.setAttribute("aria-hidden", "true");
  const drop = document.createElement("div");
  drop.className = "globe-pin__drop";
  el.appendChild(drop);
  return el;
}

/**
 * A spinnable 3D globe (MapLibre GL, globe projection) where the player drops a guess pin.
 *
 * Mouse and touch: click or tap to place the pin; drag to spin; scroll or pinch to zoom.
 * Keyboard: focus the globe, press Enter to drop a pin at the centre of the view, then use
 * the arrow keys to move it (Shift for bigger steps) and +/- to zoom.
 */
export default function Globe({
  pin,
  onPinChange,
  disabled = false,
  reveal = null,
  onInteract,
  className,
}: GlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const markerClassRef = useRef<typeof Marker | null>(null);
  const revealMarkersRef = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // The map is created once; these refs let its event handlers see the latest props. They are
  // synced in a layout effect, before paint: a passive effect runs after paint, and a click in
  // that gap would see a stale `disabled` and be dropped.
  const onPinChangeRef = useRef(onPinChange);
  const onInteractRef = useRef(onInteract);
  const disabledRef = useRef(disabled);
  const revealingRef = useRef(!!reveal);
  useLayoutEffect(() => {
    onPinChangeRef.current = onPinChange;
    onInteractRef.current = onInteract;
    disabledRef.current = disabled;
    revealingRef.current = !!reveal;
  }, [onPinChange, onInteract, disabled, reveal]);

  // While true, the globe keeps itself sized to show the whole Earth as its frame grows and
  // shrinks. Zooming by hand turns it off; "Show the whole globe" turns it back on.
  const autoFitRef = useRef(true);
  const wasRevealingRef = useRef(false);
  // The whole-globe zoom for the frame's current size. When the player has zoomed by hand and
  // the frame then resizes, their zoom moves by the same amount, so the view keeps its framing
  // instead of spilling past the edges of a smaller frame.
  const fitZoomRef = useRef<number | null>(null);

  /** Keeps the player's framing when the frame resizes after they zoomed by hand. */
  function keepFraming(map: MapLibreMap) {
    const el = containerRef.current;
    if (!el) return;
    const fit = fitGlobeZoom(el.clientWidth, el.clientHeight, INITIAL_VIEW.center.lat);
    if (fit === null) return;
    const previous = fitZoomRef.current;
    fitZoomRef.current = fit;
    const minZoom = Math.max(MIN_SUPPORTED_ZOOM, fit - ZOOM_OUT_SLACK);
    map.setMinZoom(minZoom);
    if (previous === null || previous === fit) return;
    map.jumpTo({ zoom: Math.max(minZoom, map.getZoom() + (fit - previous)) });
  }
  const keepFramingRef = useRef(keepFraming);
  useLayoutEffect(() => {
    keepFramingRef.current = keepFraming;
  });

  /** Sizes the camera so the whole globe fits the frame. */
  function fitWholeGlobe(map: MapLibreMap, animate: boolean) {
    const el = containerRef.current;
    if (!el) return;
    const lat = INITIAL_VIEW.center.lat;
    const zoom = fitGlobeZoom(el.clientWidth, el.clientHeight, lat);
    if (zoom === null) return;
    fitZoomRef.current = zoom;
    map.setMinZoom(Math.max(MIN_SUPPORTED_ZOOM, zoom - ZOOM_OUT_SLACK));
    const lng = map.getCenter().lng;
    const view = {
      center: [lng, lat] as [number, number],
      zoom,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    if (animate && !prefersReducedMotion()) map.easeTo({ ...view, duration: RESET_MS });
    else map.jumpTo(view);
  }
  const fitRef = useRef(fitWholeGlobe);
  useLayoutEffect(() => {
    fitRef.current = fitWholeGlobe;
  });

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    let observer: ResizeObserver | null = null;

    // MapLibre touches `window` on import, so load it only in the browser.
    import("maplibre-gl")
      .then(({ Map, Marker, getVersion, setWorkerUrl }) => {
        const el = containerRef.current;
        if (cancelled || !el) return;
        setWorkerUrl(maplibreWorkerUrl(getVersion()));
        const fitted = fitGlobeZoom(el.clientWidth, el.clientHeight, INITIAL_VIEW.center.lat);
        map = new Map({
          container: el,
          style: buildGlobeStyle(),
          center: [INITIAL_VIEW.center.lng, INITIAL_VIEW.center.lat],
          zoom: fitted ?? INITIAL_VIEW.zoom,
          minZoom: MIN_SUPPORTED_ZOOM,
          maxZoom: 9,
          // Keyboard play is handled by the wrapper so it can move the pin, not just the camera.
          keyboard: false,
          attributionControl: { compact: true },
        });
        map.on("click", (event) => {
          if (disabledRef.current) return;
          onInteractRef.current?.();
          onPinChangeRef.current(normalize({ lng: event.lngLat.lng, lat: event.lngLat.lat }));
        });
        // A wheel, pinch or double-click zoom means the player wants this view; stop refitting.
        map.on("zoomstart", (event) => {
          if (!(event as { originalEvent?: unknown } | undefined)?.originalEvent) return;
          autoFitRef.current = false;
          onInteractRef.current?.();
        });
        map.on("dragstart", () => onInteractRef.current?.());
        map.on("load", () => {
          if (cancelled || !map) return;
          addRevealLayers(map);
          setReady(true);
        });
        mapRef.current = map;
        markerClassRef.current = Marker;
        fitRef.current(map, false);

        // The frame changes size (it grows while in use on wide screens), so refit with it.
        if (typeof ResizeObserver !== "undefined") {
          observer = new ResizeObserver(() => {
            if (!map || revealingRef.current) return;
            map.resize();
            if (autoFitRef.current) fitRef.current(map, false);
            else keepFramingRef.current(map);
          });
          observer.observe(el);
        }
      })
      .catch(() => {
        // Most often: the browser has no WebGL. Keyboard placement still works without it.
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      observer?.disconnect();
      markerRef.current?.remove();
      markerRef.current = null;
      for (const m of revealMarkersRef.current) m.remove();
      revealMarkersRef.current = [];
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Keep the marker in sync with the controlled `pin` prop.
  useEffect(() => {
    const map = mapRef.current;
    const MarkerClass = markerClassRef.current;
    if (!map || !MarkerClass) return;
    if (!pin) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      markerRef.current = new MarkerClass({ element: createPinElement(), anchor: "bottom" })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map);
    } else {
      markerRef.current.setLngLat([pin.lng, pin.lat]);
    }
  }, [pin, ready]);

  // The reveal: arcs draw from each guess to the truth, the camera frames them, and the gold
  // truth pin drops when the arcs land. Reduced motion jumps straight to the final frame.
  useEffect(() => {
    const map = mapRef.current;
    const MarkerClass = markerClassRef.current;
    if (!map || !MarkerClass || !ready) return;

    const clearMarkers = () => {
      for (const m of revealMarkersRef.current) m.remove();
      revealMarkersRef.current = [];
    };
    clearMarkers();
    if (!reveal) {
      setRevealLines(map, EMPTY_LINES);
      // A new round: go back to the whole globe, whatever the reveal zoomed in on.
      if (wasRevealingRef.current) {
        wasRevealingRef.current = false;
        autoFitRef.current = true;
        map.resize();
        fitRef.current(map, false);
      }
      return;
    }
    wasRevealingRef.current = true;

    for (const g of reveal.guesses) {
      if (g.actor === "atlas") {
        revealMarkersRef.current.push(
          new MarkerClass({ element: createPinElement("atlas"), anchor: "bottom" })
            .setLngLat([g.at.lng, g.at.lat])
            .addTo(map),
        );
      }
    }
    const dropTruth = () => {
      revealMarkersRef.current.push(
        new MarkerClass({ element: createPinElement("truth"), anchor: "bottom" })
          .setLngLat([reveal.truth.lng, reveal.truth.lat])
          .addTo(map),
      );
    };

    // The frame may have just changed size (the reveal goes full screen), so size the
    // canvas to it before fitting the camera.
    map.resize();
    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 800;
    const padding = revealPadding(width, height);
    const camera = revealCamera(reveal, visibleFrame(width, height, padding));
    const center: [number, number] = [camera.center.lng, camera.center.lat];
    if (prefersReducedMotion()) {
      map.jumpTo({ center, zoom: camera.zoom, padding });
      setRevealLines(map, revealLines(reveal, 1));
      dropTruth();
      return clearMarkers;
    }

    map.easeTo({ center, zoom: camera.zoom, padding, duration: REVEAL_DRAW_MS + 200 });
    let frame = 0;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const t = (now - start) / REVEAL_DRAW_MS;
      setRevealLines(map, revealLines(reveal, easeOut(t)));
      if (t < 1) frame = requestAnimationFrame(step);
      else dropTruth();
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      clearMarkers();
    };
  }, [reveal, ready]);

  function zoomIn() {
    autoFitRef.current = false;
    onInteract?.();
    mapRef.current?.zoomIn();
  }

  function zoomOut() {
    autoFitRef.current = false;
    onInteract?.();
    mapRef.current?.zoomOut();
  }

  function showWholeGlobe() {
    const map = mapRef.current;
    if (!map) return;
    autoFitRef.current = true;
    fitWholeGlobe(map, true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const map = mapRef.current;
    const direction = ARROW_KEYS[event.key];

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomIn();
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomOut();
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      showWholeGlobe();
      return;
    }
    if (disabled) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (pin) return;
      const center = map?.getCenter() ?? INITIAL_VIEW.center;
      onPinChange(normalize({ lng: center.lng, lat: center.lat }));
      return;
    }

    if (direction) {
      event.preventDefault();
      const start = pin ?? normalize(map?.getCenter() ?? INITIAL_VIEW.center);
      const step = event.shiftKey ? KEY_STEP_LARGE_DEGREES : KEY_STEP_DEGREES;
      const next = nudge(start, direction, step);
      onPinChange(next);
      // Follow the pin so keyboard players can see where it went.
      map?.easeTo({ center: [next.lng, next.lat], duration: 200 });
    }
  }

  return (
    <div className={["flex flex-col", className].filter(Boolean).join(" ")}>
      <div className="relative flex min-h-0 w-full flex-1 flex-col">
        <div
          ref={containerRef}
          role="application"
          aria-roledescription="globe"
          aria-label="Globe. Click to place your pin, drag to spin, scroll or pinch to zoom. With the keyboard, press Enter to drop a pin, arrow keys to move it (hold Shift for bigger steps), plus and minus to zoom, and 0 to see the whole globe."
          aria-describedby="globe-pin-status"
          aria-disabled={disabled || undefined}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          data-ready={ready || undefined}
          className="globe relative min-h-72 w-full flex-1 overflow-hidden rounded-lg bg-ocean-deep"
        />
        {!reveal && !failed && (
          <div className="globe-controls" role="group" aria-label="Globe view">
            <button type="button" onClick={zoomIn} aria-label="Zoom in" title="Zoom in">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M10 4v12M4 10h12" />
              </svg>
            </button>
            <button type="button" onClick={zoomOut} aria-label="Zoom out" title="Zoom out">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4 10h12" />
              </svg>
            </button>
            <button
              type="button"
              onClick={showWholeGlobe}
              aria-label="Show the whole globe"
              title="Show the whole globe"
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="10" cy="10" r="6.5" />
                <path d="M3.5 10h13M10 3.5c-2.2 2-2.2 11 0 13M10 3.5c2.2 2 2.2 11 0 13" />
              </svg>
            </button>
          </div>
        )}
      </div>
      <p
        id="globe-pin-status"
        aria-live="polite"
        className="tabular mt-2 font-sign text-lg tracking-wide text-chalk-dim"
      >
        {reveal
          ? `It was here: ${formatLngLat(reveal.truth)}`
          : pin
            ? `Your pin: ${formatLngLat(pin)}`
            : "Place your pin"}
      </p>
      {failed && (
        <p role="status" className="mt-1 text-sm text-chalk-dim">
          The globe could not load in this browser. You can still place a pin with the keyboard.
        </p>
      )}
    </div>
  );
}
