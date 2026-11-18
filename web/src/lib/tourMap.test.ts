import { describe, expect, it } from "vitest";

import { CONTINENTS } from "./continents";
import { TOUR_ROUTE, type TourRecord } from "./tour";
import { ARC_SEGMENTS, TOUR_STOPS, tourMap } from "./tourMap";

const won = (day = "2026-11-18") => ({ tries: 1, best: { you: 2, atlas: 1 }, cleared: day });
const lost = { tries: 1, best: { you: 1, atlas: 2 }, cleared: null };

describe("the tour on the globe", () => {
  it("puts a stop on every continent, on land-sized coordinates", () => {
    for (const c of CONTINENTS) {
      const { lng, lat } = TOUR_STOPS[c];
      expect(Math.abs(lng)).toBeLessThanOrEqual(180);
      expect(Math.abs(lat)).toBeLessThanOrEqual(90);
    }
  });

  it("starts with every stop ahead but the first, every arc unflown, and focus on the first", () => {
    const m = tourMap(TOUR_ROUTE, {});
    expect(m.stops.features.map((s) => s.properties.state)).toEqual([
      "next",
      ...Array(TOUR_ROUTE.length - 1).fill("ahead"),
    ]);
    expect(m.stops.features.map((s) => s.properties.leg)).toEqual(TOUR_ROUTE.map((_, i) => i + 1));
    expect(m.arcs.features).toHaveLength(TOUR_ROUTE.length - 1);
    expect(m.arcs.features.every((a) => a.properties.state === "ahead")).toBe(true);
    expect(m.focus).toEqual(TOUR_STOPS.Europe);
  });

  it("lights an arc only when both its ends are cleared, and leads the next arc in", () => {
    const record: TourRecord = { Europe: won(), Africa: won(), Asia: lost, Oceania: won() };
    const m = tourMap(TOUR_ROUTE, record);
    const states = Object.fromEntries(
      m.arcs.features.map((a) => [`${a.properties.from}→${a.properties.to}`, a.properties.state]),
    );
    expect(states["Europe→Africa"]).toBe("flown");
    expect(states["Africa→Asia"]).toBe("next");
    expect(states["Asia→Oceania"]).toBe("ahead");
    expect(states["Oceania→South America"]).toBe("ahead");
    expect(
      m.stops.features.find((s) => s.properties.continent === "Oceania")?.properties.state,
    ).toBe("cleared");
    expect(m.focus).toEqual(TOUR_STOPS.Asia);
  });

  it("has no focus once every leg is cleared, with every arc flown", () => {
    const record = Object.fromEntries(TOUR_ROUTE.map((c) => [c, won()])) as TourRecord;
    const m = tourMap(TOUR_ROUTE, record);
    expect(m.focus).toBeNull();
    expect(m.arcs.features.every((a) => a.properties.state === "flown")).toBe(true);
  });

  it("follows a shorter route, skipping continents the deck doesn't deal", () => {
    const m = tourMap(["Europe", "Asia"], { Europe: won() });
    expect(m.arcs.features.map((a) => [a.properties.from, a.properties.to])).toEqual([
      ["Europe", "Asia"],
    ]);
    expect(tourMap([], {}).arcs.features).toEqual([]);
    expect(tourMap([], {}).focus).toBeNull();
  });

  it("draws each arc as a smooth curve, crossing the Pacific without jumping round the globe", () => {
    const m = tourMap(TOUR_ROUTE, {});
    for (const arc of m.arcs.features) {
      const pts = arc.geometry.coordinates;
      expect(pts).toHaveLength(ARC_SEGMENTS + 1);
      const from = TOUR_STOPS[arc.properties.from];
      expect(pts[0][0]).toBeCloseTo(from.lng, 6);
      expect(pts[0][1]).toBeCloseTo(from.lat, 6);
      for (let i = 1; i < pts.length; i++)
        expect(Math.abs(pts[i][0] - pts[i - 1][0])).toBeLessThan(20);
    }
    const pacific = m.arcs.features.find((a) => a.properties.from === "Oceania")!;
    const last = pacific.geometry.coordinates.at(-1)!;
    // Unwrapped past 180°: South America's -60° drawn as 300°, the short way east.
    expect(last[0]).toBeCloseTo(300, 5);
  });
});
