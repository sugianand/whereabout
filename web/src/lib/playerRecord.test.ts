import { describe, expect, it } from "vitest";

import { dayKey } from "@/lib/game/daily";

import {
  EMPTY_RECORD,
  RECORD_KEY,
  addGame,
  currentStreak,
  daysBetween,
  loadRecord,
  parseRecord,
  recordGame,
  resetRecord,
  type FinishedGame,
  type RecordStore,
} from "./playerRecord";

function memoryStore(): RecordStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: RecordStore = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const fresh = (score: number, won = 0, vs = 5): FinishedGame => ({
  score,
  roundsWon: won,
  roundsVsAtlas: vs,
  daily: null,
});
/** A Daily Five finished at instant `at`, wherever the player was. */
const dailyAt = (at: string, score = 10_000): FinishedGame => ({
  score,
  roundsWon: 2,
  roundsVsAtlas: 5,
  daily: dayKey(new Date(at)),
});

function play(...games: FinishedGame[]) {
  return games.reduce(addGame, EMPTY_RECORD);
}

describe("record of games against Atlas", () => {
  it("counts games, rounds won against Atlas and keeps the best score", () => {
    const r = play(fresh(12_000, 3), fresh(18_500, 4), fresh(9_000, 1, 3));
    expect(r.games).toBe(3);
    expect(r.roundsWon).toBe(8);
    expect(r.roundsVsAtlas).toBe(13);
    expect(r.best).toBe(18_500);
    expect(r.streak).toBe(0);
  });

  it("counts a zero-point game as a best of zero, not as no game", () => {
    expect(play(fresh(0)).best).toBe(0);
    expect(EMPTY_RECORD.best).toBeNull();
  });
});

describe("Daily Five streaks", () => {
  it("grows on consecutive puzzle days and restarts after a missed day", () => {
    const r = play(
      dailyAt("2026-10-20T09:00:00Z"),
      dailyAt("2026-10-21T09:00:00Z"),
      dailyAt("2026-10-22T09:00:00Z"),
    );
    expect(r.streak).toBe(3);
    const broken = addGame(r, dailyAt("2026-10-24T09:00:00Z"));
    expect(broken.streak).toBe(1);
    expect(broken.bestStreak).toBe(3);
  });

  it("leaves the streak alone for a replay of the same day and for fresh games", () => {
    const r = play(dailyAt("2026-10-20T09:00:00Z"), dailyAt("2026-10-21T09:00:00Z"));
    const replayed = addGame(addGame(r, dailyAt("2026-10-21T22:00:00Z")), fresh(5_000));
    expect(replayed.streak).toBe(2);
    expect(replayed.games).toBe(4);
    expect(replayed.lastDaily).toBe("2026-10-21");
  });

  it("ignores an older puzzle day, as when the clock moved back", () => {
    const r = play(dailyAt("2026-10-21T09:00:00Z"), dailyAt("2026-10-19T09:00:00Z"));
    expect(r.streak).toBe(1);
    expect(r.lastDaily).toBe("2026-10-21");
  });

  it("follows UTC puzzle days, so a late evening and next morning in Los Angeles are one day", () => {
    // 17:30 and 09:00 the next morning in Los Angeles (UTC-7) are both October 22 in UTC.
    const r = play(dailyAt("2026-10-21T17:30:00-07:00"), dailyAt("2026-10-22T09:00:00-07:00"));
    expect(r.streak).toBe(1);
    // The following evening is October 23 in UTC: the streak goes on.
    expect(addGame(r, dailyAt("2026-10-22T18:00:00-07:00")).streak).toBe(2);
  });

  it("follows the puzzle, not the local date, in Tokyo where it changes at 09:00", () => {
    // 08:00 in Tokyo (UTC+9) is still the previous UTC day's puzzle.
    const r = play(dailyAt("2026-10-21T08:00:00+09:00"), dailyAt("2026-10-22T08:00:00+09:00"));
    expect(r.lastDaily).toBe("2026-10-21");
    expect(r.streak).toBe(2);
    // 08:00 one morning, then 10:00 the next: two local days, but October 21's puzzle was missed.
    const skipped = play(
      dailyAt("2026-10-21T08:00:00+09:00"),
      dailyAt("2026-10-22T10:00:00+09:00"),
    );
    expect(skipped.lastDaily).toBe("2026-10-22");
    expect(skipped.streak).toBe(1);
  });

  it("does not break across a daylight-saving change", () => {
    // Europe leaves summer time overnight on 25 October 2026; the local day is 25 hours long.
    const r = play(
      dailyAt("2026-10-24T20:00:00+02:00"),
      dailyAt("2026-10-25T20:00:00+01:00"),
      dailyAt("2026-10-26T20:00:00+01:00"),
    );
    expect(r.streak).toBe(3);
  });

  it("counts whole UTC days between puzzle days, across months and leap years", () => {
    expect(daysBetween("2026-10-31", "2026-11-01")).toBe(1);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-10-22", "2026-10-22")).toBe(0);
  });

  it("shows a streak as alive until a whole puzzle day goes unplayed", () => {
    const r = play(dailyAt("2026-10-21T12:00:00Z"), dailyAt("2026-10-22T12:00:00Z"));
    expect(currentStreak(r, new Date("2026-10-22T23:59:00Z"))).toBe(2);
    // Next day, today's puzzle not played yet: still alive.
    expect(currentStreak(r, new Date("2026-10-23T23:59:00Z"))).toBe(2);
    // A whole day missed.
    expect(currentStreak(r, new Date("2026-10-24T00:01:00Z"))).toBe(0);
    // In New York it is still the evening of the 23rd, but the puzzle day has moved on.
    expect(currentStreak(r, new Date("2026-10-23T21:00:00-04:00"))).toBe(0);
    expect(currentStreak(EMPTY_RECORD, new Date())).toBe(0);
  });
});

