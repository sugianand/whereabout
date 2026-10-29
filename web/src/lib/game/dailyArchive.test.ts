import { describe, expect, it } from "vitest";

import {
  ARCHIVE_DAYS,
  ARCHIVE_NOTICE,
  DAILY_SCORES_KEY,
  addDailyScore,
  archiveDays,
  daysBefore,
  inArchive,
  isDayKey,
  loadDailyScores,
  parseDailyParam,
  parseDailyScores,
  rememberDailyScore,
  type ScoreStore,
} from "./dailyArchive";

const TODAY = "2026-10-29";

function memoryStore(): ScoreStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("puzzle days", () => {
  it("accepts only real calendar days", () => {
    expect(isDayKey("2026-10-01")).toBe(true);
    expect(isDayKey("2028-02-29")).toBe(true);
    expect(isDayKey("2026-02-29")).toBe(false);
    expect(isDayKey("2026-13-01")).toBe(false);
    expect(isDayKey("2026-1-01")).toBe(false);
    expect(isDayKey("")).toBe(false);
    expect(isDayKey(20261001)).toBe(false);
  });

  it("counts back across months and years in UTC", () => {
    expect(daysBefore("2026-03-01", 1)).toBe("2026-02-28");
    expect(daysBefore("2027-01-01", 1)).toBe("2026-12-31");
    expect(daysBefore(TODAY, 0)).toBe(TODAY);
  });

  it("lists the archive newest first, today included, the oldest 29 days back", () => {
    const days = archiveDays(TODAY);
    expect(days).toHaveLength(ARCHIVE_DAYS);
    expect(days[0]).toBe(TODAY);
    expect(days[1]).toBe("2026-10-28");
    expect(days[ARCHIVE_DAYS - 1]).toBe("2026-09-30");
    expect(new Set(days).size).toBe(ARCHIVE_DAYS);
  });

  it("keeps the archive to days from 29 days ago up to today", () => {
    expect(inArchive(TODAY, TODAY)).toBe(true);
    expect(inArchive("2026-09-30", TODAY)).toBe(true);
    expect(inArchive("2026-09-29", TODAY)).toBe(false);
    expect(inArchive("2026-10-30", TODAY)).toBe(false);
    expect(inArchive("nonsense", TODAY)).toBe(false);
  });
});

describe("parseDailyParam", () => {
  it("plays today's for a bare ?daily, today's date or something that isn't a date", () => {
    for (const value of ["", TODAY, "yesterday", "2026-02-30"]) {
      expect(parseDailyParam(value, TODAY)).toEqual({ day: TODAY, archive: false });
    }
  });

  it("plays a past day from the archive as an archive game", () => {
    expect(parseDailyParam("2026-10-20", TODAY)).toEqual({ day: "2026-10-20", archive: true });
    expect(parseDailyParam("2026-09-30", TODAY)).toEqual({ day: "2026-09-30", archive: true });
  });

  it("falls back to today's, saying why, for a day ahead or out of the archive", () => {
    expect(parseDailyParam("2026-10-30", TODAY)).toEqual({
      day: TODAY,
      archive: false,
      notice: ARCHIVE_NOTICE.ahead,
    });
    expect(parseDailyParam("2026-09-29", TODAY)).toEqual({
      day: TODAY,
      archive: false,
      notice: ARCHIVE_NOTICE.old,
    });
  });
});

describe("daily scores", () => {
  it("keeps the first finish of a day; a replay never replaces it", () => {
    let scores = addDailyScore({}, "2026-10-20", 12_000, TODAY);
    scores = addDailyScore(scores, "2026-10-20", 24_000, TODAY);
    expect(scores).toEqual({ "2026-10-20": 12_000 });
  });

  it("drops days that have left the archive and ignores scores that can't be", () => {
    const scores = addDailyScore({ "2026-09-01": 100, "2026-10-01": 200 }, TODAY, 300, TODAY);
    expect(scores).toEqual({ "2026-10-01": 200, [TODAY]: 300 });
    expect(addDailyScore({}, TODAY, -1, TODAY)).toEqual({});
    expect(addDailyScore({}, TODAY, 25_001, TODAY)).toEqual({});
    expect(addDailyScore({}, TODAY, 1.5, TODAY)).toEqual({});
    expect(addDailyScore({}, "2026-10-30", 10, TODAY)).toEqual({});
  });

  it("reads back only well-formed entries", () => {
    expect(parseDailyScores(null, TODAY)).toEqual({});
    expect(parseDailyScores("not json", TODAY)).toEqual({});
    expect(parseDailyScores("[1,2]", TODAY)).toEqual({});
    expect(
      parseDailyScores(
        JSON.stringify({ [TODAY]: 5000, "2026-10-28": "5000", "2026-10-27": 99_999, x: 1 }),
        TODAY,
      ),
    ).toEqual({ [TODAY]: 5000 });
  });

  it("survives storage that throws, and remembers through storage that works", () => {
    const broken: ScoreStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadDailyScores(TODAY, broken)).toEqual({});
    expect(rememberDailyScore(TODAY, 9000, TODAY, broken)).toEqual({ [TODAY]: 9000 });

    const store = memoryStore();
    rememberDailyScore("2026-10-25", 7000, TODAY, store);
    rememberDailyScore(TODAY, 9000, TODAY, store);
    expect(JSON.parse(store.data.get(DAILY_SCORES_KEY)!)).toEqual({
      "2026-10-25": 7000,
      [TODAY]: 9000,
    });
    // A month later the old days have gone from what is read back.
    expect(loadDailyScores("2026-11-24", store)).toEqual({ [TODAY]: 9000 });
  });
});
