import { describe, expect, it } from "vitest";

import type { AtlasLooked } from "@/lib/game/types";

import { describeHotspot, hotspot, isValidLooked } from "./looked";

/** A 3×3 map with all importance in one cell. */
function oneHot(cell: number, grid = 3): AtlasLooked {
  const cells = Array.from({ length: grid * grid }, (_, i) => (i === cell ? 1 : 0));
  return { grid, crop: [0, 0, 1, 1], cells };
}

describe("hotspot", () => {
  it("is the importance-weighted centre of the map", () => {
    expect(hotspot(oneHot(0))).toEqual({ x: 1 / 6, y: 1 / 6 });
    const two = { grid: 2, crop: [0, 0, 1, 1], cells: [1, 1, 0, 0] } as AtlasLooked;
    expect(hotspot(two)).toEqual({ x: 0.5, y: 0.25 });
    expect(hotspot({ ...two, cells: [0, 0, 0, 0] })).toBeNull();
  });
});

describe("describeHotspot", () => {
  it("names the region in plain words", () => {
    expect(describeHotspot(oneHot(0))).toBe("the top left");
    expect(describeHotspot(oneHot(1))).toBe("the top");
    expect(describeHotspot(oneHot(4))).toBe("the middle");
    expect(describeHotspot(oneHot(5))).toBe("the right side");
    expect(describeHotspot(oneHot(8))).toBe("the bottom right");
    expect(describeHotspot(oneHot(7))).toBe("the bottom");
    expect(describeHotspot({ ...oneHot(0), cells: Array(9).fill(0) })).toBeNull();
  });
});

describe("isValidLooked", () => {
  it("accepts a well-formed map and rejects broken ones", () => {
    expect(isValidLooked(oneHot(3))).toBe(true);
    expect(isValidLooked({ ...oneHot(3), cells: [1, 0] })).toBe(false);
    expect(isValidLooked({ ...oneHot(3), cells: [2, 0, 0, 0, 0, 0, 0, 0, 0] })).toBe(false);
    expect(isValidLooked({ ...oneHot(3), crop: [0.5, 0, 0.75, 1] })).toBe(false);
    expect(isValidLooked({ ...oneHot(3), grid: 0, cells: [] })).toBe(false);
    expect(isValidLooked({ ...oneHot(3), crop: [0, 0, 1] })).toBe(false);
  });
});
