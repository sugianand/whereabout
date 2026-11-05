import { describe, expect, it } from "vitest";

import { CLOSE_ZOOMS, busiestFocus, cropView, seededFocus } from "./closeUpCrop";

const W = 64;
const H = 40;

/** A flat photo with a noisy patch whose top left corner is at (px, py). */
function patch(px: number, py: number): Float32Array {
  const luma = new Float32Array(W * H).fill(200);
  for (let y = py; y < py + 8; y++) {
    for (let x = px; x < px + 12; x++) luma[y * W + x] = (x + y) % 2 ? 20 : 230;
  }
  return luma;
}

describe("busiestFocus", () => {
  it("finds the detail in a blank sky, wherever it is", () => {
    for (const [px, py] of [
      [6, 26],
      [44, 4],
      [24, 16],
    ]) {
      const focus = busiestFocus(patch(px, py), W, H)!;
      expect(Math.abs(focus.x * W - (px + 6))).toBeLessThanOrEqual(3);
      expect(Math.abs(focus.y * H - (py + 4))).toBeLessThanOrEqual(3);
    }
  });

  it("has nothing to say about a blank photo", () => {
    expect(busiestFocus(new Float32Array(W * H).fill(90), W, H)).toBeNull();
  });
});

describe("seededFocus", () => {
  it("stays in the lower middle, pure in its seed", () => {
    for (let seed = 0; seed < 200; seed++) {
      const { x, y } = seededFocus(seed);
      expect(x).toBeGreaterThanOrEqual(0.3);
      expect(x).toBeLessThanOrEqual(0.7);
      expect(y).toBeGreaterThanOrEqual(0.45);
      expect(y).toBeLessThanOrEqual(0.75);
    }
    expect(seededFocus(5)).toEqual(seededFocus(5));
    expect(seededFocus(5)).not.toEqual(seededFocus(6));
  });
});

describe("cropView", () => {
  const phone = { width: 390, height: 420 };
  const desktop = { width: 768, height: 480 };
  const landscape = { width: 6000, height: 4000 };
  const portrait = { width: 3000, height: 4500 };

  it("fills the frame at every stage, however the photo is shaped, with no edge showing", () => {
    for (const frame of [phone, desktop]) {
      for (const image of [landscape, portrait]) {
        for (const focus of [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.5 },
          { x: 1, y: 1 },
        ]) {
          for (const zoom of CLOSE_ZOOMS) {
            const v = cropView(frame, image, focus, zoom);
            expect(v.x).toBeLessThanOrEqual(0);
            expect(v.y).toBeLessThanOrEqual(0);
            expect(v.x + v.width * v.scale).toBeGreaterThanOrEqual(frame.width - 1e-6);
            expect(v.y + v.height * v.scale).toBeGreaterThanOrEqual(frame.height - 1e-6);
          }
        }
      }
    }
  });

  it("holds the focus in the middle of the frame when no edge is in the way", () => {
    const v = cropView(desktop, landscape, { x: 0.4, y: 0.6 }, 4);
    expect(v.x + 0.4 * v.width * v.scale).toBeCloseTo(desktop.width / 2);
    expect(v.y + 0.6 * v.height * v.scale).toBeCloseTo(desktop.height / 2);
  });

  it("shows more of the photo at each stage", () => {
    const shown = CLOSE_ZOOMS.map(
      (zoom) => cropView(phone, landscape, { x: 0.5, y: 0.5 }, zoom).scale,
    );
    expect(shown).toEqual([...shown].sort((a, b) => b - a));
  });

  it("fits the whole photo in the middle at the reveal", () => {
    const v = cropView(phone, landscape, { x: 0.1, y: 0.1 }, null);
    expect(v.scale).toBe(1);
    expect(v.width).toBeCloseTo(phone.width);
    expect(v.height).toBeCloseTo(260);
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(80);
  });
});
