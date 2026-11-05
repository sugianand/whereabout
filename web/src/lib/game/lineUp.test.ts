import { beforeEach, describe, expect, it } from "vitest";

import { continentOf } from "@/lib/continents";
import photos from "@/data/photos.json";

import { buildRegions } from "./regions";
import { gameRecords } from "./deck";
import {
  BEST_LINE_KEY,
  ROW,
  ROWS,
  TIE_DEGREES,
  atlasLinePoints,
  atlasOrder,
  dealRows,
  eastward,
  formatLongitude,
  inPlace,
  initialLine,
  judgeRow,
  linePoints,
  lineReducer,
  loadBestLine,
  nearestPlace,
  rememberLine,
  unsorted,
  type LineAction,
  type LineState,
  type Spots,
} from "./lineUp";
import { mulberry32 } from "./daily";

const SPOTS: Spots = {
  tokyo: { lng: 139, atlasLng: 120 },
  paris: { lng: 2, atlasLng: -5 },
  lima: { lng: -77, atlasLng: 20 },
  cairo: { lng: 31, atlasLng: 40 },
};
const EAST = ["lima", "paris", "cairo", "tokyo"];

function play(actions: LineAction[], from: LineState = initialLine): LineState {
  return actions.reduce(lineReducer, from);
}

describe("dealRows", () => {
  const regions = {
    Europe: ["e1", "e2", "e3", "e4", "e5", "e6"],
    Asia: ["a1", "a2", "a3", "a4", "a5", "a6"],
    Africa: ["f1", "f2", "f3", "f4", "f5", "f6"],
    "North America": ["n1", "n2", "n3", "n4", "n5", "n6"],
    "South America": ["s1", "s2", "s3"],
  };
  const home = (id: string) => id[0];

  it("deals five rows of four different photos, each from four continents", () => {
    const rows = dealRows(regions, mulberry32(1));
    expect(rows).toHaveLength(ROWS);
    for (const row of rows) {
      expect(row).toHaveLength(ROW);
      expect(new Set(row.map(home)).size).toBe(ROW);
    }
    expect(new Set(rows.flat()).size).toBe(ROW * ROWS);
  });

  it("tops a row up from the continents left, and stops short of a row it can't fill", () => {
    const rows = dealRows({ Europe: ["e1", "e2", "e3", "e4", "e5"], Asia: ["a1"] }, mulberry32(2));
    expect(rows).toHaveLength(1);
    expect(new Set(rows[0]).size).toBe(ROW);
    expect(dealRows({ Europe: ["e1", "e2", "e3"] })).toEqual([]);
  });

  it("is the same for the same randomness", () => {
    expect(dealRows(regions, mulberry32(9))).toEqual(dealRows(regions, mulberry32(9)));
  });

  it("deals whole games from the real deck, across continents", () => {
    const records = gameRecords(photos as never, { guesses: {} } as never);
    const rows = dealRows(buildRegions(records), mulberry32(3));
    const country = new Map(records.map((r) => [r.photo.id, r.photo.country]));
    expect(rows).toHaveLength(ROWS);
    for (const row of rows) {
      expect(new Set(row.map((id) => continentOf(country.get(id)!))).size).toBe(ROW);
    }
  });
});

