"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { MAP_COLORS, buildGlobeStyle } from "@/lib/basemap";
import type { RoundResult } from "@/lib/game/state";
import {
  TOUR_FINALE_MS,
  TOUR_FLY_MS,
  TOUR_HOLD_MS,
  gameCamera,
  initialTour,
  stopCamera,
  tourLines,
  tourReducer,
  tourStops,
  type TourStop,
  type TourLines,
} from "@/lib/gameTour";
import { formatDistance } from "@/lib/geo";
import { maplibreWorkerUrl } from "@/lib/maplibre-worker";
import { easeOut } from "@/lib/reveal";
import type { Units } from "@/lib/units";
import { useUnits } from "@/lib/useUnits";

import { INITIAL_VIEW, NO_PADDING, createPinElement } from "./Globe";

const LINES = "tour-lines";
const PINS = "tour-pins";
const EMPTY = { type: "FeatureCollection" as const, features: [] };

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

function setData(map: MapLibreMap, id: string, data: unknown) {
  const source = map.getSource(id) as { setData(d: unknown): void } | undefined;
  source?.setData(data);
}

function addLayers(map: MapLibreMap) {
  const color = [
    "match",
    ["get", "actor"],
    "player",
    MAP_COLORS.flare,
    "atlas",
    MAP_COLORS.sonar,
    MAP_COLORS.gold,
  ] as unknown as string;
  map.addSource(LINES, { type: "geojson", data: EMPTY });
  map.addSource(PINS, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: "tour-glow",
    type: "line",
    source: LINES,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": color, "line-width": 8, "line-opacity": 0.2, "line-blur": 4 },
  });
  map.addLayer({
    id: "tour-line",
    type: "line",
    source: LINES,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": color, "line-width": 2.25 },
  });
  map.addLayer({
    id: "tour-pins",
    type: "circle",
    source: PINS,
    paint: {
      "circle-color": color,
      "circle-radius": 4.5,
      "circle-stroke-color": MAP_COLORS.space,
      "circle-stroke-width": 1.5,
    },
  });
}

/** Where each drawn round's guesses landed, as small dots in their actor's colour. */
function pinFeatures(stops: readonly TourStop[], visited: number) {
  return {
    type: "FeatureCollection" as const,
    features: stops.slice(0, visited).flatMap((s) =>
      s.view.guesses.map((g) => ({
        type: "Feature" as const,
        properties: { actor: g.actor, round: s.index },
        geometry: { type: "Point" as const, coordinates: [g.at.lng, g.at.lat] },
      })),
    ),
  };
}

/** "Round 2 of 5: Kyoto, Japan. You were 120 km away; Atlas 3,400 km." */
export function stopCaption(stop: TourStop, rounds: number, units: Units): string {
  const you =
    stop.playerKm === null
      ? "No pin this round"
      : `You were ${formatDistance(stop.playerKm, units)} away`;
  const atlas = stop.atlasKm === null ? "" : `; Atlas ${formatDistance(stop.atlasKm, units)}`;
  return `Round ${stop.index + 1} of ${rounds}: ${stop.place}. ${you}${atlas}.`;
}

/** "All five rounds at once." */
export function wholeGameCaption(rounds: number): string {
  if (rounds === 1) return "Your one round on the globe.";
  const words = ["two", "three", "four", "five"];
  return `All ${words[rounds - 2] ?? rounds} rounds at once.`;
}

/**
 * The game in one picture, at the top of the summary: the globe flies from round to round,
 * drawing each round's arcs (your pin's and Atlas's) as it lands and dropping a numbered gold
 * pin on the answer, then pulls back to every round at once. The round buttons below jump to a
 * round, and *Fly through again* replays the tour. With reduced motion, or when the player
 * comes back from looking at a round, it opens on the whole game. The globe only shows, it
 * takes no taps, so it never traps a scroll on a phone.
 */
