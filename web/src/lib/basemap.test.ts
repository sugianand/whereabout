import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BASEMAP_ATTRIBUTION,
  BELIEF_LAYER,
  GLOBE_PALETTES,
  MAP_COLORS,
  PICK_LAYER,
  PICK_OPACITY,
  buildGlobeStyle,
  countryMarkPaint,
  globePaint,
  globeSky,
  revealLineColor,
  type GlobeLight,
} from "./basemap";
import { MIN_SEPARATION, VISION_KINDS, contrastRatio, seenDifference } from "./colorVision";

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

describe("the globe by day", () => {
  const day = buildGlobeStyle("day");
  const paintOf = (style: typeof day, id: string) =>
    style.layers.find((layer) => layer.id === id)?.paint as Record<string, unknown>;

  it("is the night chart by default, and the same layers in daylight colours", () => {
    expect(buildGlobeStyle()).toEqual(buildGlobeStyle("night"));
    expect(MAP_COLORS).toBe(GLOBE_PALETTES.night);
    expect(day.layers.map((l) => l.id)).toEqual(buildGlobeStyle().layers.map((l) => l.id));
    expect(paintOf(day, "ocean")).toEqual({ "background-color": GLOBE_PALETTES.day.ocean });
    expect(paintOf(day, "land")).toEqual({ "fill-color": GLOBE_PALETTES.day.land });
    expect(paintOf(day, "borders")["line-color"]).toBe(GLOBE_PALETTES.day.border);
    expect(paintOf(day, "graticule")["line-color"]).toBe(GLOBE_PALETTES.day.graticule);
    expect(paintOf(day, BELIEF_LAYER)["fill-color"]).toBe(GLOBE_PALETTES.day.sonar);
    expect(day.sky).toEqual(globeSky("day"));
    expect(globeSky("day")["sky-color"]).toBe(GLOBE_PALETTES.day.space);
  });

  it("repaints exactly what the style paints, so a live switch matches a fresh load", () => {
    for (const light of ["night", "day"] as GlobeLight[]) {
      const style = buildGlobeStyle(light);
      for (const [layer, property, value] of globePaint(light)) {
        expect(paintOf(style, layer)?.[property], `${light} ${layer}`).toEqual(value);
      }
      // Every colour the style sets is in the repaint list.
      const colours = style.layers.flatMap((l) =>
        Object.keys(l.paint ?? {})
          .filter((p) => p.endsWith("-color"))
          .map((p) => `${l.id} ${p}`),
      );
      const repainted = globePaint(light).map(([layer, property]) => `${layer} ${property}`);
      // The pick layer's colour comes from countryMarkPaint with the marks.
      expect(colours.filter((c) => !c.startsWith(PICK_LAYER))).toEqual(
        expect.arrayContaining(repainted),
      );
      expect(repainted).toEqual(
        expect.arrayContaining(colours.filter((c) => !c.startsWith(PICK_LAYER))),
      );
    }
  });

  it("colours the arcs and marks with the light's own accents", () => {
    const { flare, sonar, gold } = GLOBE_PALETTES.day;
    expect(revealLineColor("day")).toEqual([
      "match",
      ["get", "actor"],
      "player",
      flare,
      "atlas",
      sonar,
      gold,
    ]);
    expect(countryMarkPaint({ picked: "FR", answer: "ES" }, "day").color).toEqual([
      "match",
      ["get", "n"],
      "724",
      gold,
      "250",
      flare,
      flare,
    ]);
  });

  it("keeps every pin, arc and mark at 3:1 or better against both the sea and the land", () => {
    for (const light of ["night", "day"] as GlobeLight[]) {
      const c = GLOBE_PALETTES[light];
      for (const mark of ["flare", "sonar", "gold"] as const) {
        for (const ground of ["ocean", "land"] as const) {
          expect(
            contrastRatio(c[mark], c[ground]),
            `${light} ${mark} on ${ground}`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it("keeps the player, Atlas and the answer apart in every kind of colour vision", () => {
    for (const light of ["night", "day"] as GlobeLight[]) {
      const { flare, sonar, gold } = GLOBE_PALETTES[light];
      for (const kind of VISION_KINDS) {
        for (const [a, b] of [
          [flare, sonar],
          [flare, gold],
          [sonar, gold],
        ]) {
          expect(seenDifference(a, b, kind), `${light} ${a} ${b} ${kind}`).toBeGreaterThanOrEqual(
            MIN_SEPARATION,
          );
        }
      }
    }
  });

  it("shows the globe against its sky, and land against the sea", () => {
    const c = GLOBE_PALETTES.day;
    expect(contrastRatio(c.ocean, c.space)).toBeGreaterThan(1.4);
    expect(contrastRatio(c.land, c.ocean)).toBeGreaterThan(1.4);
    expect(contrastRatio(c.border, c.land)).toBeGreaterThan(2);
  });

  it("matches the pins' colours in globals.css to the canvas's", () => {
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
    const block = css.match(/\.globe\[data-light="day"\] \{([^}]*)\}/)?.[1] ?? "";
    for (const accent of ["flare", "sonar", "gold"] as const) {
      expect(block).toContain(`--color-${accent}: ${GLOBE_PALETTES.day[accent]}`);
    }
  });
});