describe("judging a row", () => {
  it("sorts by longitude from the date line, so a place in the Pacific's west is far east", () => {
    expect(eastward(["tokyo", "lima", "cairo", "paris"], SPOTS)).toEqual(EAST);
    const fiji: Spots = { fiji: { lng: 178, atlasLng: null }, samoa: { lng: -172, atlasLng: null } };
    expect(eastward(["fiji", "samoa"], fiji)).toEqual(["samoa", "fiji"]);
  });

  it("counts the photos standing in their place", () => {
    expect(inPlace(EAST, SPOTS)).toEqual([true, true, true, true]);
    expect(inPlace(["paris", "lima", "cairo", "tokyo"], SPOTS)).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("takes two photos nearly due north and south of each other either way round", () => {
    const close = TIE_DEGREES / 2;
    const spots: Spots = {
      a: { lng: 10, atlasLng: null },
      b: { lng: 10 + close, atlasLng: null },
      c: { lng: 50, atlasLng: null },
      d: { lng: 90, atlasLng: null },
    };
    expect(inPlace(["b", "a", "c", "d"], spots)).toEqual([true, true, true, true]);
    const apart = { ...spots, b: { lng: 10 + TIE_DEGREES, atlasLng: null } };
    expect(inPlace(["b", "a", "c", "d"], apart)).toEqual([false, false, true, true]);
  });

  it("orders Atlas by its own pins and scores it against the truth", () => {
    expect(atlasOrder(EAST, SPOTS)).toEqual(["paris", "lima", "cairo", "tokyo"]);
    const result = judgeRow(["tokyo", "lima", "paris", "cairo"], SPOTS);
    expect(result.points).toBe(0);
    expect(result.east).toEqual(EAST);
    expect(result.atlas).toEqual({ order: ["paris", "lima", "cairo", "tokyo"], points: 2 });
  });

  it("sits Atlas out of a row with a photo it never guessed", () => {
    const spots = { ...SPOTS, cairo: { lng: 31, atlasLng: null } };
    expect(judgeRow(EAST, spots).atlas).toBeNull();
  });

  it("never hands over a row already in order", () => {
    expect(unsorted(EAST, SPOTS)).not.toEqual(EAST);
    expect(inPlace(unsorted(EAST, SPOTS), SPOTS)).toContain(false);
    const shuffled = ["tokyo", "lima", "paris", "cairo"];
    expect(unsorted(shuffled, SPOTS)).toEqual(shuffled);
  });
});

describe("lineReducer", () => {
  const rows = [
    ["tokyo", "lima", "paris", "cairo"],
    ["tokyo", "paris", "cairo", "lima"],
  ];
  const started = play([{ type: "start", rows }]);

  it("has nothing to deal without rows", () => {
    expect(play([{ type: "start", rows: [] }])).toEqual({ phase: "none" });
  });

  it("ignores every move until the row's photos are in", () => {
    expect(started).toMatchObject({ phase: "placing", spots: null, index: 0 });
    for (const action of [
      { type: "swap", a: 0, b: 1 },
      { type: "move", from: 0, to: 3 },
      { type: "lock" },
    ] as const) {
      expect(lineReducer(started, action)).toBe(started);
    }
  });

  it("swaps two places, and lifts one into another closing the gap", () => {
    const ready = play([{ type: "ready", spots: SPOTS }], started);
    expect(play([{ type: "swap", a: 0, b: 2 }], ready)).toMatchObject({
      order: ["paris", "lima", "tokyo", "cairo"],
    });
    expect(play([{ type: "move", from: 0, to: 3 }], ready)).toMatchObject({
      order: ["lima", "paris", "cairo", "tokyo"],
    });
    expect(play([{ type: "move", from: 3, to: 1 }], ready)).toMatchObject({
      order: ["tokyo", "cairo", "lima", "paris"],
    });
  });

  it("plays a whole game: lock, next row, and the last row finishes", () => {
    const first = play(
      [
        { type: "ready", spots: SPOTS },
        { type: "move", from: 0, to: 3 },
        { type: "lock" },
      ],
      started,
    );
    expect(first).toMatchObject({ phase: "revealed" });
    if (first.phase !== "revealed") throw new Error("not revealed");
    expect(first.result.points).toBe(ROW);
    // Moves don't reach a row already locked.
    expect(lineReducer(first, { type: "swap", a: 0, b: 1 })).toBe(first);

    const second = play([{ type: "next" }], first);
    expect(second).toMatchObject({ phase: "placing", index: 1, spots: null, order: rows[1] });
    const done = play(
      [{ type: "ready", spots: SPOTS }, { type: "lock" }, { type: "next" }],
      second,
    );
    expect(done).toMatchObject({ phase: "finished" });
    if (done.phase !== "finished") throw new Error("not finished");
    expect(done.results).toHaveLength(2);
    expect(linePoints(done.results)).toBe(ROW + 2);
  });

  it("totals Atlas over only the rows it played", () => {
    const played = judgeRow(EAST, SPOTS);
    const sat = judgeRow(EAST, { ...SPOTS, lima: { lng: -77, atlasLng: null } });
    expect(atlasLinePoints([played, sat])).toEqual({ points: 2, rows: 1 });
  });
});

describe("formatLongitude", () => {
  it("reads as degrees east or west", () => {
    expect(formatLongitude(139.4)).toBe("139° E");
    expect(formatLongitude(-73.9)).toBe("74° W");
    expect(formatLongitude(0.2)).toBe("0°");
  });
});

describe("nearestPlace", () => {
  it("picks the place whose centre is closest to the tile", () => {
    const centres = [0, 100, 200, 300].map((y) => ({ x: 50, y }));
    expect(nearestPlace(50, -40, centres)).toBe(0);
    expect(nearestPlace(60, 140, centres)).toBe(1);
    expect(nearestPlace(40, 900, centres)).toBe(3);
  });
});

describe("the best game", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the highest, and refuses junk", () => {
    expect(loadBestLine()).toBe(0);
    expect(rememberLine(12)).toBe(12);
    expect(rememberLine(9)).toBe(12);
    expect(rememberLine(15)).toBe(15);
    expect(localStorage.getItem(BEST_LINE_KEY)).toBe("15");
    localStorage.setItem(BEST_LINE_KEY, "not json");
    expect(loadBestLine()).toBe(0);
    localStorage.setItem(BEST_LINE_KEY, "-3");
    expect(loadBestLine()).toBe(0);
  });
});