export default function GameTour({
  results,
  autoplay = true,
}: {
  results: readonly RoundResult[];
  /** Fly through the rounds on arrival; false opens on the whole game. */
  autoplay?: boolean;
}) {
  const stops = useMemo(() => tourStops(results), [results]);
  const rounds = stops.length;
  const reducer = useMemo(() => tourReducer(rounds), [rounds]);
  const [tour, dispatch] = useReducer(reducer, undefined, () =>
    initialTour(rounds, autoplay && !prefersReducedMotion()),
  );
  const units = useUnits();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerClassRef = useRef<typeof Marker | null>(null);
  const truthMarkersRef = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    import("maplibre-gl")
      .then(({ Map, Marker, getVersion, setWorkerUrl }) => {
        if (cancelled || !containerRef.current) return;
        setWorkerUrl(maplibreWorkerUrl(getVersion()));
        map = new Map({
          container: containerRef.current,
          style: buildGlobeStyle(),
          center: [INITIAL_VIEW.center.lng, INITIAL_VIEW.center.lat],
          zoom: INITIAL_VIEW.zoom,
          interactive: false,
          attributionControl: { compact: true },
        });
        map.on("load", () => {
          if (cancelled || !map) return;
          addLayers(map);
          setReady(true);
        });
        mapRef.current = map;
        markerClassRef.current = Marker;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      for (const m of truthMarkersRef.current) m.remove();
      truthMarkersRef.current = [];
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Paint the tour: the camera, the arcs (the round being flown to draws in as the camera
  // moves), the guess dots and a numbered gold pin on every drawn round's answer.
  const { at, visited, playing } = tour;
  useEffect(() => {
    const map = mapRef.current;
    const MarkerClass = markerClassRef.current;
    if (!map || !MarkerClass || !ready) return;
    const reduce = prefersReducedMotion();

    map.resize();
    const el = containerRef.current;
    const framePx = Math.min(el?.clientWidth || 600, el?.clientHeight || 400);
    const camera = at === "all" ? gameCamera(stops, framePx) : stopCamera(stops[at], framePx);
    const target = {
      center: [camera.center.lng, camera.center.lat] as [number, number],
      zoom: camera.zoom,
      padding: NO_PADDING,
      bearing: 0,
      pitch: 0,
    };
    if (reduce) map.jumpTo(target);
    else map.flyTo({ ...target, duration: at === "all" ? TOUR_FINALE_MS : TOUR_FLY_MS });
    if (el) el.dataset.zoom = camera.zoom.toFixed(2);

    // Pins already standing stay put, so only a newly reached answer plays the drop.
    const drawTruths = (upTo: number) => {
      const markers = truthMarkersRef.current;
      while (markers.length > upTo) markers.pop()?.remove();
      for (const s of stops.slice(markers.length, upTo)) {
        markers.push(
          new MarkerClass({
            element: createPinElement("truth", String(s.index + 1)),
            anchor: "bottom",
          })
            .setLngLat([s.truth.lng, s.truth.lat])
            .addTo(map),
        );
      }
    };
    setData(map, PINS, pinFeatures(stops, visited));

    // While touring, the round being flown to draws its arcs, then its answer pin drops.
    const drawing = playing && at !== "all" && !reduce ? at : null;
    if (drawing === null || typeof requestAnimationFrame === "undefined") {
      setData(map, LINES, tourLines(stops, visited));
      drawTruths(visited);
      return;
    }
    drawTruths(drawing);
    let frame = 0;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const t = (now - start) / TOUR_FLY_MS;
      setData(map, LINES, tourLines(stops, visited, drawing, easeOut(t)) satisfies TourLines);
      if (t < 1) frame = requestAnimationFrame(step);
      else drawTruths(visited);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [at, visited, playing, ready, stops]);

  // The tour moves itself on: each round's flight and hold, then the pull-back.
  useEffect(() => {
    if (!playing || !ready) return;
    const timer = setTimeout(() => dispatch({ type: "advance" }), TOUR_FLY_MS + TOUR_HOLD_MS);
    return () => clearTimeout(timer);
  }, [playing, ready, at]);

  if (failed || rounds === 0) return null;

  const caption = at === "all" ? wholeGameCaption(rounds) : stopCaption(stops[at], rounds, units);

  return (
    <section
      aria-label="Your game on the globe"
      data-testid="game-tour"
      data-stop={at === "all" ? "all" : at + 1}
      data-playing={playing || undefined}
      className="mt-8"
    >
      <div
        ref={containerRef}
        aria-hidden="true"
        data-ready={ready || undefined}
        className="globe relative h-64 w-full overflow-hidden rounded-2xl border border-graticule/60 bg-ocean-deep sm:h-80"
      />
      <p aria-live="polite" className="mt-3 min-h-12 text-chalk sm:min-h-6">
        {caption}
      </p>
      <div
        className="mt-3 flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Show on the globe"
      >
        {stops.map((s) => (
          <button
            key={s.index}
            type="button"
            aria-pressed={at === s.index}
            aria-label={`Show round ${s.index + 1}, ${s.place}, on the globe`}
            onClick={() => dispatch({ type: "show", at: s.index })}
            className="grid size-10 place-items-center rounded-full border border-gold/50 font-sign text-lg font-bold text-gold transition hover:border-gold aria-pressed:bg-gold aria-pressed:text-ocean-deep"
          >
            {s.index + 1}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={at === "all"}
          onClick={() => dispatch({ type: "show", at: "all" })}
          className="h-10 rounded-full border border-gold/50 px-4 font-semibold text-gold transition hover:border-gold aria-pressed:bg-gold aria-pressed:text-ocean-deep"
        >
          Whole game
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "replay" })}
          disabled={playing}
          className="h-10 rounded-full px-3 text-sm text-chalk-dim underline underline-offset-2 transition hover:text-chalk disabled:no-underline disabled:opacity-60"
        >
          {playing ? "Flying…" : "Fly through again"}
        </button>
      </div>
    </section>
  );
}
