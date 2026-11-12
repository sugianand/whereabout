"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import type { Map as MapLibreMap } from "maplibre-gl";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { MAP_COLORS, buildGlobeStyle } from "@/lib/basemap";
import { markImage, markShapeAt } from "@/lib/closenessMarks";
import { countryName } from "@/lib/countries";
import { CLOSENESS_KM, closenessOf, type Closeness } from "@/lib/feel";
import { formatDistance, formatPoints } from "@/lib/geo";
import type { Units } from "@/lib/units";
import { useUnits } from "@/lib/useUnits";
import { maplibreWorkerUrl } from "@/lib/maplibre-worker";
import {
  BANDS,
  loadPlayed,
  playedFeatures,
  summarizePlayed,
  type PlayedPhoto,
} from "@/lib/playedMap";

import ClosenessMark from "./ClosenessMark";
import ClosestCalls, { type ClosestCallsDeck } from "./ClosestCalls";
import ContinentForm from "./ContinentForm";
import WeeklyForm from "./WeeklyForm";
import { INITIAL_VIEW } from "./Globe";
import UnitsSwitch from "./UnitsSwitch";

/**
 * Each closeness band's colour: gold for a bullseye, then sonar and flare, cooling to periwinkle
 * far away. Each band also has its own shape (`lib/closenessMarks.ts`), and the colours stay
 * apart for protanopia, deuteranopia and tritanopia (checked in PlayedMap.test.tsx); the far
 * band was a grey that read as the flare pink without red-green vision.
 */
export const BAND_COLORS: Readonly<Record<Closeness, string>> = {
  bullseye: MAP_COLORS.gold,
  close: MAP_COLORS.sonar,
  near: MAP_COLORS.flare,
  far: "#8f9bff",
};

/** The edge round each globe mark, so it stands off land and sea alike. */
export const MARK_EDGE = "#082331";

/** The globe's marks are drawn at twice their size on screen, for sharp edges on any phone. */
const MARK_PIXEL_RATIO = 2;
const MARK_PIXELS = 40;

const markName = (b: Closeness) => `played-mark-${b}`;

const km = (n: number) => n.toLocaleString("en-US");

/** Each closeness in words, its distance in the player's units. */
export function bandLabel(band: Closeness, units: Units = "km"): string {
  return band === "far"
    ? "Further, or no pin"
    : `Within ${formatDistance(CLOSENESS_KM[band], units)}`;
}

/** Rounds listed before "Show all". */
export const LIST_FIRST = 12;

const SOURCE = "played";
const SELECTED_SOURCE = "played-selected";
const EMPTY = { type: "FeatureCollection" as const, features: [] };

function setData(map: MapLibreMap, id: string, data: unknown) {
  const source = map.getSource(id) as { setData(d: unknown): void } | undefined;
  source?.setData(data);
}

