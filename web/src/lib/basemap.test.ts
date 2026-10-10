import { describe, expect, it } from "vitest";

import { BASEMAP_ATTRIBUTION, MAP_COLORS, buildGlobeStyle } from "./basemap";

describe("buildGlobeStyle", () => {
  const style = buildGlobeStyle();

  it("uses the globe projection", () => {
    expect(style.projection).toEqual({ type: "globe" });
  });

  it("is fully self-contained: no tile URLs, glyphs or sprites to fetch", () => {
    expect(style.glyphs).toBeUndefined();
    expect(style.sprite).toBeUndefined();
    for (const source of Object.values(style.sources)) {
      expect(source.type).toBe("geojson");
      expect(typeof (source as { data: unknown }).data).toBe("object");
    }
  });

  it("has no label layers, so the map never gives the answer away", () => {
    expect(style.layers.some((layer) => layer.type === "symbol")).toBe(false);
  });

  it("draws ocean, graticule, land and borders in that order", () => {
    expect(style.layers.map((layer) => layer.id)).toEqual([
      "ocean",
      "graticule",
      "land",
      "borders",
    ]);
  });

  it("paints the sea with the ocean design token", () => {
    const ocean = style.layers.find((layer) => layer.id === "ocean");
    expect(ocean?.paint).toEqual({ "background-color": MAP_COLORS.ocean });
  });

  it("decodes real land polygons from Natural Earth and credits them", () => {
    const land = style.sources.land as {
      data: { type: string; features: unknown[] };
      attribution: string;
    };
    expect(land.data.type).toBe("FeatureCollection");
    expect(land.data.features.length).toBeGreaterThan(0);
    expect(land.attribution).toBe(BASEMAP_ATTRIBUTION);
    expect(BASEMAP_ATTRIBUTION).toContain("Natural Earth");
  });
});
