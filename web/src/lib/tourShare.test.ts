import { describe, expect, it, vi } from "vitest";

import { CONTINENTS, type Continent } from "@/lib/continents";
import { TOUR_ROUTE, type TourRecord } from "@/lib/tour";

import { IMAGE_SIZE, INK } from "./shareImage";
import {
  TOUR_SHARE_NOTE,
  leadWords,
  sendTourShare,
  tourHasPlay,
  tourPage,
  tourShareCard,
  tourShareLayout,
  tourShareName,
  tourShareSummary,
  tourShareText,
} from "./tourShare";

const PAGE = "https://example.org/whereabout/tour/?from=stamps#route";
const ROUTE: Continent[] = ["Europe", "Africa", "Asia", "Oceania"];

const RECORD: TourRecord = {
  Europe: { tries: 2, best: { you: 18200, atlas: 14000 }, cleared: "2026-11-17" },
  Asia: { tries: 3, best: { you: 9000, atlas: 12500 }, cleared: null },
  Oceania: { tries: 1, best: { you: 11000, atlas: 11000 }, cleared: null },
};

const won = { tries: 1, best: { you: 20000, atlas: 19500 }, cleared: "2026-11-18" };
const everyLeg = (route: readonly Continent[]): TourRecord =>
  Object.fromEntries(route.map((c) => [c, won]));

describe("tourShareCard", () => {
  it("lists each leg in route order with its state and best margin against Atlas", () => {
    const card = tourShareCard(ROUTE, RECORD, PAGE);
    expect(card.cleared).toBe(1);
    expect(card.total).toBe(4);
    expect(card.complete).toBe(false);
    expect(card.legs).toEqual([
      { continent: "Europe", state: "cleared", lead: 4200 },
      { continent: "Africa", state: "next", lead: null },
      { continent: "Asia", state: "ahead", lead: -3500 },
      { continent: "Oceania", state: "ahead", lead: 0 },
    ]);
    expect(tourHasPlay(card)).toBe(true);
    expect(tourHasPlay(tourShareCard(ROUTE, {}, PAGE))).toBe(false);
  });

  it("ignores a leg kept for a continent off the route", () => {
    const card = tourShareCard(["Europe", "Asia"], { ...RECORD, Africa: won }, PAGE);
    expect(card.legs.map((l) => l.continent)).toEqual(["Europe", "Asia"]);
    expect(card.cleared).toBe(1);
  });

  it("is complete once every leg is cleared, and never for an empty route", () => {
    expect(tourShareCard(ROUTE, everyLeg(ROUTE), PAGE).complete).toBe(true);
    expect(tourShareCard([], {}, PAGE).complete).toBe(false);
  });

  it("links to the tour page, from the tour or the home page", () => {
    expect(tourPage(PAGE)).toBe("https://example.org/whereabout/tour/");
    expect(tourPage("https://example.org/whereabout/")).toBe(
      "https://example.org/whereabout/tour/",
    );
    expect(tourPage("http://localhost:3000/tour")).toBe("http://localhost:3000/tour/");
  });
});

describe("tourShareText", () => {
  it("is the count, each leg's best margin with a tick once cleared, and the tour page", () => {
    const card = tourShareCard(ROUTE, RECORD, PAGE);
    expect(tourShareText(card).split("\n")).toEqual([
      "Whereabout World Tour: 1 of 4 continents cleared against Atlas",
      "Europe +4,200 ✓ · Africa not played · Asia −3,500 · Oceania tied",
      "https://example.org/whereabout/tour/",
    ]);
    expect(tourShareSummary(card)).toBe("Your World Tour: 1 of 4 continents cleared.");
  });

  it("says when the tour is complete", () => {
    const card = tourShareCard(ROUTE, everyLeg(ROUTE), PAGE);
    expect(tourShareText(card).split("\n")[0]).toBe(
      "Whereabout World Tour: complete, Atlas beaten on all 4 continents",
    );
  });

  it("words a margin with a sign, a true minus, tied or not played", () => {
    expect(leadWords(12345)).toBe("+12,345");
    expect(leadWords(-7)).toBe("−7");
    expect(leadWords(0)).toBe("tied");
    expect(leadWords(null)).toBe("not played");
  });
});

