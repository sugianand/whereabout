import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import countries110m from "world-atlas/countries-110m.json";
import { describe, expect, it } from "vitest";

import { ALPHA2_TO_NUMERIC, numericId } from "./countryIds";

describe("alpha-2 to numeric country ids", () => {
  it.each([
    ["FR", "250"],
    ["US", "840"],
    ["JP", "392"],
    ["BR", "076"],
    ["IN", "356"],
    ["AU", "036"],
    ["ZA", "710"],
    ["GB", "826"],
    ["DE", "276"],
    ["CN", "156"],
    ["LA", "418"],
    ["GL", "304"],
  ])("%s is %s", (alpha2, numeric) => {
    expect(numericId(alpha2)).toBe(numeric);
  });

  it("ignores case and returns undefined for codes that have no numeric id", () => {
    expect(numericId("fr")).toBe("250");
    expect(numericId("XK")).toBeUndefined();
    expect(numericId("ZZ")).toBeUndefined();
  });

  it("has 249 distinct three-digit ids", () => {
    const ids = Object.values(ALPHA2_TO_NUMERIC);
    expect(ids).toHaveLength(249);
    expect(new Set(ids).size).toBe(249);
    expect(ids.every((id) => /^\d{3}$/.test(id))).toBe(true);
  });

  it("names every country the basemap can draw", () => {
    const topology = countries110m as unknown as Topology<{ countries: GeometryCollection }>;
    const ids = feature(topology, topology.objects.countries).features.flatMap((f) =>
      f.id === undefined ? [] : [String(f.id)],
    );
    expect(ids.length).toBeGreaterThan(150);
    const known = new Set(Object.values(ALPHA2_TO_NUMERIC));
    expect(ids.filter((id) => !known.has(id))).toEqual([]);
  });
});
