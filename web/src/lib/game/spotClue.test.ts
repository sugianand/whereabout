import { afterEach, describe, expect, it, vi } from "vitest";

import { bundledById, bundledSpotIds } from "./bundled";
import type { GameRecord } from "./deck";
import {
  BEST_SPOT_KEY,
  SPOT_MAX,
  SPOT_PHOTOS,
  cellAt,
  cellName,
  dealSpot,
  hottestCells,
  hottestLine,
  initialSpot,
  loadBestSpot,
  middleCell,
  playableLooked,
  rememberSpot,
  spotIds,
  spotPoints,
  spotReducer,
  spotResult,
  spotTotals,
  spotVerdict,
  stepCell,
} from "./spotClue";
import type { AtlasLooked } from "./types";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

// A 3 × 3 map: the bottom left mattered most, the middle half as much, the rest not at all.
const MAP: AtlasLooked = {
  grid: 3,
  crop: [0.1, 0, 0.8, 1],
  cells: [0, 0, 0, 0, 0.5, 0, 1, 0.25, 0],
};

function record(id: string, looked?: AtlasLooked): GameRecord {
  return {
    photo: {
      id,
      imageUrl: `https://upload.wikimedia.org/${id}.jpg`,
      lng: 0,
      lat: 0,
      place: id,
      country: "FR",
      credit: { author: "A", license: "CC BY 4.0", sourceUrl: "https://c" },
    },
    atlas: looked ? { lng: 0, lat: 0, confidence: 0.5, topCountries: [], clues: [], looked } : null,
  };
}

describe("which photos can be dealt", () => {
  it("needs a well-formed map with a square that mattered", () => {
    expect(playableLooked(MAP)).toBe(true);
    expect(playableLooked({ ...MAP, cells: MAP.cells.map(() => 0) })).toBe(false);
    expect(playableLooked({ ...MAP, cells: [1, 0] })).toBe(false);
    expect(playableLooked({ ...MAP, crop: [0.5, 0, 0.8, 1] })).toBe(false);
    expect(playableLooked(undefined)).toBe(false);
    expect(
      spotIds([record("a", MAP), record("b"), record("c", { ...MAP, cells: Array(9).fill(0) })]),
    ).toEqual(["a"]);
  });

  it("deals only photos from the real catalog whose map has a square that mattered", () => {
    expect(bundledSpotIds.length).toBeGreaterThanOrEqual(SPOT_PHOTOS);
    for (const id of bundledSpotIds) {
      expect(playableLooked(bundledById.get(id)!.atlas?.looked)).toBe(true);
    }
  });

  it("deals five different photos, the same for the same seed", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    const game = dealSpot(ids, 42);
    expect(game).toHaveLength(SPOT_PHOTOS);
    expect(new Set(game).size).toBe(SPOT_PHOTOS);
    expect(dealSpot(ids, 42)).toEqual(game);
    expect(dealSpot(["a", "b"], 1).sort()).toEqual(["a", "b"]);
  });
});

describe("the grid", () => {
  it("finds the square under a point, held inside the grid", () => {
    expect(cellAt(3, 0, 0)).toBe(0);
    expect(cellAt(3, 0.5, 0.5)).toBe(4);
    expect(cellAt(3, 0.01, 0.99)).toBe(6);
    expect(cellAt(3, 1, 1)).toBe(8);
    expect(cellAt(3, -0.2, 1.4)).toBe(6);
  });

  it("steps with the arrow keys and stops at the edges", () => {
    expect(middleCell(7)).toBe(24);
    expect(stepCell(3, 4, "ArrowLeft")).toBe(3);
    expect(stepCell(3, 4, "ArrowRight")).toBe(5);
    expect(stepCell(3, 4, "ArrowUp")).toBe(1);
    expect(stepCell(3, 4, "ArrowDown")).toBe(7);
    expect(stepCell(3, 3, "ArrowLeft")).toBe(3);
    expect(stepCell(3, 5, "ArrowRight")).toBe(5);
    expect(stepCell(3, 1, "ArrowUp")).toBe(1);
    expect(stepCell(3, 7, "ArrowDown")).toBe(7);
  });

  it("names a square by its row and column from the top left", () => {
    expect(cellName(7, 0)).toBe("Row 1, column 1");
    expect(cellName(7, 24)).toBe("Row 4, column 4");
    expect(cellName(7, 13)).toBe("Row 2, column 7");
  });
});