describe("tourShareLayout", () => {
  it("draws the count, a stop on the route per leg, each leg's state and margin, and the address", () => {
    const layout = tourShareLayout(tourShareCard(ROUTE, RECORD, PAGE));
    const w = layout.texts.map((t) => t.text);
    expect(w).toEqual(
      expect.arrayContaining([
        "WHEREABOUT",
        "My World Tour",
        "1",
        "of 4 continents cleared against Atlas",
      ]),
    );
    expect(w).toEqual(
      expect.arrayContaining(["1  Europe", "2  Africa", "3  Asia", "4  Oceania", "2", "3", "4"]),
    );
    expect(w).toEqual(expect.arrayContaining(["cleared", "next stop"]));
    expect(w).toEqual(expect.arrayContaining(["+4,200", "not played", "−3,500", "tied"]));
    expect(w).toContain("example.org/whereabout/tour/");
    // The frame, a line between each pair of stops, and a ring per stop; the next stop's dot.
    expect(layout.rects).toHaveLength(1 + (ROUTE.length - 1) + ROUTE.length);
    expect(layout.marks).toHaveLength(1);
  });

  it("tells the stops apart by size and fill, not colour alone", () => {
    const rects = tourShareLayout(tourShareCard(ROUTE, RECORD, PAGE)).rects;
    const stops = rects.slice(1 + ROUTE.length - 1);
    const [cleared, next, ahead] = stops;
    expect(cleared.fill).toBe(INK.gold);
    expect(next.fill).toBe(INK.background);
    expect(ahead.fill).toBe(INK.background);
    expect(next.w).toBeGreaterThan(cleared.w);
    expect(cleared.w).toBeGreaterThan(ahead.w);
    // Stops sit in route order, left to right.
    expect(stops.map((s) => s.x)).toEqual([...stops.map((s) => s.x)].sort((a, b) => a - b));
  });

  it("lights the line between two cleared stops, and the one into the next stop", () => {
    const record: TourRecord = { Europe: won, Africa: won };
    const lines = tourShareLayout(tourShareCard(ROUTE, record, PAGE)).rects.slice(1, ROUTE.length);
    expect(lines.map((r) => r.fill)).toEqual([INK.gold, INK.sonar, INK.frame]);
  });

  it("says the tour is complete, with no next stop", () => {
    const layout = tourShareLayout(tourShareCard(ROUTE, everyLeg(ROUTE), PAGE));
    const w = layout.texts.map((t) => t.text);
    expect(w).toContain("of 4 continents · tour complete");
    expect(w).not.toContain("next stop");
    expect(layout.marks).toEqual([]);
  });

  it("keeps every shape and word inside the frame, for the longest route", () => {
    const layout = tourShareLayout(tourShareCard(TOUR_ROUTE, RECORD, PAGE));
    for (const r of layout.rects.slice(1)) {
      expect(r.x).toBeGreaterThanOrEqual(32);
      expect(r.y).toBeGreaterThanOrEqual(32);
      expect(r.x + r.w).toBeLessThanOrEqual(IMAGE_SIZE - 32);
      expect(r.y + r.h).toBeLessThanOrEqual(IMAGE_SIZE - 32);
    }
    for (const t of layout.texts) {
      expect(t.y).toBeGreaterThan(32);
      expect(t.y).toBeLessThan(IMAGE_SIZE - 32);
    }
    const legRows = layout.texts.filter((t) => /^\d {2}/.test(t.text));
    expect(legRows).toHaveLength(TOUR_ROUTE.length);
    expect(Math.max(...legRows.map((t) => t.y))).toBeLessThan(1020 - 28);
  });

  it("draws a single-leg route with its stop in the middle", () => {
    const layout = tourShareLayout(tourShareCard(["Europe"], RECORD, PAGE));
    const [stop] = layout.rects.slice(1);
    expect(stop.x + stop.w / 2).toBe(IMAGE_SIZE / 2);
  });

  it("draws only numbers, the route's continents and the picture's own words", () => {
    const own = new Set([
      "WHEREABOUT",
      "My World Tour",
      "Best game against Atlas",
      "cleared",
      "next stop",
      "tied",
      "not played",
      "example.org/whereabout/tour/",
    ]);
    const continents = new Set<string>(CONTINENTS);
    const card = tourShareCard(TOUR_ROUTE, RECORD, PAGE);
    for (const { text } of tourShareLayout(card).texts) {
      const rest = text
        .replace(/^\d+ {2}/, "")
        .replace(/^of \d+ continents( cleared against Atlas| · tour complete)$/, "");
      const ok = rest === "" || own.has(rest) || continents.has(rest) || /^[+−]?[\d,]+$/.test(rest);
      expect(ok, text).toBe(true);
    }
  });
});

describe("sending the tour", () => {
  it("names the file after the count", () => {
    expect(tourShareName(tourShareCard(ROUTE, RECORD, PAGE))).toBe("whereabout-tour-1-of-4.png");
  });

  it("says when the browser can't draw the picture", async () => {
    // jsdom has no 2D canvas, so the picture can't be drawn.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const outcome = await sendTourShare(tourShareCard(ROUTE, RECORD, PAGE), {} as Navigator);
    expect(outcome).toBe("failed");
    expect(TOUR_SHARE_NOTE[outcome]).toMatch(/as text/);
    vi.restoreAllMocks();
  });
});
