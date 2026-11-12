import { describe, expect, it } from "vitest";

import {
  MIN_SEPARATION,
  VISION_KINDS,
  contrastRatio,
  linearRgb,
  oklab,
  seenDifference,
  separations,
  simulate,
} from "./colorVision";

describe("colour vision", () => {
  it("reads hex colours and refuses anything else", () => {
    expect(linearRgb("#000000")).toEqual([0, 0, 0]);
    expect(linearRgb("#ffffff")).toEqual([1, 1, 1]);
    expect(() => linearRgb("gold")).toThrow();
    expect(() => linearRgb("#fff")).toThrow();
  });

  it("leaves greys alone under every simulation, as the model does", () => {
    for (const kind of VISION_KINDS) {
      for (const grey of ["#000000", "#777777", "#ffffff"]) {
        const [r, g, b] = simulate(grey, kind);
        expect(Math.abs(r - g)).toBeLessThan(0.002);
        expect(Math.abs(g - b)).toBeLessThan(0.002);
      }
    }
  });

  it("puts white at L = 1 and black at L = 0 in OKLab", () => {
    expect(oklab([1, 1, 1])[0]).toBeCloseTo(1, 3);
    expect(oklab([1, 1, 1])[1]).toBeCloseTo(0, 3);
    expect(oklab([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("brings red and green together without red-green vision, but not without blue", () => {
    const typical = seenDifference("#d62728", "#2ca02c", "typical");
    expect(seenDifference("#d62728", "#2ca02c", "deuteranopia")).toBeLessThan(typical / 3);
    expect(seenDifference("#d62728", "#2ca02c", "protanopia")).toBeLessThan(typical * 0.7);
    expect(seenDifference("#d62728", "#2ca02c", "tritanopia")).toBeGreaterThan(typical / 2);
    // Blue and green are the pair tritanopia brings together.
    expect(seenDifference("#1f77b4", "#2ca02c", "tritanopia")).toBeLessThan(
      seenDifference("#1f77b4", "#2ca02c", "typical") / 2,
    );
  });

  it("names the closest-looking pair for each kind of vision", () => {
    const seps = separations(["#d62728", "#2ca02c", "#1f77b4"]);
    expect(seps.map((s) => s.kind)).toEqual(VISION_KINDS);
    expect(seps.find((s) => s.kind === "deuteranopia")?.pair).toEqual(["#d62728", "#2ca02c"]);
    expect(seps.every((s) => s.distance > 0)).toBe(true);
    expect(MIN_SEPARATION).toBeGreaterThan(0.02);
  });

  it("gives WCAG's contrast ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    // WCAG's own example: #767676 on white just passes 4.5:1.
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThan(4.5);
  });
});