describe("scoring a square", () => {
  it("pays the full 1,000 for the hottest square and scales the rest to it", () => {
    expect(hottestCells(MAP)).toEqual([6]);
    expect(spotPoints(MAP, 6)).toBe(SPOT_MAX);
    expect(spotPoints(MAP, 4)).toBe(500);
    expect(spotPoints(MAP, 7)).toBe(250);
    expect(spotPoints(MAP, 0)).toBe(0);
    expect(spotPoints(MAP, 99)).toBe(0);
  });

  it("scales to the map's largest even when it is below 1, and counts ties as hottest", () => {
    const low: AtlasLooked = { ...MAP, cells: [0.4, 0, 0, 0, 0.2, 0, 0.4, 0, 0] };
    expect(spotPoints(low, 0)).toBe(1000);
    expect(spotPoints(low, 4)).toBe(500);
    expect(hottestCells(low)).toEqual([0, 6]);
    expect(spotResult("x", low, 6)).toEqual({ id: "x", cell: 6, points: 1000, hottest: true });
  });

  it("words the answer by the points", () => {
    expect(spotVerdict(spotResult("x", MAP, 6))).toBe("Spot on");
    expect(spotVerdict(spotResult("x", MAP, 4))).toBe("Warm");
    expect(spotVerdict(spotResult("x", MAP, 7))).toBe("Cool");
    expect(spotVerdict(spotResult("x", MAP, 0))).toBe("Cold");
  });

  it("says where most of the map sits", () => {
    expect(hottestLine(MAP)).toMatch(/^Atlas's clue sits mostly toward the bottom/);
    expect(hottestLine({ ...MAP, cells: Array(9).fill(0) })).toBe(
      "No single part of the photo stood out to Atlas.",
    );
  });
});

describe("spotReducer", () => {
  it("plays each photo in order, then finishes", () => {
    let state = spotReducer(initialSpot, { type: "start", order: ["a", "b"] });
    expect(state.phase).toBe("picking");
    // A result for the wrong photo is ignored.
    expect(spotReducer(state, { type: "picked", result: spotResult("b", MAP, 6) })).toBe(state);
    state = spotReducer(state, { type: "picked", result: spotResult("a", MAP, 6) });
    expect(state.phase).toBe("answered");
    // A second pick on the answer is ignored.
    expect(spotReducer(state, { type: "picked", result: spotResult("a", MAP, 0) })).toBe(state);
    state = spotReducer(state, { type: "next" });
    expect(state.phase).toBe("picking");
    state = spotReducer(state, { type: "picked", result: spotResult("b", MAP, 4) });
    state = spotReducer(state, { type: "next" });
    expect(state.phase).toBe("done");
    if (state.phase !== "done") throw new Error("not done");
    expect(spotTotals(state.results)).toEqual({ points: 1500, hottest: 1 });
  });

  it("finishes at once with nothing to deal", () => {
    expect(spotReducer(initialSpot, { type: "start", order: [] })).toEqual({
      phase: "done",
      order: [],
      results: [],
    });
  });
});

describe("the best game", () => {
  it("keeps a higher score only", () => {
    expect(loadBestSpot()).toBe(0);
    expect(rememberSpot(2400)).toBe(2400);
    expect(rememberSpot(1800)).toBe(2400);
    expect(localStorage.getItem(BEST_SPOT_KEY)).toBe("2400");
    expect(rememberSpot(3100)).toBe(3100);
  });

  it("reads junk and impossible scores as none", () => {
    for (const raw of ["{", "-5", "1.5", "5001", '"300"']) {
      localStorage.setItem(BEST_SPOT_KEY, raw);
      expect(loadBestSpot()).toBe(0);
    }
  });

  it("still plays when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadBestSpot()).toBe(0);
    expect(rememberSpot(1200)).toBe(1200);
  });
});
