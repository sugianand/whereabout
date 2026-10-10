import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EARTH_RADIUS_KM,
  MAX_POINTS,
  formatDistance,
  greatCirclePath,
  haversineKm,
  scoreDistance,
} from "./geo";

type Case = {
  name: string;
  a: { lat: number; lon: number };
  b: { lat: number; lon: number };
  distance_km: number;
  score: number;
};

// Vitest runs from web/, and under jsdom import.meta.url is not a file URL.
const fixturePath = resolve(process.cwd(), "../data/fixtures/geo_cases.json");
const { cases } = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  cases: Case[];
};

describe("parity with the API (data/fixtures/geo_cases.json)", () => {
  it("has cases to check", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  it.each(cases)("$name", ({ a, b, distance_km, score }) => {
    const d = haversineKm({ lng: a.lon, lat: a.lat }, { lng: b.lon, lat: b.lat });
    expect(d).toBeCloseTo(distance_km, 5);
    expect(scoreDistance(d)).toBe(score);
  });
});

describe("scoreDistance", () => {
  it("gives full points for a perfect guess", () => {
    expect(scoreDistance(0)).toBe(MAX_POINTS);
  });

  it("never increases with distance", () => {
    const scores = [0, 1, 10, 100, 1000, 5000, 20000].map(scoreDistance);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s", (d) => {
    expect(() => scoreDistance(d)).toThrow(RangeError);
  });
});

describe("greatCirclePath", () => {
  it("starts and ends at the two points", () => {
    const path = greatCirclePath({ lng: -0.1278, lat: 51.5074 }, { lng: 2.3522, lat: 48.8566 });
    expect(path[0][0]).toBeCloseTo(-0.1278, 6);
    expect(path[0][1]).toBeCloseTo(51.5074, 6);
    expect(path.at(-1)![0]).toBeCloseTo(2.3522, 6);
    expect(path.at(-1)![1]).toBeCloseTo(48.8566, 6);
  });

  it("crosses the antimeridian without jumping across the map", () => {
    const path = greatCirclePath({ lng: 170, lat: 0 }, { lng: -170, lat: 0 }, 8);
    for (let i = 1; i < path.length; i++) {
      expect(Math.abs(path[i][0] - path[i - 1][0])).toBeLessThan(10);
    }
    // Unwrapped, the end lands at 190 rather than -170.
    expect(path.at(-1)![0]).toBeCloseTo(190, 6);
  });

  it("follows the curve: the London–New York path bows north of both cities", () => {
    const path = greatCirclePath({ lng: -0.1278, lat: 51.5074 }, { lng: -74.006, lat: 40.7128 });
    const maxLat = Math.max(...path.map(([, lat]) => lat));
    expect(maxLat).toBeGreaterThan(51.5074);
  });

  it("sums to the haversine distance", () => {
    const a = { lng: 135.7681, lat: 35.0116 };
    const b = { lng: 18.4241, lat: -33.9249 };
    const path = greatCirclePath(a, b, 256);
    let total = 0;
    for (let i = 1; i < path.length; i++) {
      total += haversineKm(
        { lng: path[i - 1][0], lat: path[i - 1][1] },
        { lng: path[i][0], lat: path[i][1] },
      );
    }
    expect(total).toBeCloseTo(haversineKm(a, b), 0);
  });

  it("handles identical points", () => {
    expect(greatCirclePath({ lng: 1, lat: 2 }, { lng: 1, lat: 2 })).toHaveLength(2);
  });

  it("uses the same Earth radius as the API", () => {
    expect(EARTH_RADIUS_KM).toBe(6371.0088);
  });
});

describe("formatDistance", () => {
  it.each([
    [0.012, "12 m"],
    [3.456, "3.5 km"],
    [343.5, "344 km"],
    [12345.6, "12,346 km"],
  ])("%s km reads as %s", (km, text) => {
    expect(formatDistance(km)).toBe(text);
  });
});