function addLayers(map: MapLibreMap) {
  map.addSource(SOURCE, { type: "geojson", data: EMPTY });
  map.addSource(SELECTED_SOURCE, { type: "geojson", data: EMPTY });
  // One shape per band, so the globe never says how close a pin was by colour alone.
  BANDS.forEach((b, i) =>
    map.addImage(
      markName(b),
      markImage(markShapeAt(i), BAND_COLORS[b], MARK_EDGE, MARK_PIXELS, 3),
      { pixelRatio: MARK_PIXEL_RATIO },
    ),
  );
  const icon = [
    "match",
    ["get", "band"],
    ...BANDS.flatMap((b) => [b, markName(b)]),
    markName("far"),
  ] as unknown as string;
  map.addLayer({
    id: "played-dots",
    type: "symbol",
    source: SOURCE,
    layout: {
      "icon-image": icon,
      // 12 px across with the whole globe in view, 20 px close in.
      "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 6, 1] as unknown as number,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
  map.addLayer({
    id: "played-selected",
    type: "circle",
    source: SELECTED_SOURCE,
    paint: {
      "circle-radius": 11,
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": MAP_COLORS.gold,
      "circle-stroke-width": 2.5,
    },
  });
}

/**
 * Your map: every photo you've played on the globe, a mark shaped and coloured by how close your pin
 * landed, with the countries and continents you've seen counted and your rounds listed newest
 * first. Picking a round in the list flies the globe to it. Everything comes from this browser
 * (`lib/playedMap.ts`), read after mount so the static page never guesses at it. With the
 * deck, the page also shows your closest calls (`ClosestCalls`).
 */
export default function PlayedMap({ deck }: { deck?: ClosestCallsDeck } = {}) {
  const [played, setPlayed] = useState<PlayedPhoto[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const units = useUnits();

  useEffect(() => {
    // Storage only exists in the browser, so the history is read once the page is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlayed(loadPlayed());
  }, []);

  const hasPlayed = !!played && played.length > 0;

  useEffect(() => {
    if (!hasPlayed) return;
    let cancelled = false;
    let map: MapLibreMap | null = null;
    import("maplibre-gl")
      .then(({ Map, getVersion, setWorkerUrl }) => {
        if (cancelled || !containerRef.current) return;
        setWorkerUrl(maplibreWorkerUrl(getVersion()));
        map = new Map({
          container: containerRef.current,
          style: buildGlobeStyle(),
          center: [INITIAL_VIEW.center.lng, INITIAL_VIEW.center.lat],
          zoom: INITIAL_VIEW.zoom,
          minZoom: 0.5,
          maxZoom: 9,
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          maxPitch: 0,
          attributionControl: { compact: true },
        });
        map.touchZoomRotate.disableRotation();
        map.on("load", () => {
          if (cancelled || !map) return;
          addLayers(map);
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
  }, [hasPlayed]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !played) return;
    setData(map, SOURCE, playedFeatures(played));
  }, [played, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !played) return;
    const photo = played.find((p) => p.id === selected);
    setData(map, SELECTED_SOURCE, photo ? playedFeatures([photo]) : EMPTY);
    if (photo) {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      map.easeTo({
        center: [photo.lng, photo.lat],
        zoom: Math.max(map.getZoom(), 3),
        duration: reduce ? 0 : 900,
      });
    }
  }, [selected, played, ready]);

  if (played === null) {
    return <p className="mt-10 text-chalk-dim">Reading your map…</p>;
  }

  if (!hasPlayed) {
    return (
      <div className="mt-10 max-w-xl">
        <p className="text-lg text-chalk-dim">
          Nothing on your map yet. Every photo you play lands here, marked by how close your pin
          got.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          Play a game
        </Link>
      </div>
    );
  }

  const summary = summarizePlayed(played);
  const newestFirst = [...played].reverse();
  const listed = showAll ? newestFirst : newestFirst.slice(0, LIST_FIRST);
  const plural = (n: number, one: string, many: string) => `${km(n)} ${n === 1 ? one : many}`;

  return (
    <>
      <dl className="mt-8 grid max-w-2xl grid-cols-3 gap-3" aria-label="Your map in numbers">
        {[
          ["Photos", summary.photos],
          ["Countries", summary.countries.length],
          ["Continents", summary.continents.length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-graticule px-4 py-3">
            <dt className="text-xs uppercase tracking-wider text-chalk-dim">{label}</dt>
            <dd className="font-sign text-3xl font-extrabold">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="relative mt-6 h-[60vh] min-h-80 overflow-hidden rounded-3xl border border-graticule bg-ocean-deep md:h-[34rem]">
        <div
          ref={containerRef}
          // Sized by height, not insets: MapLibre makes its container position: relative.
          className="h-full w-full"
          // A group, not an image: MapLibre puts focusable controls (zoom keys, credits) inside.
          role="group"
          aria-label={`Globe with the ${plural(summary.photos, "photo", "photos")} you've played, each marked by how close your pin landed`}
          data-testid="played-globe"
          data-dots={ready ? played.length : undefined}
        />
        {failed && (
          <p className="absolute inset-x-0 top-1/2 px-6 text-center text-chalk-dim">
            This browser can&apos;t draw the globe, but your rounds are listed below.
          </p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm" aria-label="Closeness">
          {BANDS.map((b) => (
            <li key={b} className="flex items-center gap-2">
              <ClosenessMark band={BANDS.indexOf(b)} color={BAND_COLORS[b]} />
              {bandLabel(b, units)}: <strong>{summary.bands[b]}</strong>
            </li>
          ))}
        </ul>
        <UnitsSwitch />
      </div>

      {deck && <ClosestCalls played={played} deck={deck} />}

      <ContinentForm played={played} regions={deck?.regions ?? {}} />

      <WeeklyForm played={played} />

      <section className="mt-12 grid gap-10 md:grid-cols-[1fr_1.4fr]">
        <div>
          <h2 className="font-sign text-3xl font-extrabold">Countries you&apos;ve seen</h2>
          <p className="mt-1 text-sm text-chalk-dim">
            {plural(summary.countries.length, "country", "countries")} on{" "}
            {plural(summary.continents.length, "continent", "continents")}
            {summary.continents.length > 0 && `: ${summary.continents.join(", ")}`}
          </p>
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Countries you've seen">
            {summary.countries.map((c) => (
              <li
                key={c.code}
                className="rounded-full border border-graticule px-3 py-1 text-sm"
                title={plural(c.photos, "photo", "photos")}
              >
                {countryName(c.code)}
                {c.photos > 1 && <span className="ml-1.5 text-chalk-dim">×{c.photos}</span>}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="font-sign text-3xl font-extrabold">Your rounds</h2>
          <p className="mt-1 text-sm text-chalk-dim">
            Newest first, your latest try on each photo. Pick one to find it on the globe.
          </p>
          <ol className="mt-4 divide-y divide-graticule" aria-label="Your rounds">
            {listed.map((p) => {
              const band = closenessOf(p.km);
              const isSelected = p.id === selected;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(p.id)}
                    aria-pressed={isSelected}
                    className={`flex w-full items-center gap-3 py-3 text-left transition hover:text-gold ${isSelected ? "text-gold" : ""}`}
                  >
                    <ClosenessMark band={BANDS.indexOf(band)} color={BAND_COLORS[band]} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{p.place}</span>
                      <span className="block text-xs text-chalk-dim">
                        {p.km === null ? "No pin" : `${formatDistance(p.km, units)} off`} ·{" "}
                        {formatPoints(p.score)} points · {p.day}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {!showAll && newestFirst.length > LIST_FIRST && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-3 rounded-full border border-chalk/30 px-4 py-2 text-sm font-semibold transition hover:border-chalk"
            >
              Show all {km(newestFirst.length)}
            </button>
          )}
        </div>
      </section>
    </>
  );
}
