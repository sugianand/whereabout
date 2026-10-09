import type { StyleSpecification } from "maplibre-gl";
import { feature, mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import countries110m from "world-atlas/countries-110m.json";

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
} as const;

export const BASEMAP_ATTRIBUTION =
  'Coastlines and borders: <a href="https://www.naturalearthdata.com/">Natural Earth</a> (public domain)';

type CountryTopology = Topology<{ countries: GeometryCollection; land: GeometryCollection }>;

/**
 * A self-contained globe style: no tile server, no API key, no network requests. Land and
 * borders come from Natural Earth 1:110m (public domain) via the world-atlas package.
 * There are deliberately no labels, because place names would give the answer away.
 */
export function buildGlobeStyle(): StyleSpecification {
  const topology = countries110m as unknown as CountryTopology;
  const land = feature(topology, topology.objects.land);
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
        id: "borders",
        type: "line",
        source: "borders",
        paint: { "line-color": MAP_COLORS.border, "line-width": 0.8 },
      },
    ],
  };
}
