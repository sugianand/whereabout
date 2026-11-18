"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { GLOBE_PALETTES, buildGlobeStyle, paintChartNow, type GlobeLight } from "@/lib/basemap";
import type { Continent } from "@/lib/continents";
import { maplibreWorkerUrl } from "@/lib/maplibre-worker";
import type { TourRecord } from "@/lib/tour";
import { tourMap, type StopState } from "@/lib/tourMap";
import { useColorScheme } from "@/lib/useTheme";

import { INITIAL_VIEW } from "./Globe";

/**
 * The route's colours in each light: cleared legs in gold, the next in sonar, and the legs still
 * ahead in the page's dim chalk. Colour is never the only cue: cleared arcs are solid and the rest
 * dashed, a cleared stop is filled, the next one ringed and larger, and one ahead hollow.
 */
export const ROUTE_COLORS: Readonly<Record<GlobeLight, Readonly<Record<StopState, string>>>> = {
  night: {
    cleared: GLOBE_PALETTES.night.gold,
    next: GLOBE_PALETTES.night.sonar,
    ahead: "#a9c2c8",
  },
  day: {
    cleared: GLOBE_PALETTES.day.gold,
    next: GLOBE_PALETTES.day.sonar,
    ahead: "#405d68",
  },
};

/** How close the globe comes in on the next stop: its side of the world, with the legs either side. */
export const FOCUS_ZOOM = 1.2;
/** The flight to the next stop, unless the player asks for less motion. */
export const FLY_MS = 2200;

const ARCS = "tour-arcs";
const STOPS = "tour-stops";

function setData(map: MapLibreMap, id: string, data: unknown) {
  const source = map.getSource(id) as { setData(d: unknown): void } | undefined;
  source?.setData(data);
}

/** A MapLibre colour expression picking each feature's state colour. */
function byState(scheme: GlobeLight, flown: "flown" | "cleared") {
  const c = ROUTE_COLORS[scheme];
  return [
    "match",
    ["get", "state"],
    flown,
    c.cleared,
    "next",
    c.next,
    c.ahead,
  ] as unknown as string;
}

