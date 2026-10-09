"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { buildGlobeStyle } from "@/lib/basemap";
import { formatLngLat, normalize, nudge, type Direction, type LngLat } from "@/lib/geo";
import { maplibreWorkerUrl } from "@/lib/maplibre-worker";

export type GlobeProps = {
  /** The player's pin, or null before they have placed one. */
  pin: LngLat | null;
  /** Called with the new location whenever the player places or moves the pin. */
  onPinChange: (pin: LngLat) => void;
  /** Disable pin placement, e.g. while a guess is being scored. */
  disabled?: boolean;
  className?: string;
};

const ARROW_KEYS: Record<string, Direction> = {
  ArrowUp: "north",
  ArrowDown: "south",
  ArrowLeft: "west",
  ArrowRight: "east",
};

/** Degrees moved per arrow key press; Shift moves ten times as far. */
export const KEY_STEP_DEGREES = 1;
export const KEY_STEP_LARGE_DEGREES = 10;

export const INITIAL_VIEW = { center: { lng: 10, lat: 20 } satisfies LngLat, zoom: 1.4 };

function createPinElement(): HTMLElement {
  // MapLibre positions the outer element with its own `transform`, so the drop shape is
  // drawn by an inner element that can be rotated freely.
  const el = document.createElement("div");
  el.className = "globe-pin";
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
export default function Globe({ pin, onPinChange, disabled = false, className }: GlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const markerClassRef = useRef<typeof Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // The map is created once; these refs let its event handlers see the latest props.
  const onPinChangeRef = useRef(onPinChange);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    onPinChangeRef.current = onPinChange;
    disabledRef.current = disabled;
  }, [onPinChange, disabled]);

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;

    // MapLibre touches `window` on import, so load it only in the browser.
    import("maplibre-gl")
      .then(({ Map, Marker, getVersion, setWorkerUrl }) => {
        if (cancelled || !containerRef.current) return;
        setWorkerUrl(maplibreWorkerUrl(getVersion()));
        map = new Map({
          container: containerRef.current,
          style: buildGlobeStyle(),
          center: [INITIAL_VIEW.center.lng, INITIAL_VIEW.center.lat],
          zoom: INITIAL_VIEW.zoom,
          minZoom: 0.5,
          maxZoom: 9,
          // Keyboard play is handled by the wrapper so it can move the pin, not just the camera.
          keyboard: false,
          attributionControl: { compact: true },
        });
        map.on("click", (event) => {
          if (disabledRef.current) return;
          onPinChangeRef.current(normalize({ lng: event.lngLat.lng, lat: event.lngLat.lat }));
        });
        map.on("load", () => {
          if (!cancelled) setReady(true);
        });
        mapRef.current = map;
        markerClassRef.current = Marker;
      })
      .catch(() => {
        // Most often: the browser has no WebGL. Keyboard placement still works without it.
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      markerRef.current?.remove();
      markerRef.current = null;
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

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const map = mapRef.current;
    const direction = ARROW_KEYS[event.key];

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      map?.zoomIn();
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      map?.zoomOut();
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
      <div
        ref={containerRef}
        role="application"
        aria-roledescription="globe"
        aria-label="Globe. Click to place your pin. With the keyboard, press Enter to drop a pin, arrow keys to move it (hold Shift for bigger steps), plus and minus to zoom."
        aria-describedby="globe-pin-status"
        aria-disabled={disabled || undefined}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        data-ready={ready || undefined}
        className="globe relative min-h-72 w-full flex-1 overflow-hidden rounded-lg bg-ocean-deep"
      />
      <p
        id="globe-pin-status"
        aria-live="polite"
        className="tabular mt-2 font-sign text-lg tracking-wide text-chalk-dim"
      >
        {pin ? `Your pin: ${formatLngLat(pin)}` : "Place your pin"}
      </p>
      {failed && (
        <p role="status" className="mt-1 text-sm text-chalk-dim">
          The globe could not load in this browser. You can still place a pin with the keyboard.
        </p>
      )}
    </div>
  );
}
