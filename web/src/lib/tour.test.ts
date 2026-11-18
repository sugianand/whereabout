import { describe, expect, it } from "vitest";

import {
  TOUR_KEY,
  addLeg,
  beatAtlas,
  clearedCount,
  loadTour,
  nextStop,
  parseTour,
  rememberLeg,
  tourRoute,
  type TourRecord,
} from "./tour";

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe("the tour's route", () => {
  it("visits only the continents the deck offers, in the route's order", () => {
    expect(tourRoute(["Africa", "Asia", "Europe", "Oceania"])).toEqual([
      "Europe",
      "Africa",
      "Asia",
      "Oceania",
    ]);
    expect(tourRoute([])).toEqual([]);
  });

  it("counts cleared legs on the route and stops next at the first one not cleared", () => {
    const route = tourRoute(["Europe", "Africa", "Asia"]);
    const record: TourRecord = {
      Africa: { tries: 2, best: { you: 9000, atlas: 8000 }, cleared: "2026-11-18" },
      // Off the route: never counted.
      Antarctica: { tries: 1, best: { you: 9000, atlas: 1 }, cleared: "2026-11-18" },
      Europe: { tries: 3, best: { you: 7000, atlas: 8000 }, cleared: null },
    };
    expect(clearedCount(route, record)).toBe(1);
    expect(nextStop(route, record)).toBe("Europe");
    expect(
      nextStop(route, { ...record, Europe: { ...record.Europe!, cleared: "2026-11-18" } }),
    ).toBe("Asia");
  });

  it("is complete when every leg is cleared", () => {
    const route = tourRoute(["Europe"]);
    expect(
      nextStop(route, { Europe: { tries: 1, best: { you: 2, atlas: 1 }, cleared: "2026-11-18" } }),
    ).toBeNull();
  });
});

describe("a leg", () => {
  it("is won only by strictly outscoring Atlas", () => {
    expect(beatAtlas({ you: 10001, atlas: 10000 })).toBe(true);
    expect(beatAtlas({ you: 10000, atlas: 10000 })).toBe(false);
    expect(beatAtlas({ you: 0, atlas: 0 })).toBe(false);
  });

  it("keeps its tries, its biggest lead and the day it was first cleared", () => {
    let r = addLeg({}, "Asia", { you: 8000, atlas: 12000 }, "2026-11-16");
    expect(r.Asia).toEqual({ tries: 1, best: { you: 8000, atlas: 12000 }, cleared: null });
    r = addLeg(r, "Asia", { you: 11000, atlas: 12000 }, "2026-11-17");
    expect(r.Asia).toEqual({ tries: 2, best: { you: 11000, atlas: 12000 }, cleared: null });
    r = addLeg(r, "Asia", { you: 15000, atlas: 14000 }, "2026-11-18");
    expect(r.Asia?.cleared).toBe("2026-11-18");
    // A smaller win later leaves the best and the day alone.
    r = addLeg(r, "Asia", { you: 10100, atlas: 10000 }, "2026-11-19");
    expect(r.Asia).toEqual({ tries: 4, best: { you: 15000, atlas: 14000 }, cleared: "2026-11-18" });
    // A loss after clearing never un-clears it.
    r = addLeg(r, "Asia", { you: 0, atlas: 20000 }, "2026-11-20");
    expect(r.Asia?.cleared).toBe("2026-11-18");
  });

  it("leaves the other continents alone", () => {
    const before: TourRecord = { Europe: { tries: 1, best: { you: 1, atlas: 2 }, cleared: null } };
    const after = addLeg(before, "Africa", { you: 3, atlas: 2 }, "2026-11-18");
    expect(after.Europe).toBe(before.Europe);
    expect(before.Africa).toBeUndefined();
  });
});

describe("the stored tour", () => {
  it("reads back what it wrote", () => {
    const store = memoryStore();
    const route = tourRoute(["Europe", "Africa"]);
    const first = rememberLeg(route, "Europe", { you: 14000, atlas: 12000 }, "2026-11-18", store);
    expect(first).toMatchObject({
      continent: "Europe",
      won: true,
      firstClear: true,
      cleared: 1,
      total: 2,
      next: "Africa",
    });
    const again = rememberLeg(route, "Europe", { you: 13000, atlas: 12000 }, "2026-11-19", store);
    expect(again).toMatchObject({
      won: true,
      firstClear: false,
      held: true,
      cleared: 1,
      next: "Africa",
    });
    const lost = rememberLeg(route, "Africa", { you: 9000, atlas: 12000 }, "2026-11-19", store);
    expect(lost).toMatchObject({
      won: false,
      firstClear: false,
      held: false,
      cleared: 1,
      next: "Africa",
    });
    const lostHeld = rememberLeg(route, "Europe", { you: 1, atlas: 12000 }, "2026-11-19", store);
    expect(lostHeld).toMatchObject({ won: false, held: true, next: "Africa" });
    const done = rememberLeg(route, "Africa", { you: 13000, atlas: 12000 }, "2026-11-19", store);
    expect(done).toMatchObject({ firstClear: true, cleared: 2, total: 2, next: null });
    expect(loadTour(store).Europe).toEqual({
      tries: 3,
      best: { you: 14000, atlas: 12000 },
      cleared: "2026-11-18",
    });
  });

  it("drops junk and keeps every well-formed leg", () => {
    const good = { tries: 1, best: { you: 5, atlas: 4 }, cleared: "2026-11-18" };
    expect(parseTour(null)).toEqual({});
    expect(parseTour("not json")).toEqual({});
    expect(parseTour("[1]")).toEqual({});
    expect(
      parseTour(
        JSON.stringify({
          Europe: good,
          Asia: { ...good, tries: 0 },
          Africa: { ...good, cleared: "yesterday" },
          Oceania: { ...good, best: { you: -1, atlas: 4 } },
          "South America": { ...good, best: { you: 1.5, atlas: 4 } },
          "North America": { ...good, cleared: null },
          Atlantis: good,
        }),
      ),
    ).toEqual({ Europe: good, "North America": { ...good, cleared: null } });
  });

  it("still tells the game's story when storage is blocked", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadTour(throwing)).toEqual({});
    expect(
      rememberLeg(["Europe"], "Europe", { you: 2, atlas: 1 }, "2026-11-18", throwing),
    ).toMatchObject({ won: true, firstClear: true, cleared: 1, next: null });
    expect(loadTour(null)).toEqual({});
  });

  it("is kept under its own key", () => {
    const store = memoryStore();
    rememberLeg(["Asia"], "Asia", { you: 2, atlas: 1 }, "2026-11-18", store);
    expect([...store.data.keys()]).toEqual([TOUR_KEY]);
  });
});
