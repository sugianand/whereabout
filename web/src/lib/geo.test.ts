import { describe, expect, it } from "vitest";

import {
  circlePath,
  clampLat,
  formatLngLat,
  graticule,
  haversineKm,
  normalize,
  nudge,
  wrapLng,
} from "./geo";

describe("wrapLng", () => {
  it.each([
    [0, 0],
    [179.5, 179.5],
    [180, -180],
    [190, -170],
    [-190, 170],
    [540, -180],
    [-720, 0],
  ])("wraps %d to %d", (input, expected) => {
    expect(wrapLng(input)).toBeCloseTo(expected, 10);
  });

  it("returns in-range longitudes exactly", () => {
    expect(wrapLng(2.3522)).toBe(2.3522);
    expect(wrapLng(-179.999)).toBe(-179.999);
  });

  it("never returns negative zero", () => {
    expect(Object.is(wrapLng(-0), 0)).toBe(true);
    expect(Object.is(wrapLng(-360), 0)).toBe(true);
  });
});

describe("clampLat", () => {
  it("keeps latitudes on the globe", () => {
    expect(clampLat(91)).toBe(90);
    expect(clampLat(-95)).toBe(-90);
    expect(clampLat(45.5)).toBe(45.5);
  });
});

describe("nudge", () => {
  it("moves in each compass direction", () => {
    const start = { lng: 10, lat: 20 };
    expect(nudge(start, "north", 1)).toEqual({ lng: 10, lat: 21 });
    expect(nudge(start, "south", 1)).toEqual({ lng: 10, lat: 19 });
    expect(nudge(start, "east", 1)).toEqual({ lng: 11, lat: 20 });
    expect(nudge(start, "west", 1)).toEqual({ lng: 9, lat: 20 });
  });

  it("wraps east across the antimeridian", () => {
    expect(nudge({ lng: 175, lat: 0 }, "east", 10)).toEqual({ lng: -175, lat: 0 });
  });

  it("stops at the poles", () => {
    expect(nudge({ lng: 0, lat: 85 }, "north", 10)).toEqual({ lng: 0, lat: 90 });
    expect(nudge({ lng: 0, lat: -85 }, "south", 10)).toEqual({ lng: 0, lat: -90 });
  });
});

describe("formatLngLat", () => {
  it("uses hemispheres instead of signs", () => {
    expect(formatLngLat({ lng: 2.3522, lat: 48.8566 })).toBe("48.86° N, 2.35° E");
    expect(formatLngLat({ lng: -43.1729, lat: -22.9068 })).toBe("22.91° S, 43.17° W");
  });

  it("normalizes before formatting", () => {
    expect(formatLngLat({ lng: 200, lat: 0 }, 0)).toBe("0° N, 160° W");
  });
});

describe("normalize", () => {
  it("wraps and clamps together", () => {
    expect(normalize({ lng: 370, lat: 100 })).toEqual({ lng: 10, lat: 90 });
  });
});

describe("graticule", () => {
  it("draws 12 meridians and 5 parallels at 30° spacing", () => {
    const { features } = graticule(30);
    const meridians = features.filter((f) => f.properties.kind === "meridian");
    const parallels = features.filter((f) => f.properties.kind === "parallel");
    expect(meridians.map((f) => f.properties.degrees)).toEqual([
      -180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150,
    ]);
    expect(parallels.map((f) => f.properties.degrees)).toEqual([-60, -30, 0, 30, 60]);
  });

  it("densifies lines so they curve on the globe", () => {
    const equator = graticule(30, 5).features.find(
      (f) => f.properties.kind === "parallel" && f.properties.degrees === 0,
    );
    expect(equator?.geometry.coordinates).toHaveLength(73);
    expect(equator?.geometry.coordinates[0]).toEqual([-180, 0]);
    expect(equator?.geometry.coordinates.at(-1)).toEqual([180, 0]);
  });

  it("rejects steps that do not divide 180", () => {
    expect(() => graticule(7)).toThrow(RangeError);
    expect(() => graticule(0)).toThrow(RangeError);
  });
});

describe("circlePath", () => {
  const PARIS = { lng: 2.35, lat: 48.86 };

  it("puts every point the radius away from the centre, and closes the ring", () => {
    const ring = circlePath(PARIS, 750, 48);
    expect(ring).toHaveLength(49);
    for (const [lng, lat] of ring) {
      expect(haversineKm(PARIS, { lng, lat })).toBeCloseTo(750, 6);
    }
    const [first, last] = [ring[0]!, ring.at(-1)!];
    expect(haversineKm({ lng: first[0], lat: first[1] }, { lng: last[0], lat: last[1] })).toBeLessThan(1e-6);
  });

  it("starts due north of the centre", () => {
    const [lng, lat] = circlePath(PARIS, 1000, 8)[0]!;
    expect(lng).toBeCloseTo(PARIS.lng, 9);
    expect(lat).toBeGreaterThan(PARIS.lat);
  });

  it("runs unbroken across the antimeridian and around a pole", () => {
    for (const center of [
      { lng: 179.5, lat: -17 },
      { lng: 0, lat: 80 },
    ]) {
      const ring = circlePath(center, 2000, 96);
      for (let i = 1; i < ring.length; i++) {
        expect(Math.abs(ring[i]![0] - ring[i - 1]![0])).toBeLessThan(180);
      }
    }
  });

  it("refuses a negative or endless radius", () => {
    expect(() => circlePath(PARIS, -1)).toThrow(RangeError);
    expect(() => circlePath(PARIS, Number.NaN)).toThrow(RangeError);
  });
});