describe("record storage", () => {
  it("adds each finished game to the stored record and reads it back", () => {
    const store = memoryStore();
    recordGame(fresh(10_000, 2), store);
    const r = recordGame(dailyAt("2026-10-22T12:00:00Z", 15_000), store);
    expect(r).toEqual(loadRecord(store));
    expect(r).toMatchObject({ games: 2, roundsWon: 4, best: 15_000, streak: 1 });
    expect(JSON.parse(store.data.get(RECORD_KEY)!)).toEqual(r);
  });

  it("resets to an empty record", () => {
    const store = memoryStore();
    recordGame(fresh(10_000), store);
    expect(resetRecord(store)).toEqual(EMPTY_RECORD);
    expect(store.data.has(RECORD_KEY)).toBe(false);
    expect(loadRecord(store)).toEqual(EMPTY_RECORD);
  });

  it("still returns this game's record when storage throws or is missing", () => {
    expect(recordGame(fresh(7_000, 1), throwing)).toMatchObject({ games: 1, best: 7_000 });
    expect(recordGame(fresh(7_000), null).games).toBe(1);
    expect(loadRecord(throwing)).toEqual(EMPTY_RECORD);
    expect(resetRecord(throwing)).toEqual(EMPTY_RECORD);
  });

  it("starts over rather than trusting a corrupt or tampered record", () => {
    const good = JSON.stringify(play(fresh(10_000, 2)));
    expect(parseRecord(good).games).toBe(1);
    for (const raw of [
      "not json",
      "null",
      "[]",
      JSON.stringify({ ...JSON.parse(good), games: -1 }),
      JSON.stringify({ ...JSON.parse(good), roundsWon: 9, roundsVsAtlas: 5 }),
      JSON.stringify({ ...JSON.parse(good), best: "lots" }),
      JSON.stringify({ ...JSON.parse(good), lastDaily: "yesterday" }),
      JSON.stringify({ ...JSON.parse(good), streak: 4, bestStreak: 2 }),
      JSON.stringify({ games: 3 }),
    ]) {
      expect(parseRecord(raw)).toEqual(EMPTY_RECORD);
    }
  });
});
