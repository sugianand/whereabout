import type { ExpressionSpecification, SkySpecification, StyleSpecification } from "maplibre-gl";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import countries110m from "world-atlas/countries-110m.json";

import { COUNTRY_ID_PROPERTY } from "./belief";
import { numericId } from "./countryIds";
import { graticule } from "./geo";

/** The globe's two charts: night (the default) and day, which follows the site's light theme. */
export type GlobeLight = "night" | "day";

export type GlobePalette = {
  ocean: string;
  land: string;
  border: string;
  graticule: string;
  space: string;
  flare: string;
  sonar: string;
  gold: string;
};

/**
 * Colors mirror the design tokens in globals.css (docs/design.md). MapLibre paints on a
 * canvas, so it needs literal values rather than CSS variables.
 *
 * By day the sea is a pale chart blue and the land paper. The marks drawn on them (the
 * player's flare, Atlas's sonar, the answer's gold) are a deep crimson, a deep sea blue and an
 * ochre: each at least 3:1 against both the sea and the land, and each pair at least
 * `MIN_SEPARATION` apart under every simulated colour vision (basemap.test.ts). Darkening the
 * page's own daylight accents for the sea brought Atlas's teal and the answer's gold within
 * reach of each other without red vision, so the globe keeps its own three.
 */
export const GLOBE_PALETTES: Record<GlobeLight, GlobePalette> = {
  night: {
    ocean: "#0d3346",
    land: "#16495e",
    border: "#2a5b6e",
    graticule: "#2a5b6e",
    space: "#061a24",
    flare: "#ff5d8f",
    sonar: "#4fe3c1",
    gold: "#ffc53d",
  },
  day: {
    ocean: "#a9cfdc",
    land: "#f3eedd",
    border: "#8a9ea4",
    graticule: "#7fa9b8",
    space: "#f4f7f6",
    flare: "#8a002f",
    sonar: "#004a6e",
    gold: "#876508",
  },
};

/** The night chart: the app icon keeps it in either theme, and every globe on a dark page. */
export const MAP_COLORS = GLOBE_PALETTES.night;

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
export function countryMarkPaint(
  marks: CountryMarks | null | undefined,
  light: GlobeLight = "night",
): {
  color: ExpressionSpecification | string;
  opacity: ExpressionSpecification | 0;
} {
  const colours = GLOBE_PALETTES[light];
  const answer = marks?.answer ? numericId(marks.answer) : undefined;
  const picked = marks?.picked ? numericId(marks.picked) : undefined;
  const ids = [...new Set([answer, picked].filter((id): id is string => !!id))];
  if (ids.length === 0) return { color: colours.flare, opacity: 0 };
  const colors: string[] = [];
  if (answer) colors.push(answer, colours.gold);
  if (picked && picked !== answer) colors.push(picked, colours.flare);
  const id = ["get", COUNTRY_ID_PROPERTY];
  return {
    color: ["match", id, ...colors, colours.flare] as unknown as ExpressionSpecification,
    opacity: ["match", id, ids, PICK_OPACITY, 0] as unknown as ExpressionSpecification,
  };
}

type CountryTopology = Topology<{ countries: GeometryCollection; land: GeometryCollection }>;

/**
 * A self-contained globe style: no tile server, no API key, no network requests. Land and
 * borders come from Natural Earth 1:110m (public domain) via the world-atlas package.
 * There are deliberately no labels, because place names would give the answer away.
 */
export function buildGlobeStyle(light: GlobeLight = "night"): StyleSpecification {
  const colours = GLOBE_PALETTES[light];
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
    sky: globeSky(light),
    sources: {
      land: { type: "geojson", data: land, attribution: BASEMAP_ATTRIBUTION },
      countries: { type: "geojson", data: countries },
      borders: { type: "geojson", data: borders },
      graticule: { type: "geojson", data: graticule(30) },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": colours.ocean } },
      {
        id: "graticule",
        type: "line",
        source: "graticule",
        paint: { "line-color": colours.graticule, "line-width": 0.6, "line-opacity": 0.6 },
      },
      { id: "land", type: "fill", source: "land", paint: { "fill-color": colours.land } },
      {
        id: BELIEF_LAYER,
        type: "fill",
        source: "countries",
        paint: { "fill-color": colours.sonar, "fill-opacity": 0 },
      },
      {
        id: PICK_LAYER,
        type: "fill",
        source: "countries",
        paint: { "fill-color": colours.flare, "fill-opacity": 0 },
      },
      {
        id: "borders",
        type: "line",
        source: "borders",
        paint: { "line-color": colours.border, "line-width": 0.8 },
      },
    ],
  };
}

/** The sky around the globe: flat, in the chart's space colour. */
export function globeSky(light: GlobeLight): SkySpecification {
  const { space } = GLOBE_PALETTES[light];
  return { "sky-color": space, "horizon-color": space, "atmosphere-blend": 0 };
}

/** The colour of each reveal arc, by who made the guess: player flare, Atlas sonar, others gold. */
export function revealLineColor(light: GlobeLight = "night"): ExpressionSpecification {
  const { flare, sonar, gold } = GLOBE_PALETTES[light];
  return ["match", ["get", "actor"], "player", flare, "atlas", sonar, gold];
}

/** Every paint property the chart sets, so a live globe can be repainted in the other light. */
export type ChartPaint = [
  layer: string,
  property: "background-color" | "line-color" | "fill-color",
  value: string,
];

export function globePaint(light: GlobeLight): ChartPaint[] {
  const c = GLOBE_PALETTES[light];
  return [
    ["ocean", "background-color", c.ocean],
    ["graticule", "line-color", c.graticule],
    ["land", "fill-color", c.land],
    [BELIEF_LAYER, "fill-color", c.sonar],
    ["borders", "line-color", c.border],
  ];
}