function addLayers(map: MapLibreMap, scheme: GlobeLight) {
  const empty = { type: "FeatureCollection" as const, features: [] };
  map.addSource(ARCS, { type: "geojson", data: empty });
  map.addSource(STOPS, { type: "geojson", data: empty });
  map.addLayer({
    id: "tour-arcs-ahead",
    type: "line",
    source: ARCS,
    filter: ["!=", ["get", "state"], "flown"],
    layout: { "line-cap": "round" },
    paint: {
      "line-color": byState(scheme, "flown"),
      "line-width": ["match", ["get", "state"], "next", 3.5, 1.5] as unknown as number,
      "line-opacity": ["match", ["get", "state"], "next", 1, 0.8] as unknown as number,
      "line-dasharray": [2, 2],
    },
  });
  map.addLayer({
    id: "tour-arcs-flown",
    type: "line",
    source: ARCS,
    filter: ["==", ["get", "state"], "flown"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": byState(scheme, "flown"), "line-width": 3.5 },
  });
  map.addLayer({
    id: "tour-stops",
    type: "circle",
    source: STOPS,
    paint: {
      "circle-radius": ["match", ["get", "state"], "next", 9, "cleared", 7, 6] as unknown as number,
      // A stop ahead is hollow: its fill is the sea's, its ring the dim chalk.
      "circle-color": [
        "match",
        ["get", "state"],
        "ahead",
        GLOBE_PALETTES[scheme].ocean,
        byState(scheme, "cleared"),
      ] as unknown as string,
      "circle-stroke-color": [
        "match",
        ["get", "state"],
        "ahead",
        ROUTE_COLORS[scheme].ahead,
        GLOBE_PALETTES[scheme].space,
      ] as unknown as string,
      "circle-stroke-width": 2.5,
    },
  });
}

/** Repaint the route in the other light, keeping the camera and the data. */
function paintRoute(map: MapLibreMap, scheme: GlobeLight) {
  paintChartNow(map, scheme);
  map.setPaintProperty("tour-arcs-ahead", "line-color", byState(scheme, "flown"));
  map.setPaintProperty("tour-arcs-flown", "line-color", byState(scheme, "flown"));
  map.setPaintProperty("tour-stops", "circle-color", [
    "match",
    ["get", "state"],
    "ahead",
    GLOBE_PALETTES[scheme].ocean,
    byState(scheme, "cleared"),
  ]);
  map.setPaintProperty("tour-stops", "circle-stroke-color", [
    "match",
    ["get", "state"],
    "ahead",
    ROUTE_COLORS[scheme].ahead,
    GLOBE_PALETTES[scheme].space,
  ]);
}

export interface TourGlobeProps {
  route: readonly Continent[];
  /** The tour as kept, or null until it has been read after hydration. */
  record: TourRecord | null;
}

/**
 * The World Tour's route on the globe: a stop on each continent joined by arcs in route order,
 * the cleared legs lit, flying to the next stop once the globe has loaded. The list of legs
 * below it says everything the globe shows, so the globe is a picture for sighted players and
 * the list serves keyboards and screen readers.
 */
export default function TourGlobe({ route, record }: TourGlobeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [flownTo, setFlownTo] = useState<string | null>(null);
  const scheme: GlobeLight = useColorScheme() === "light" ? "day" : "night";
  const schemeRef = useRef<GlobeLight>(scheme);
  const paintedRef = useRef<GlobeLight>(scheme);
  useLayoutEffect(() => {
    schemeRef.current = scheme;
  }, [scheme]);

  const drawn = tourMap(route, record ?? {});
  const lit = drawn.arcs.features.filter((a) => a.properties.state === "flown").length;
  const next = drawn.stops.features.find((s) => s.properties.state === "next")?.properties
    .continent;

  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    import("maplibre-gl")
      .then(({ Map, getVersion, setWorkerUrl }) => {
        if (cancelled || !containerRef.current) return;
        setWorkerUrl(maplibreWorkerUrl(getVersion()));
        paintedRef.current = schemeRef.current;
        map = new Map({
          container: containerRef.current,
          style: buildGlobeStyle(paintedRef.current),
          center: [INITIAL_VIEW.center.lng, INITIAL_VIEW.center.lat],
          zoom: INITIAL_VIEW.zoom,
          minZoom: 0.5,
          maxZoom: 6,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          maxPitch: 0,
          attributionControl: { compact: true },
        });
        map.touchZoomRotate.disableRotation();
        map.on("load", () => {
          if (cancelled || !map) return;
          addLayers(map, paintedRef.current);
          setReady(true);
        });
        mapRef.current = map;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // The route's data follows the record (it is read after hydration, so it can arrive late).
  const stopsJson = JSON.stringify(drawn.stops);
  const arcsJson = JSON.stringify(drawn.arcs);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !record) return;
    setData(map, STOPS, JSON.parse(stopsJson));
    setData(map, ARCS, JSON.parse(arcsJson));
  }, [stopsJson, arcsJson, ready, record]);

  // Fly to the next stop once, when the globe is ready and the record has been read.
  const focus = drawn.focus;
  const focusKey = record && focus ? `${focus.lng},${focus.lat}` : null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focusKey || flownTo === focusKey) return;
    const [lng, lat] = focusKey.split(",").map(Number);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) map.jumpTo({ center: [lng, lat], zoom: FOCUS_ZOOM });
    else map.flyTo({ center: [lng, lat], zoom: FOCUS_ZOOM, duration: FLY_MS });
    setFlownTo(focusKey);
  }, [focusKey, ready, flownTo]);

  // Colours (or the system) turned light or dark: repaint in place.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || paintedRef.current === scheme) return;
    paintRoute(map, scheme);
    paintedRef.current = scheme;
  }, [scheme, ready]);

  const label =
    route.length === 0
      ? "Globe of the World Tour"
      : `Globe of the World Tour's route: ${route.join(", then ")}. ${lit} of ${Math.max(route.length - 1, 0)} legs between them flown${next ? `; next stop ${next}` : ""}.`;

  return (
    <div className="relative mt-8 h-[46vh] min-h-72 overflow-hidden rounded-3xl border border-graticule bg-ocean-deep md:h-[28rem]">
      <div
        ref={containerRef}
        className="h-full w-full"
        role="group"
        aria-label={label}
        data-testid="tour-globe"
        data-light={scheme}
        data-ready={ready ? "true" : undefined}
        data-stops={ready && record ? drawn.stops.features.length : undefined}
        data-lit={ready && record ? lit : undefined}
        data-flown-to={flownTo && next ? next : undefined}
      />
      {failed && (
        <p className="absolute inset-x-0 top-1/2 px-6 text-center text-chalk-dim">
          This browser can&apos;t draw the globe, but every leg is listed below.
        </p>
      )}
      <ul
        className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-ocean-deep/80 px-3 py-2 text-xs"
        aria-hidden="true"
      >
        {(["cleared", "next", "ahead"] as const).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <svg width="22" height="10" viewBox="0 0 22 10">
              <line
                x1="1"
                x2="21"
                y1="5"
                y2="5"
                stroke={ROUTE_COLORS[scheme][s]}
                strokeWidth="2.5"
                strokeDasharray={s === "cleared" ? undefined : "4 4"}
              />
            </svg>
            {s === "cleared" ? "Cleared" : s === "next" ? "Next" : "Ahead"}
          </li>
        ))}
      </ul>
    </div>
  );
}
