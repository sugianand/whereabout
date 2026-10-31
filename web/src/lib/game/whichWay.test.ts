import { afterEach, describe, expect, it } from "vitest";

import { seededShuffle } from "./daily";
import {
  BEST_WAY_KEY,
  EDGE_DEGREES,
  POINTS,
  POINT_KEYS,
  atlasPoint,
  flatBearing,
  formatBearing,
  headingGap,
  initialBearing,
  initialWay,
  judgeWay,
  loadBestWay,
  pointHeading,
  pointOf,
  rememberWay,
  unfitPair,
  wayOver,
  wayReducer,
  type Point,
  type WayAction,
  type WayState,
} from "./whichWay";

const LONDON = { lng: -0.1276, lat: 51.5072 };
const PARIS = { lng: 2.3522, lat: 48.8566 };
const TOKYO = { lng: 139.6917, lat: 35.6895 };
const NEW_YORK = { lng: -74.006, lat: 40.7128 };
const SYDNEY = { lng: 151.2093, lat: -33.8688 };
const NAIROBI = { lng: 36.8219, lat: -1.2921 };

describe("initialBearing", () => {
  it("reads the four quarters on the equator and along a meridian", () => {
    const origin = { lng: 0, lat: 0 };
    expect(initialBearing(origin, { lng: 0, lat: 10 })).toBeCloseTo(0, 6);
    expect(initialBearing(origin, { lng: 10, lat: 0 })).toBeCloseTo(90, 6);
    expect(initialBearing(origin, { lng: 0, lat: -10 })).toBeCloseTo(180, 6);
    expect(initialBearing(origin, { lng: -10, lat: 0 })).toBeCloseTo(270, 6);
  });

  it("follows the great circle, not the map: Tokyo to New York sets off north-east", () => {
    // On a flat map New York is east of Tokyo; the shortest route leaves heading about 25°.
    const b = initialBearing(TOKYO, NEW_YORK);
    expect(b).toBeGreaterThan(20);
    expect(b).toBeLessThan(30);
    expect(pointOf(b)).toBe("NE");
  });

  it("matches known routes", () => {
    // London to Paris leaves at about 148° (south-east).
    expect(initialBearing(LONDON, PARIS)).toBeCloseTo(148.1, 0);
    expect(pointOf(initialBearing(LONDON, PARIS))).toBe("SE");
    expect(pointOf(initialBearing(PARIS, LONDON))).toBe("NW");
    // Across the antimeridian the short way: Sydney to Tokyo heads north, a touch west.
    expect(pointOf(initialBearing(SYDNEY, TOKYO))).toBe("N");
  });

  it("always lands in [0, 360)", () => {
    for (let lng = -180; lng < 180; lng += 37) {
      for (let lat = -80; lat <= 80; lat += 23) {
        const b = initialBearing(NAIROBI, { lng, lat });
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(360);
      }
    }
  });
});

describe("flatBearing", () => {
  it("is the straight line on a flat map, which the great circle can disagree with", () => {
    expect(pointOf(flatBearing(TOKYO, NEW_YORK))).toBe("E");
    expect(pointOf(initialBearing(TOKYO, NEW_YORK))).toBe("NE");
    // Across the antimeridian the short way, not round the back of the map.
    expect(flatBearing({ lng: 170, lat: 0 }, { lng: -170, lat: 0 })).toBeCloseTo(90, 6);
    expect(flatBearing({ lng: 0, lat: 0 }, { lng: 0, lat: -5 })).toBeCloseTo(180, 6);
  });
});

