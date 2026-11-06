import { beforeEach, describe, expect, it } from "vitest";

import { DAYS_KEPT } from "./dailyRuns";
import {
  LINE_DAILY_KEY,
  dailyLineRows,
  lineDailyShare,
  loadLineDay,
  parseLineDay,
  rememberLineDay,
  rowSquares,
} from "./lineDaily";
import { ROW, ROWS, judgeRow, type RowResult, type Spots } from "./lineUp";

const DAY = "2026-11-06";
const HREF = "https://example.test/whereabout/line-up/daily/?x=1#y";

const regions = {
  Europe: ["e1", "e2", "e3", "e4", "e5", "e6"],
  Asia: ["a1", "a2", "a3", "a4", "a5", "a6"],
  Africa: ["f1", "f2", "f3", "f4", "f5", "f6"],
  "North America": ["n1", "n2", "n3", "n4", "n5", "n6"],
};

const SPOTS: Spots = {
  lima: { lng: -77, atlasLng: -70 },
  paris: { lng: 2, atlasLng: 30 },
  cairo: { lng: 31, atlasLng: 10 },
  tokyo: { lng: 139, atlasLng: 120 },
};
const ROW_ON_SCREEN = ["lima", "cairo", "paris", "tokyo"];
const judged = judgeRow(ROW_ON_SCREEN, SPOTS);

beforeEach(() => localStorage.clear());

describe("dailyLineRows", () => {
  it("deals everyone the same five rows on a day, and others the next", () => {
    const rows = dailyLineRows(regions, DAY);
    expect(rows).toHaveLength(ROWS);
    expect(rows.every((r) => r.length === ROW)).toBe(true);
    expect(new Set(rows.flat()).size).toBe(ROWS * ROW);
    expect(dailyLineRows(regions, DAY)).toEqual(rows);
    expect(dailyLineRows(regions, "2026-11-07")).not.toEqual(rows);
  });
});

describe("the kept day", () => {
  it("round-trips the rows locked so far, per day", () => {
    rememberLineDay(DAY, { results: [judged] });
    expect(loadLineDay(DAY)).toEqual({ results: [judged] });
    expect(loadLineDay("2026-11-05")).toBeNull();
  });

  it("keeps only the latest days", () => {
    for (let d = 1; d <= DAYS_KEPT + 1; d++) {
      const day = `2026-${d > 30 ? "11" : "10"}-${String(d > 30 ? d - 30 : d).padStart(2, "0")}`;
      rememberLineDay(day, { results: [] });
    }
    expect(loadLineDay("2026-10-01")).toBeNull();
    expect(loadLineDay("2026-11-01")).not.toBeNull();
  });

  it("works its points out from the places, whatever was stored", () => {
    const day = parseLineDay({ results: [{ ...judged, points: 4 }] });
    expect(day?.results[0].points).toBe(judged.right.filter(Boolean).length);
  });

  it.each<[string, (r: RowResult) => unknown]>([
    ["too few photos", (r) => ({ ...r, order: r.order.slice(1) })],
    ["a photo twice", (r) => ({ ...r, order: ["lima", "lima", "paris", "tokyo"] })],
    ["other photos in the true order", (r) => ({ ...r, east: ["x", "y", "z", "w"] })],
    ["other photos in Atlas's order", (r) => ({ ...r, atlas: { ...r.atlas, order: ["x", "y", "z", "w"] } })],
    ["Atlas over the limit", (r) => ({ ...r, atlas: { ...r.atlas, points: ROW + 1 } })],
    ["a place that isn't yes or no", (r) => ({ ...r, right: [true, 1, false, true] })],
    ["too few places", (r) => ({ ...r, right: r.right.slice(1) })],
  ])("won't read back a row with %s", (_, spoil) => {
    expect(parseLineDay({ results: [spoil(judged)] })).toBeNull();
  });

  it("won't read back more rows than a game has, or a broken store", () => {
    expect(parseLineDay({ results: Array(ROWS + 1).fill(judged) })).toBeNull();
    localStorage.setItem(LINE_DAILY_KEY, "not json");
    expect(loadLineDay(DAY)).toBeNull();
  });
});

describe("lineDailyShare", () => {
  it("is squares and counts, with no photo or place in it", () => {
    const right = judgeRow(["lima", "paris", "cairo", "tokyo"], SPOTS);
    const text = lineDailyShare(DAY, [right, judged], HREF);
    expect(rowSquares(judged)).toBe("🟩🟥🟥🟩");
    expect(text).toBe(
      [
        `Whereabout · Line them up · ${DAY}`,
        "↔️ 6 of 8 in place",
        "🟩🟩🟩🟩",
        "🟩🟥🟥🟩",
        "Atlas: 4 of 8",
        "https://example.test/whereabout/line-up/daily/",
      ].join("\n"),
    );
    for (const place of Object.keys(SPOTS)) expect(text).not.toContain(place);
  });

  it("leaves Atlas out when it sat every row out", () => {
    const text = lineDailyShare(DAY, [{ ...judged, atlas: null }], HREF);
    expect(text).not.toContain("Atlas");
  });
});
