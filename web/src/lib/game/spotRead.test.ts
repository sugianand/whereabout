import { beforeEach, describe, expect, it } from "vitest";

import {
  SPOT_READ_KEY,
  addSquare,
  averageAway,
  cellThird,
  emptyRead,
  favouriteThird,
  loadSpotRead,
  lookLine,
  parseSpotRead,
  recordSpotRead,
  spotReadLine,
  squaresAway,
  thirdAt,
  thirdName,
  warmRate,
} from "./spotRead";
import type { AtlasLooked } from "./types";

/** A 7 × 7 map, as Atlas measures them, with `hot` cells set to their values. */
function map(hot: Record<number, number>): AtlasLooked {
  const cells = Array<number>(49).fill(0);
  for (const [i, v] of Object.entries(hot)) cells[Number(i)] = v;
  return { grid: 7, crop: [0, 0, 1, 1], cells };
}

// Hottest in the top right corner (row 1, column 7), a warm neighbour beside it.
const TOP_RIGHT = map({ 6: 1, 5: 0.6 });

beforeEach(() => localStorage.clear());

describe("thirds of the photo", () => {
  it("splits a 7 × 7 grid two, three and two by each square's centre", () => {
    const cols = [0, 1, 2, 3, 4, 5, 6].map((c) => cellThird(7, c));
    expect(cols).toEqual([0, 0, 1, 1, 1, 2, 2]);
    expect(cellThird(7, 48)).toBe(8);
    expect(cellThird(7, 24)).toBe(4);
    expect(cellThird(3, 6)).toBe(6);
    expect(thirdAt(0.999, 0)).toBe(2);
    expect(thirdAt(1, 1)).toBe(8);
    expect(thirdName(0)).toBe("the top left");
    expect(thirdName(4)).toBe("the middle");
    expect(thirdName(5)).toBe("the right side");
  });
});

describe("squaresAway", () => {
  it("counts diagonal steps as one, to the nearest of the hottest", () => {
    expect(squaresAway(TOP_RIGHT, 6)).toBe(0);
    expect(squaresAway(TOP_RIGHT, 12)).toBe(1); // diagonally below and left
    expect(squaresAway(TOP_RIGHT, 42)).toBe(6); // the bottom left corner
    const twoHot = map({ 0: 1, 48: 1 });
    expect(squaresAway(twoHot, 40)).toBe(1);
  });
});

describe("addSquare", () => {
  it("counts warm or better squares, steps from the hottest and each side's third", () => {
    let read = emptyRead();
    read = addSquare(read, TOP_RIGHT, 6); // spot on
    read = addSquare(read, TOP_RIGHT, 5); // warm, 600 points, one away
    read = addSquare(read, TOP_RIGHT, 42); // cold, six away
    expect(read).toEqual({
      picked: 3,
      warm: 2,
      away: 7,
      you: [0, 0, 2, 0, 0, 0, 1, 0, 0],
      atlas: [0, 0, 3, 0, 0, 0, 0, 0, 0],
    });
    expect(warmRate(read)).toBeCloseTo(2 / 3);
    expect(averageAway(read)).toBeCloseTo(7 / 3);
    expect(warmRate(emptyRead())).toBeNull();
    expect(averageAway(emptyRead())).toBeNull();
  });

  it("puts Atlas where most of its map's importance sits, not only its hottest square", () => {
    // The hottest is top left, but three nearly as hot squares pull the weight to the middle.
    const spread = map({ 0: 1, 23: 0.9, 24: 0.9, 25: 0.9 });
    expect(addSquare(emptyRead(), spread, 0).atlas[4]).toBe(1);
  });

  it("names no third for Atlas on a map where nothing mattered", () => {
    const read = addSquare(emptyRead(), map({}), 24);
    expect(read.atlas.every((n) => n === 0)).toBe(true);
    expect(read.you[4]).toBe(1);
    expect(parseSpotRead(read)).toEqual(read);
  });
});

describe("keeping the read", () => {
  it("adds each square to what the browser keeps, and reads it back", () => {
    recordSpotRead(TOP_RIGHT, 6);
    recordSpotRead(TOP_RIGHT, 42);
    expect(JSON.parse(localStorage.getItem(SPOT_READ_KEY)!)).toMatchObject({ picked: 2, warm: 1 });
    expect(loadSpotRead()).toMatchObject({ picked: 2, warm: 1, away: 6 });
  });

  it("drops junk and reads that couldn't have come from squares picked", () => {
    const good = addSquare(emptyRead(), TOP_RIGHT, 6);
    expect(parseSpotRead(good)).toEqual(good);
    for (const bad of [
      null,
      "x",
      { ...good, warm: 2 }, // more warm than picked
      { ...good, picked: -1 },
      { ...good, away: 1.5 },
      { ...good, away: 99 }, // farther than any grid allows
      { ...good, you: [1, 0, 0] },
      { ...good, you: [0, 0, 0, 0, 0, 0, 0, 0, 0] }, // a square in no third
      { ...good, atlas: [1, 1, 0, 0, 0, 0, 0, 0, 0] }, // more of Atlas's places than photos
      { ...good, atlas: [0, 0, "1", 0, 0, 0, 0, 0, 0] },
    ]) {
      expect(parseSpotRead(bad)).toBeNull();
    }
    localStorage.setItem(SPOT_READ_KEY, "{not json");
    expect(loadSpotRead()).toEqual(emptyRead());
  });
});

describe("the words", () => {
  it("says how warm and how far, and where each side looks", () => {
    let read = addSquare(emptyRead(), TOP_RIGHT, 6);
    expect(spotReadLine(read)).toBe(
      "1 of 1 square warm or better (100%), every one on Atlas's most telling.",
    );
    expect(lookLine(read)).toBe("You and Atlas both look most at the top right of the photo.");
    read = addSquare(read, TOP_RIGHT, 42);
    read = addSquare(read, TOP_RIGHT, 48);
    expect(spotReadLine(read)).toBe(
      "1 of 3 squares warm or better (33%), on average 4.0 squares from Atlas's most telling.",
    );
    // Two squares in the bottom thirds, tied; the first in reading order is named.
    expect(favouriteThird(read.you)).toBe(2);
    read = addSquare(read, TOP_RIGHT, 42);
    expect(lookLine(read)).toBe(
      "You look most at the bottom left of the photo; Atlas at the top right.",
    );
    expect(lookLine(emptyRead())).toBeNull();
  });
});
