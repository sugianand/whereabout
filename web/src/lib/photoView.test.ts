import { describe, expect, it } from "vitest";

import { clampView, MAX_SCALE, MIN_SCALE, panBy, RESET, zoomAt } from "./photoView";

const frame = { w: 400, h: 300 };

describe("clampView", () => {
  it("limits the scale to the allowed range", () => {
    expect(clampView({ scale: 0.2, x: 0, y: 0 }, frame).scale).toBe(MIN_SCALE);
    expect(clampView({ scale: 9, x: 0, y: 0 }, frame).scale).toBe(MAX_SCALE);
  });

  it("keeps the image covering the frame", () => {
    expect(clampView({ scale: 2, x: 50, y: 50 }, frame)).toEqual({ scale: 2, x: 0, y: 0 });
    expect(clampView({ scale: 2, x: -999, y: -999 }, frame)).toEqual({ scale: 2, x: -400, y: -300 });
    expect(clampView({ scale: 2, x: -100, y: -80 }, frame)).toEqual({ scale: 2, x: -100, y: -80 });
  });

  it("handles a zero-sized frame", () => {
    expect(clampView({ scale: 3, x: -20, y: 10 }, { w: 0, h: 0 })).toEqual({ scale: 3, x: 0, y: 0 });
  });
});

describe("zoomAt", () => {
  it("keeps the focal point fixed", () => {
    const view = { scale: 1.5, x: -60, y: -30 };
    const point = { x: 123, y: 87 };
    const next = zoomAt(view, 1.6, point, frame);
    const before = { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale };
    const after = { x: (point.x - next.x) / next.scale, y: (point.y - next.y) / next.scale };
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it("clamps at the min and max scale", () => {
    expect(zoomAt(RESET, 100, { x: 200, y: 150 }, frame).scale).toBe(MAX_SCALE);
    expect(zoomAt({ scale: 2, x: -100, y: -75 }, 0.001, { x: 200, y: 150 }, frame)).toEqual(RESET);
  });

  it("zooming about the centre of an unzoomed view stays centred", () => {
    expect(zoomAt(RESET, 2, { x: 200, y: 150 }, frame)).toEqual({ scale: 2, x: -200, y: -150 });
  });
});

describe("panBy", () => {
  it("moves the image", () => {
    expect(panBy({ scale: 2, x: -100, y: -100 }, -30, 20, frame)).toEqual({ scale: 2, x: -130, y: -80 });
  });

  it("stops at the edges", () => {
    expect(panBy({ scale: 2, x: -100, y: -100 }, 500, 500, frame)).toEqual({ scale: 2, x: 0, y: 0 });
    expect(panBy({ scale: 2, x: -100, y: -100 }, -500, -500, frame)).toEqual({ scale: 2, x: -400, y: -300 });
  });

  it("cannot pan an unzoomed view", () => {
    expect(panBy(RESET, 40, -40, frame)).toEqual(RESET);
  });
});
