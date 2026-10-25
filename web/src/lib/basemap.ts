import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import countries110m from "world-atlas/countries-110m.json";

import { COUNTRY_ID_PROPERTY } from "./belief";
import { numericId } from "./countryIds";
import { graticule } from "./geo";

/**
 * Colors mirror the design tokens in globals.css (docs/design.md). MapLibre paints on a
 * canvas, so it needs literal values rather than CSS variables.
 */
export const MAP_COLORS = {
  ocean: "#0d3346",
  land: "#16495e",
  border: "#2a5b6e",
  graticule: "#2a5b6e",
  space: "#061a24",
  flare: "#ff5d8f",
  sonar: "#4fe3c1",
  gold: "#ffc53d",
} as const;

/** The fill layer that shades countries by Atlas's belief at the reveal (opacity 0 until then). */
export const BELIEF_LAYER = "belief";

export const BASEMAP_ATTRIBUTION =
  'Coastlines and borders: <a href="https://www.naturalearthdata.com/">Natural Earth</a> (public domain)';

/** The fill layer that marks countries in Country Streak: the player's pick and the answer. */
export const PICK_LAYER = "pick";
export const PICK_OPACITY = 0.5;

/** Countries to mark on the globe, as ISO alpha-2 codes. */
export type CountryMarks = { picked?: string | null; answer?: string | null };

/**
 * Paint for the pick layer: the player's pick in flare, the answer in gold (gold wins when they
 * are the same country), nothing else. No marks is plain 0 opacity.
 */
export function countryMarkPaint(marks: CountryMarks | null | undefined): {
  color: ExpressionSpecification | string;
  opacity: ExpressionSpecification | 0;
} {
  const answer = marks?.answer ? numericId(marks.answer) : undefined;
  const picked = marks?.picked ? numericId(marks.picked) : undefined;
  const ids = [...new Set([answer, picked].filter((id): id is string => !!id))];
  if (ids.length === 0) return { color: MAP_COLORS.flare, opacity: 0 };
  const colors: string[] = [];
  if (answer) colors.push(answer, MAP_COLORS.gold);
  if (picked && picked !== answer) colors.push(picked, MAP_COLORS.flare);
  const id = ["get", COUNTRY_ID_PROPERTY];
  return {
    color: ["match", id, ...colors, MAP_COLORS.flare] as unknown as ExpressionSpecification,
    opacity: ["match", id, ids, PICK_OPACITY, 0] as unknown as ExpressionSpecification,
  };
}

type CountryTopology = Topology<{ countries: GeometryCollection; land: GeometryCollection }>;

/**
 * A self-contained globe style: no tile server, no API key, no network requests. Land and
 * borders come from Natural Earth 1:110m (public domain) via the world-atlas package.
 * There are deliberately no labels, because place names would give the answer away.
 */
export function buildGlobeStyle(): StyleSpecification {
  const topology = countries110m as unknown as CountryTopology;
  const land = feature(topology, topology.objects.land);
  // Country polygons keyed by their ISO numeric id, for the reveal heatmap. Shapes without an
  // id (a few disputed areas in the 110m data) can't be named by Atlas, so they are left out.
  const countries = {
    type: "FeatureCollection" as const,
    features: feature(topology, topology.objects.countries).features.flatMap((f) =>
      f.id === undefined
        ? []
        : [{ ...f, id: undefined, properties: { [COUNTRY_ID_PROPERTY]: String(f.id) } }],
    ),
  };
  const borders = mesh(topology, topology.objects.countries, (a, b) => a !== b);

  return {
    version: 8,
    projection: { type: "globe" },
    sky: {
      "sky-color": MAP_COLORS.space,
      "horizon-color": MAP_COLORS.space,
      "atmosphere-blend": 0,
    },
    sources: {
      land: { type: "geojson", data: land, attribution: BASEMAP_ATTRIBUTION },
      countries: { type: "geojson", data: countries },
      borders: { type: "geojson", data: borders },
      graticule: { type: "geojson", data: graticule(30) },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": MAP_COLORS.ocean } },
      {
        id: "graticule",
        type: "line",
        source: "graticule",
        paint: { "line-color": MAP_COLORS.graticule, "line-width": 0.6, "line-opacity": 0.6 },
      },
      { id: "land", type: "fill", source: "land", paint: { "fill-color": MAP_COLORS.land } },
      {
        id: BELIEF_LAYER,
        type: "fill",
        source: "countries",
        paint: { "fill-color": MAP_COLORS.sonar, "fill-opacity": 0 },
      },
      {
        id: PICK_LAYER,
        type: "fill",
        source: "countries",
        paint: { "fill-color": MAP_COLORS.flare, "fill-opacity": 0 },
      },
      {
        id: "borders",
        type: "line",
        source: "borders",
        paint: { "line-color": MAP_COLORS.border, "line-width": 0.8 },
      },
    ],
  };
}
