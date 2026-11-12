import { describe, expect, it } from "vitest";

import {
  MARK_SHAPES,
  markGeometry,
  markImage,
  markShapeAt,
  signedDistance,
  svgPoints,
  type MarkPixels,
} from "./closenessMarks";

/** The share of a mark's square that is opaque, and that is painted the fill colour. */
function coverage(img: MarkPixels, fill: [number, number, number]) {
  let opaque = 0;
  let filled = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] > 127) opaque += 1;
    if (img.data[i + 3] === 255 && fill.every((c, k) => img.data[i + k] === c)) filled += 1;
  }
  const n = img.width * img.height;
  return { opaque: opaque / n, filled: filled / n };
}

/** The opaque pixels as a string of 0s and 1s, to tell two shapes' silhouettes apart. */
const silhouette = (img: MarkPixels) =>
  Array.from({ length: img.width * img.height }, (_, i) =>
    img.data[i * 4 + 3] > 127 ? 1 : 0,
  ).join("");

describe("closeness marks", () => {
  it("has four different shapes, closest first, and clamps anything past them", () => {
    expect(MARK_SHAPES).toEqual(["circle", "diamond", "triangle", "cross"]);
    expect(new Set(MARK_SHAPES).size).toBe(4);
    expect(markShapeAt(0)).toBe("circle");
    expect(markShapeAt(3)).toBe("cross");
    expect(markShapeAt(9)).toBe("cross");
    expect(markShapeAt(-1)).toBe("circle");
  });

  it("keeps every shape inside its box", () => {
    for (const shape of MARK_SHAPES) {
      const g = markGeometry(shape, 50, 50, 10);
      if (g.kind === "circle") {
        expect(g.r).toBeLessThanOrEqual(10);
      } else {
        for (const [x, y] of g.points) {
          expect(Math.abs(x - 50)).toBeLessThanOrEqual(10.0001);
          expect(Math.abs(y - 50)).toBeLessThanOrEqual(10.0001);
        }
      }
    }
  });

  it("measures the distance to each shape's edge, negative inside", () => {
    const circle = markGeometry("circle", 0, 0, 10);
    expect(signedDistance(circle, [0, 0])).toBeCloseTo(-8.2, 5);
    expect(signedDistance(circle, [20, 0])).toBeCloseTo(11.8, 5);
    const diamond = markGeometry("diamond", 0, 0, 10);
    expect(signedDistance(diamond, [0, 0])).toBeCloseTo(-10 / Math.SQRT2, 5);
    expect(signedDistance(diamond, [0, 12])).toBeCloseTo(2, 5);
    // The cross is hollow between its arms: the middle of each side is outside it.
    const cross = markGeometry("cross", 0, 0, 10);
    expect(signedDistance(cross, [0, 0])).toBeLessThan(0);
    expect(signedDistance(cross, [0, 9])).toBeGreaterThan(0);
    expect(signedDistance(cross, [6, 6])).toBeLessThan(0);
  });

  it("writes SVG points rounded to a thousandth", () => {
    expect(
      svgPoints([
        [1, 2],
        [3.14159, -0.5],
      ]),
    ).toBe("1,2 3.142,-0.5");
  });

  it("rasterises each shape with its fill, an edge and transparent corners", () => {
    for (const shape of MARK_SHAPES) {
      const img = markImage(shape, "#ffc53d", "#082331", 40, 3);
      expect(img.width).toBe(40);
      expect(img.data).toHaveLength(40 * 40 * 4);
      expect(img.data[3]).toBe(0);
      const { opaque, filled } = coverage(img, [0xff, 0xc5, 0x3d]);
      expect(opaque).toBeGreaterThan(0.2);
      expect(filled).toBeGreaterThan(0.05);
      expect(filled).toBeLessThan(opaque);
    }
    // The circle's centre is the fill colour.
    const c = markImage("circle", "#ffc53d", "#082331", 40, 3);
    const mid = (20 * 40 + 20) * 4;
    expect(Array.from(c.data.slice(mid, mid + 4))).toEqual([0xff, 0xc5, 0x3d, 255]);
  });

  it("gives every shape its own silhouette, so the shapes differ without colour", () => {
    const shapes = MARK_SHAPES.map((s) => silhouette(markImage(s, "#ffffff", "#000000", 24, 2)));
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        let differ = 0;
        for (let k = 0; k < shapes[i].length; k++) if (shapes[i][k] !== shapes[j][k]) differ += 1;
        // At least a twentieth of the square differs between any two shapes.
        expect(differ / shapes[i].length).toBeGreaterThan(0.05);
      }
    }
  });
});
