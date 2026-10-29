import { describe, expect, it } from "vitest";

import { dayKey } from "@/lib/game/daily";
import type { RoundResult } from "@/lib/game/state";

import {
  EMPTY_RECORD,
  RECORD_KEY,
  addContinents,
  addGame,
  continentStandings,
  currentStreak,
  daysBetween,
  loadRecord,
  parseRecord,
  recordGame,
  resetRecord,
  tallyContinents,
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

/** A round on a photo from `country`: your score, and Atlas's (undefined if it sat out). */
function round(country: string | null, you: number, atlas?: number) {
  return {
    reveal: { score: you, answer: { country } },
    atlas: atlas === undefined ? null : { score: atlas },
  } as unknown as Pick<RoundResult, "reveal" | "atlas">;
}

describe("record by continent", () => {
  it("tallies a game's rounds by the continent of each photo, won as the summary counts it", () => {
    expect(
      tallyContinents([
        round("FR", 4000, 3000), // won
        round("de", 2000, 2000), // a tie is not a win
        round("JP", 1000, 4500), // lost
        round("PE", 3000), // Atlas sat out: played, not against Atlas
        round(null, 5000, 0), // no country from the backend: no continent
      ]),
    ).toEqual({
      Europe: { rounds: 2, vsAtlas: 2, won: 1 },
      Asia: { rounds: 1, vsAtlas: 1, won: 0 },
      "South America": { rounds: 1, vsAtlas: 0, won: 0 },
    });
  });

  it("adds each game's continents to the record, and old games add none", () => {
    const r = play(
      { ...fresh(10_000), continents: { Europe: { rounds: 5, vsAtlas: 5, won: 2 } } },
      fresh(8_000),
      {
        ...fresh(9_000),
        continents: {
          Europe: { rounds: 3, vsAtlas: 2, won: 1 },
          Asia: { rounds: 2, vsAtlas: 2, won: 2 },
        },
      },
    );
    expect(r.continents).toEqual({
      Asia: { rounds: 2, vsAtlas: 2, won: 2 },
      Europe: { rounds: 8, vsAtlas: 7, won: 3 },
    });
    expect(Object.keys(addContinents({ Oceania: r.continents.Asia! }, r.continents))).toEqual([
      "Asia",
      "Europe",
      "Oceania",
    ]);
  });

  it("names the continents beaten most and least only once two ranked ones differ", () => {
    expect(continentStandings({})).toBeNull();
    // Below the minimum of rounds against Atlas, a continent is not ranked.
    expect(
      continentStandings({
        Europe: { rounds: 5, vsAtlas: 5, won: 5 },
        Asia: { rounds: 9, vsAtlas: 2, won: 0 },
      }),
    ).toBeNull();
    // 2 of 3 and 4 of 6 are the same share: nothing to tell apart.
    expect(
      continentStandings({
        Europe: { rounds: 3, vsAtlas: 3, won: 2 },
        Asia: { rounds: 6, vsAtlas: 6, won: 4 },
      }),
    ).toBeNull();
    expect(
      continentStandings({
        Africa: { rounds: 3, vsAtlas: 3, won: 0 },
        Europe: { rounds: 3, vsAtlas: 3, won: 3 },
        Asia: { rounds: 6, vsAtlas: 6, won: 6 },
        Oceania: { rounds: 4, vsAtlas: 4, won: 0 },
      }),
    ).toEqual({
      // Equal shares go to the continent with more rounds.
      most: { continent: "Asia", won: 6, vsAtlas: 6 },
      least: { continent: "Oceania", won: 0, vsAtlas: 4 },
    });
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

  it("keeps continents through storage and reads records saved before them", () => {
    const store = memoryStore();
    const game = { ...fresh(10_000, 2), continents: { Europe: { rounds: 5, vsAtlas: 5, won: 2 } } };
    expect(recordGame(game, store).continents).toEqual(game.continents);
    expect(loadRecord(store).continents).toEqual(game.continents);

    const old = { ...play(fresh(10_000, 2)) } as Partial<typeof EMPTY_RECORD>;
    delete old.continents;
    expect(parseRecord(JSON.stringify(old))).toMatchObject({
      games: 1,
      roundsWon: 2,
      continents: {},
    });
  });

  it("drops tampered continents but keeps the rest of the record", () => {
    const good = play(fresh(10_000, 2));
    for (const continents of [
      [],
      "Europe",
      { Atlantis: { rounds: 1, vsAtlas: 1, won: 1 } },
      { Europe: { rounds: 1, vsAtlas: 1, won: 2 } },
      { Europe: { rounds: 1, vsAtlas: 2, won: 0 } },
      { Europe: { rounds: -1, vsAtlas: 0, won: 0 } },
      { Europe: null },
    ]) {
      const r = parseRecord(JSON.stringify({ ...good, continents }));
      expect(r).toEqual({ ...good, continents: {} });
    }
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