describe("points", () => {
  it("are eight, clockwise, each with its own number-pad key", () => {
    expect(POINTS.map(pointHeading)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(new Set(Object.values(POINT_KEYS)).size).toBe(8);
    expect(POINT_KEYS.N).toBe("8");
    expect(POINT_KEYS.SW).toBe("1");
  });

  it("snap a bearing to the nearest point, wrapping through north", () => {
    expect(pointOf(0)).toBe("N");
    expect(pointOf(359)).toBe("N");
    expect(pointOf(22.4)).toBe("N");
    expect(pointOf(22.5)).toBe("NE");
    expect(pointOf(200)).toBe("S");
    expect(pointOf(-45)).toBe("NW");
    expect(pointOf(720 + 90)).toBe("E");
  });

  it("measure gaps the short way round", () => {
    expect(headingGap(350, 10)).toBe(20);
    expect(headingGap(10, 350)).toBe(20);
    expect(headingGap(0, 180)).toBe(180);
    expect(headingGap(90, 90)).toBe(0);
  });
});

describe("judgeWay", () => {
  it("counts the point nearest the bearing", () => {
    expect(judgeWay("E", 100)).toEqual({
      picked: "E",
      truth: "E",
      bearing: 100,
      edge: false,
      correct: true,
    });
    expect(judgeWay("W", 100).correct).toBe(false);
    expect(judgeWay("SE", 100).correct).toBe(false);
  });

  it("lets either neighbour count near the line between two points", () => {
    // 22.5° is the line between N and NE; within EDGE_DEGREES of it both count.
    const near = 22.5 + EDGE_DEGREES - 0.1;
    expect(judgeWay("N", near)).toMatchObject({ truth: "NE", edge: true, correct: true });
    expect(judgeWay("NE", near)).toMatchObject({ truth: "NE", edge: false, correct: true });
    expect(judgeWay("N", 22.5 + EDGE_DEGREES + 0.1).correct).toBe(false);
    // Across north: 340° is N's (20° off), and within EDGE_DEGREES of NW's line too.
    expect(judgeWay("N", 340).correct).toBe(true);
    expect(judgeWay("NW", 340)).toMatchObject({ edge: true, correct: true });
  });

  it("reads bearings as whole degrees", () => {
    expect(formatBearing(47.4)).toBe("47°");
    expect(formatBearing(359.7)).toBe("0°");
  });
});

describe("unfitPair", () => {
  it("refuses one city and nearly antipodal photos, and keeps the rest", () => {
    expect(unfitPair(PARIS, { lng: 2.5, lat: 48.9 })).toBe(true);
    expect(unfitPair({ lng: 0, lat: 0 }, { lng: 179.5, lat: 0.2 })).toBe(true);
    expect(unfitPair(LONDON, PARIS)).toBe(false);
    expect(unfitPair(TOKYO, NEW_YORK)).toBe(false);
  });
});

describe("atlasPoint", () => {
  it("reads the bearing between Atlas's guesses, and sits out without two apart", () => {
    expect(atlasPoint(LONDON, PARIS)).toBe("SE");
    expect(atlasPoint(null, PARIS)).toBeNull();
    expect(atlasPoint(LONDON, null)).toBeNull();
    expect(atlasPoint(PARIS, { lng: PARIS.lng + 0.001, lat: PARIS.lat })).toBeNull();
  });
});

const pick = (
  point: Point,
  from = LONDON,
  to = PARIS,
  atlasFrom: { lng: number; lat: number } | null = from,
  atlasTo: { lng: number; lat: number } | null = to,
): WayAction => ({ type: "picked", point, from, to, atlasFrom, atlasTo });

function playing(order: readonly string[]): WayState {
  return wayReducer(initialWay, { type: "start", order });
}

describe("wayReducer", () => {
  it("starts picking from the first photo toward the second", () => {
    const s = playing(["a", "b", "c"]);
    expect(s).toMatchObject({ phase: "picking", index: 0, streak: 0 });
    expect(playing(["a"]).phase).toBe("cleared");
  });

  it("a right pick travels on: where you were headed is where you stand next", () => {
    let s = wayReducer(playing(["a", "b", "c"]), pick("SE"));
    expect(s).toMatchObject({ phase: "answered", streak: 1, atlasRight: 1, atlasPlayed: 1 });
    if (s.phase !== "answered") throw new Error();
    expect(s.verdict.truth).toBe("SE");
    expect(s.km).toBeGreaterThan(300);
    expect(s.km).toBeLessThan(400);
    expect(wayOver(s)).toBe(false);
    s = wayReducer(s, { type: "next" });
    expect(s).toMatchObject({ phase: "picking", index: 1, streak: 1 });
    // The last photo dealt and played clears the run.
    s = wayReducer(wayReducer(s, pick("SE")), { type: "next" });
    expect(s).toMatchObject({ phase: "cleared", streak: 2 });
    expect(wayOver(s)).toBe(true);
  });

  it("a wrong pick ends the run, and next does nothing", () => {
    const s = wayReducer(playing(["a", "b", "c"]), pick("N"));
    expect(s).toMatchObject({ phase: "answered", streak: 0 });
    expect(wayOver(s)).toBe(true);
    expect(wayReducer(s, { type: "next" })).toBe(s);
  });

  it("Atlas is judged on the true bearing, and sits out without both guesses", () => {
    // Atlas guessed Paris north of London: it picks N, and is wrong.
    let s = wayReducer(
      playing(["a", "b", "c"]),
      pick("SE", LONDON, PARIS, LONDON, { lng: 0, lat: 58 }),
    );
    expect(s).toMatchObject({ atlasRight: 0, atlasPlayed: 1 });
    if (s.phase !== "answered") throw new Error();
    expect(s.atlas).toMatchObject({ picked: "N", correct: false });
    s = wayReducer(wayReducer(s, { type: "next" }), pick("SE", LONDON, PARIS, null, PARIS));
    expect(s).toMatchObject({ atlasRight: 0, atlasPlayed: 1, streak: 2 });
    if (s.phase !== "answered") throw new Error();
    expect(s.atlas).toBeNull();
  });

  it("redeals an unfit stop, only for the photo on screen, and clears when none are left", () => {
    let s = playing(["a", "b", "c"]);
    expect(wayReducer(s, { type: "redeal", id: "c" })).toBe(s);
    s = wayReducer(s, { type: "redeal", id: "b" });
    expect(s).toMatchObject({ phase: "picking", index: 0, order: ["a", "c"] });
    s = wayReducer(s, { type: "redeal", id: "c" });
    expect(s).toMatchObject({ phase: "cleared", order: ["a"] });
  });

  it("ignores picks outside picking", () => {
    const s = wayReducer(playing(["a", "b"]), pick("SE"));
    expect(wayReducer(s, pick("N"))).toBe(s);
    expect(wayReducer(initialWay, pick("N"))).toBe(initialWay);
  });

  it("plays a shuffled deck to the end with every pick judged", () => {
    const order = seededShuffle(["a", "b", "c", "d", "e"], 7);
    let s = playing(order);
    let turns = 0;
    while (s.phase === "picking") {
      s = wayReducer(s, pick("SE"));
      s = wayReducer(s, { type: "next" });
      turns++;
    }
    expect(turns).toBe(4);
    expect(s).toMatchObject({ phase: "cleared", streak: 4 });
  });
});

describe("the best run", () => {
  afterEach(() => localStorage.clear());

  it("is kept only when beaten, and junk reads as none", () => {
    expect(loadBestWay()).toBe(0);
    expect(rememberWay(3)).toBe(3);
    expect(rememberWay(2)).toBe(3);
    expect(localStorage.getItem(BEST_WAY_KEY)).toBe("3");
    localStorage.setItem(BEST_WAY_KEY, "{");
    expect(loadBestWay()).toBe(0);
    localStorage.setItem(BEST_WAY_KEY, "-2");
    expect(loadBestWay()).toBe(0);
    localStorage.setItem(BEST_WAY_KEY, "2.5");
    expect(loadBestWay()).toBe(0);
  });
});
