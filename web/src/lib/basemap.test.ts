import { describe, expect, it } from "vitest";

import {
  BASEMAP_ATTRIBUTION,
  BELIEF_LAYER,
  MAP_COLORS,
  PICK_LAYER,
  PICK_OPACITY,
  buildGlobeStyle,
  countryMarkPaint,
} from "./basemap";

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
      "belief",
      "pick",
      "borders",
    ]);
  });

  it("has a Country Streak pick layer over the countries, invisible until a pick", () => {
    const pick = style.layers.find((layer) => layer.id === PICK_LAYER);
    expect(pick).toMatchObject({ type: "fill", source: "countries" });
    expect(pick?.paint).toMatchObject({ "fill-opacity": 0 });
  });

  it("has a belief layer in the Atlas colour, invisible until the reveal sets it", () => {
    const belief = style.layers.find((layer) => layer.id === BELIEF_LAYER);
    expect(belief?.type).toBe("fill");
    expect(belief?.paint).toEqual({ "fill-color": MAP_COLORS.sonar, "fill-opacity": 0 });
    const source = style.sources.countries as unknown as {
      data: { features: { properties: { n: string } }[] };
    };
    const ids = source.data.features.map((f) => f.properties.n);
    expect(ids).toContain("250"); // France
    expect(ids.every((id) => /^\d{3}$/.test(id))).toBe(true);
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

describe("countryMarkPaint", () => {
  const n = ["get", "n"];

  it("paints nothing without marks", () => {
    expect(countryMarkPaint(null).opacity).toBe(0);
    expect(countryMarkPaint({ picked: null, answer: null }).opacity).toBe(0);
    // A code with no shape on the globe has nothing to paint either.
    expect(countryMarkPaint({ picked: "ZZ" }).opacity).toBe(0);
  });

  it("paints the pick in the player's colour", () => {
    expect(countryMarkPaint({ picked: "FR" })).toEqual({
      color: ["match", n, "250", MAP_COLORS.flare, MAP_COLORS.flare],
      opacity: ["match", n, ["250"], PICK_OPACITY, 0],
    });
  });

  it("paints the answer gold next to a wrong pick", () => {
    expect(countryMarkPaint({ picked: "FR", answer: "ES" })).toEqual({
      color: ["match", n, "724", MAP_COLORS.gold, "250", MAP_COLORS.flare, MAP_COLORS.flare],
      opacity: ["match", n, ["724", "250"], PICK_OPACITY, 0],
    });
  });

  it("paints a right pick gold only", () => {
    expect(countryMarkPaint({ picked: "FR", answer: "FR" })).toEqual({
      color: ["match", n, "250", MAP_COLORS.gold, MAP_COLORS.flare],
      opacity: ["match", n, ["250"], PICK_OPACITY, 0],
    });
  });
});
