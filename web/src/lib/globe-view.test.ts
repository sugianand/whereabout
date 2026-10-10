import { describe, expect, it } from "vitest";

import { GLOBE_FILL, fitGlobeZoom, globeRadiusPx } from "./globe-view";

describe("fitGlobeZoom", () => {
  it.each([
    [380, 260, 15],
    [680, 460, 15],
    [360, 330, 0],
    [1280, 720, 40],
  ])("fits the whole globe in a %ix%i frame (centre latitude %i)", (w, h, lat) => {
    const zoom = fitGlobeZoom(w, h, lat)!;
    const diameter = 2 * globeRadiusPx(zoom, lat);
    expect(diameter).toBeCloseTo(Math.min(w, h) * GLOBE_FILL, 6);
    expect(diameter).toBeLessThan(Math.min(w, h));
  });

  it("zooms in further for a bigger frame", () => {
    expect(fitGlobeZoom(680, 460, 15)!).toBeGreaterThan(fitGlobeZoom(380, 260, 15)!);
  });

  it("returns null before the frame has a size", () => {
    expect(fitGlobeZoom(0, 0, 15)).toBeNull();
    expect(fitGlobeZoom(400, 0, 15)).toBeNull();
  });
});
