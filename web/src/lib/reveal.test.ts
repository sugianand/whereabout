import { describe, expect, it } from "vitest";

import {
  easeOut,
  revealCamera,
  revealLines,
  revealPadding,
  visibleFrame,
  type RevealView,
} from "./reveal";

const KYOTO = { lng: 135.7681, lat: 35.0116 };
const PARIS = { lng: 2.3522, lat: 48.8566 };
const OSAKA = { lng: 135.5023, lat: 34.6937 };

const view: RevealView = {
  truth: KYOTO,
  guesses: [
    { actor: "player", at: PARIS },
    { actor: "atlas", at: OSAKA },
  ],
};

describe("revealLines", () => {
  it("draws one arc per guess, tagged with who made it", () => {
    const lines = revealLines(view);
    expect(lines.features.map((f) => f.properties.actor)).toEqual(["player", "atlas"]);
  });

  it("ends every finished arc on the truth", () => {
    for (const f of revealLines(view, 1).features) {
      const [lng, lat] = f.geometry.coordinates.at(-1)!;
      expect(lng).toBeCloseTo(KYOTO.lng, 6);
      expect(lat).toBeCloseTo(KYOTO.lat, 6);
    }
  });

  it("grows with progress and is always a valid line", () => {
    const lengths = [0, 0.25, 0.5, 1].map(
      (p) => revealLines(view, p, 40).features[0].geometry.coordinates.length,
    );
    expect(lengths).toEqual([2, 11, 21, 41]);
  });

  it("clamps progress outside 0..1", () => {
    expect(revealLines(view, 5, 40).features[0].geometry.coordinates).toHaveLength(41);
    expect(revealLines(view, -1, 40).features[0].geometry.coordinates).toHaveLength(2);
  });
});

describe("revealCamera", () => {
  it("zooms in close when everyone was close", () => {
    const close = revealCamera({ truth: KYOTO, guesses: [{ actor: "player", at: OSAKA }] });
    const far = revealCamera(view);
    expect(close.zoom).toBeGreaterThan(far.zoom);
    expect(close.zoom).toBeLessThanOrEqual(5.5);
  });

  it("frames the longest arc: Paris to Kyoto is centred over Asia", () => {
    const { center } = revealCamera(view);
    expect(center.lng).toBeGreaterThan(40);
    expect(center.lng).toBeLessThan(110);
  });

  it("keeps the centre in normal longitudes across the antimeridian", () => {
    const { center } = revealCamera({
      truth: { lng: 178, lat: -18 },
      guesses: [{ actor: "player", at: { lng: -150, lat: -17 } }],
    });
    expect(center.lng).toBeGreaterThanOrEqual(-180);
    expect(center.lng).toBeLessThan(180);
  });

  it("shows the whole globe for an antipodal miss", () => {
    const { zoom } = revealCamera({
      truth: { lng: 0, lat: 0 },
      guesses: [{ actor: "player", at: { lng: 180, lat: 0 } }],
    });
    expect(zoom).toBeCloseTo(0.6, 1);
  });

  it("zooms out one level when the visible frame is half as big", () => {
    const big = revealCamera(view, 800).zoom;
    const small = revealCamera(view, 400).zoom;
    expect(big - small).toBeCloseTo(1, 5);
  });
});

describe("easeOut", () => {
  it("starts at 0, ends at 1 and front-loads the motion", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
    expect(easeOut(2)).toBe(1);
  });
});

describe("revealPadding", () => {
  it("keeps the bottom of a phone screen for the result card and the top for the header", () => {
    const p = revealPadding(390, 844);
    expect(p.bottom).toBe(380);
    expect(p.top).toBe(136);
    expect(visibleFrame(390, 844, p)).toBe(328);
  });

  it("keeps the left of a wide screen for the result card", () => {
    const p = revealPadding(1440, 900);
    expect(p.left).toBe(500);
    expect(visibleFrame(1440, 900, p)).toBe(780);
  });
});
