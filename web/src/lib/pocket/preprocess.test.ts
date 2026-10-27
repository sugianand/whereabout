import { describe, expect, it } from "vitest";

import fixture from "../../../../data/fixtures/clip_preprocess_cases.json";

import { bicubic, clipPixels, resizeBicubic, shortSideSize } from "./preprocess";

describe("CLIP preprocessing (pinned to Pillow and open_clip by clip_preprocess_cases.json)", () => {
  it.each(fixture.cases.map((c) => [`${c.width}×${c.height} → ${c.size}`, c] as const))(
    "%s resizes byte for byte as Pillow does",
    (_, c) => {
      const [w, h] = shortSideSize(c.width, c.height, c.size);
      expect([w, h]).toEqual([c.resized.width, c.resized.height]);
      const got = resizeBicubic(c.rgb, c.width, c.height, 3, w, h);
      expect(Array.from(got)).toEqual(c.resized.rgb);
    },
  );

  it.each(fixture.cases.map((c) => [`${c.width}×${c.height} → ${c.size}`, c] as const))(
    "%s crops and normalises as open_clip does",
    (_, c) => {
      const { data, dims } = clipPixels(c.rgb, c.width, c.height, 3, c.size);
      expect(dims).toEqual([3, c.size, c.size]);
      data.forEach((v, i) => expect(v).toBeCloseTo(c.pixels[i], 5));
    },
  );

  it("drops an alpha channel instead of reading it as colour", () => {
    const c = fixture.cases[0];
    const rgba = new Uint8Array(c.width * c.height * 4);
    for (let i = 0; i < c.width * c.height; i++) {
      rgba.set(c.rgb.slice(i * 3, i * 3 + 3), i * 4);
      rgba[i * 4 + 3] = 255;
    }
    const [w, h] = shortSideSize(c.width, c.height, c.size);
    expect(Array.from(resizeBicubic(rgba, c.width, c.height, 4, w, h))).toEqual(c.resized.rgb);
  });

  it("uses Pillow's bicubic kernel and refuses malformed input", () => {
    expect(bicubic(0)).toBe(1);
    expect(bicubic(1)).toBeCloseTo(0, 12);
    expect(bicubic(2)).toBeCloseTo(0, 12);
    expect(bicubic(-0.5)).toBeCloseTo(0.5625, 12);
    expect(bicubic(1.5)).toBeCloseTo(-0.0625, 12);
    expect(shortSideSize(4032, 3024)).toEqual([298, 224]);
    expect(shortSideSize(3024, 4032)).toEqual([224, 298]);
    expect(() => resizeBicubic([1, 2], 1, 1, 2, 1, 1)).toThrow(/RGB/);
    expect(() => resizeBicubic([1, 2, 3], 2, 1, 3, 1, 1)).toThrow(/size/);
  });

  it("shrinks a 12-megapixel phone photo in well under a few seconds", () => {
    const w = 4032;
    const h = 3024;
    const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 2654435761) >>> 24);
    const t0 = performance.now();
    const { dims } = clipPixels(rgba, w, h, 4);
    expect(dims).toEqual([3, 224, 224]);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
