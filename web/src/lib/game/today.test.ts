import { beforeEach, describe, expect, it } from "vitest";

import { DAILY_SCORES_KEY } from "./dailyArchive";
import { rememberFarDay } from "./farDaily";
import { type PairResult } from "./howFar";
import { rememberNameDay } from "./nameDaily";
import { rememberNorthDay } from "./northDaily";
import { rememberOddDay } from "./oddDaily";
import { SAVED_GAME_KEY } from "./saved";
import { gamesDone, todayGames, todayShare, type TodayGameId } from "./today";
import { rememberWayDay } from "./wayDaily";

const DAY = "2026-11-03";
const NOW = new Date(`${DAY}T12:00:00Z`);
const HREF = "https://example.test/whereabout/today/?x=1#y";
const IDS = ["a", "b", "c", "d", "e"];

function pair(points: number, atlas: number | null = 500): PairResult {
  const estimate = (p: number) => ({ km: 100, ratio: 1.5, points: p, tooFar: false });
  return {
    actualKm: 100,
    you: estimate(points),
    atlas: atlas === null ? null : estimate(atlas),
  };
}

function savedDaily(day: string) {
  localStorage.setItem(
    SAVED_GAME_KEY,
    JSON.stringify({
      v: 1,
      savedAt: NOW.getTime() - 1000,
      mode: { kind: "daily", day },
      dealt: IDS,
      results: [],
      round: { photoId: "a", pin: { lng: 10, lat: 20 }, hintsUsed: 0 },
    }),
  );
}

const byId = (id: TodayGameId) => todayGames(DAY, IDS, NOW).find((g) => g.id === id)!;

beforeEach(() => localStorage.clear());

describe("todayGames", () => {
  it("lists all six daily games, none started in a new browser", () => {
    const games = todayGames(DAY, IDS, NOW);
    expect(games.map((g) => g.id)).toEqual([
      "daily-five",
      "further-north",
      "odd-one-out",
      "which-way",
      "how-far",
      "name-country",
    ]);
    expect(games.every((g) => g.status === "new" && g.line === "Not started")).toBe(true);
    expect(gamesDone(games)).toBe(0);
  });

  it("reads a finished Daily Five's score, ahead of a replay in progress", () => {
    localStorage.setItem(DAILY_SCORES_KEY, JSON.stringify({ [DAY]: 18240 }));
    savedDaily(DAY);
    expect(byId("daily-five")).toMatchObject({ status: "done", line: "18,240 of 25,000" });
  });

  it("shows today's Daily Five under way, but not another day's or another game", () => {
    savedDaily(DAY);
    expect(byId("daily-five")).toMatchObject({ status: "going", line: "Photo 1 of 5" });
    savedDaily("2026-11-02");
    expect(byId("daily-five").status).toBe("new");
  });

  it("reads each streak game's run, with its own noun and Atlas's tally", () => {
    rememberNorthDay(DAY, { streak: 1, atlasRight: 1, atlasPlayed: 2, ended: "miss" });
    rememberOddDay(DAY, { streak: 3, atlasRight: 0, atlasPlayed: 0, ended: null });
    rememberWayDay(DAY, { streak: 9, atlasRight: 4, atlasPlayed: 9, ended: "cleared", at: "a" });
    expect(byId("further-north")).toMatchObject({
      status: "done",
      line: "1 pair in a row",
      atlas: "1 of 2",
    });
    expect(byId("odd-one-out")).toMatchObject({
      status: "going",
      line: "3 quads in a row so far",
      atlas: null,
    });
    expect(byId("which-way")).toMatchObject({
      status: "done",
      line: "9 stops in a row, every photo",
      atlas: "4 of 9",
    });
  });

  it("reads today's Name the country, with its own plural", () => {
    rememberNameDay(DAY, { streak: 3, atlasRight: 2, atlasPlayed: 3, ended: "miss" });
    expect(byId("name-country")).toMatchObject({
      status: "done",
      line: "3 countries in a row",
      atlas: "2 of 3",
    });
    rememberNameDay(DAY, { streak: 1, atlasRight: 0, atlasPlayed: 0, ended: null });
    expect(byId("name-country").line).toBe("1 country in a row so far");
  });

  it("counts an empty run as not started, and a first-pick miss as played", () => {
    rememberNorthDay(DAY, { streak: 0, atlasRight: 0, atlasPlayed: 0, ended: null });
    expect(byId("further-north").status).toBe("new");
    rememberNorthDay(DAY, { streak: 0, atlasRight: 0, atlasPlayed: 1, ended: "miss" });
    expect(byId("further-north")).toMatchObject({ status: "done", line: "0 pairs in a row" });
  });

  it("reads How far apart?'s pairs, finished only when every pair is in", () => {
    rememberFarDay(DAY, { results: [pair(900), pair(100, null)] });
    expect(byId("how-far")).toMatchObject({
      status: "going",
      line: "2 of 5 pairs, 1,000 points",
      atlas: "500 points",
    });
    rememberFarDay(DAY, { results: [1, 2, 3, 4, 5].map(() => pair(700)) });
    expect(byId("how-far")).toMatchObject({
      status: "done",
      line: "3,500 of 5,000",
      atlas: "2,500 points",
    });
  });

  it("ignores another day's games and a malformed store", () => {
    rememberNorthDay("2026-11-02", { streak: 4, atlasRight: 0, atlasPlayed: 0, ended: "miss" });
    localStorage.setItem("whereabout:how-far-daily", "not json");
    localStorage.setItem(DAILY_SCORES_KEY, "{");
    expect(gamesDone(todayGames(DAY, IDS, NOW))).toBe(0);
  });
});

describe("todayShare", () => {
  it("gathers finished games only, with the page's clean address", () => {
    rememberNorthDay(DAY, { streak: 6, atlasRight: 3, atlasPlayed: 4, ended: "miss" });
    rememberFarDay(DAY, { results: [1, 2, 3, 4, 5].map(() => pair(700)) });
    rememberOddDay(DAY, { streak: 2, atlasRight: 0, atlasPlayed: 0, ended: null });
    expect(todayShare(DAY, todayGames(DAY, IDS, NOW), HREF)).toBe(
      [
        "Whereabout · Today · 2026-11-03",
        "2 of 6 daily games",
        "⬆️ Further North: 6 pairs in a row",
        "📏 How far apart?: 3,500 of 5,000",
        "https://example.test/whereabout/today/",
      ].join("\n"),
    );
  });
});
