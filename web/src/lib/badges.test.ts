import { describe, expect, it } from "vitest";

import { dayKey } from "@/lib/game/daily";
import type { RoundResult } from "@/lib/game/state";

import {
  BADGES,
  BADGE_IDS,
  BULLSEYE_KM,
  GLOBETROTTER_CONTINENTS,
  gameFeats,
  mergeBadges,
  newBadges,
} from "./badges";
import {
  EMPTY_RECORD,
  RECORD_KEY,
  addGame,
  loadRecord,
  parseRecord,
  recordGame,
  tallyContinents,
  type FinishedGame,
  type RecordStore,
} from "./playerRecord";
import { totals } from "./game/state";

/** One played round: where its photo was, how far the pin landed, your score and Atlas's. */
function round(
  country: string,
  km: number | null,
  you: number,
  atlas?: number,
): Pick<RoundResult, "reveal" | "atlas"> {
  return {
    reveal: { distanceKm: km, score: you, answer: { country } },
    atlas: atlas === undefined ? null : { score: atlas },
  } as unknown as Pick<RoundResult, "reveal" | "atlas">;
}

/** A finished game built from its rounds the way the game itself records it. */
function finish(
  rounds: Pick<RoundResult, "reveal" | "atlas">[],
  { daily = null, hard = false }: { daily?: string | null; hard?: boolean } = {},
): FinishedGame {
  const t = totals(rounds as RoundResult[]);
  return {
    score: t.player,
    roundsVsAtlas: t.atlasRounds,
    roundsWon: t.playerWins,
    daily,
    continents: tallyContinents(rounds),
    ...gameFeats(rounds, hard),
  };
}

/** Five rounds in Europe, far away and behind Atlas on each: earns nothing. */
const dull = () => Array.from({ length: 5 }, () => round("FR", 900, 1000, 3000));

function memoryStore(): RecordStore {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("badges", () => {
  it("lists each badge once, in id order, with a way to earn it", () => {
    expect(BADGES.map((b) => b.id)).toEqual([...BADGE_IDS]);
    for (const b of BADGES) expect(b.how.length).toBeGreaterThan(0);
  });

  it("a game that earns nothing adds no badge", () => {
    expect(addGame(EMPTY_RECORD, finish(dull())).badges).toEqual([]);
  });

  it("First win: the first round scored above Atlas, not a tie or a round Atlas sat out", () => {
    const tie = [round("FR", 900, 3000, 3000), round("FR", 900, 4000)];
    let r = addGame(EMPTY_RECORD, finish(tie));
    expect(r.badges).toEqual([]);
    r = addGame(r, finish([...dull().slice(1), round("FR", 900, 3001, 3000)]));
    expect(r.badges).toEqual(["first-win"]);
  });

  it(`Bullseye: a pin within ${BULLSEYE_KM} km, counted from the game's closest pin`, () => {
    const near = (km: number) => [...dull().slice(1), round("FR", km, 4900, 4990)];
    expect(addGame(EMPTY_RECORD, finish(near(25.4))).badges).toEqual([]);
    expect(addGame(EMPTY_RECORD, finish(near(25))).badges).toEqual(["bullseye"]);
    // A Blitz round that timed out with no pin has no distance and earns nothing.
    expect(gameFeats([round("FR", null, 0, 2000)], false).closestKm).toBeNull();
  });

  it("Five-day streak: five Daily Fives on consecutive puzzle days", () => {
    let r = EMPTY_RECORD;
    for (let d = 1; d <= 5; d++) {
      expect(r.badges).not.toContain("daily-five");
      r = addGame(r, finish(dull(), { daily: dayKey(new Date(`2026-10-0${d}T12:00:00Z`)) }));
    }
    expect(r.streak).toBe(5);
    expect(r.badges).toEqual(["daily-five"]);
    // Missing a day breaks the streak but never takes the badge away.
    r = addGame(r, finish(dull(), { daily: "2026-10-09" }));
    expect(r.streak).toBe(1);
    expect(r.badges).toEqual(["daily-five"]);
  });

  it("Globetrotter: a round on each of the six inhabited continents, across games", () => {
    expect(GLOBETROTTER_CONTINENTS).not.toContain("Antarctica");
    const countries = ["FR", "JP", "KE", "US", "BR"];
    let r = addGame(EMPTY_RECORD, finish(countries.map((c) => round(c, 900, 1000, 3000))));
    expect(r.badges).toEqual([]);
    r = addGame(r, finish([...dull().slice(1), round("NZ", 900, 1000, 3000)]));
    expect(r.badges).toEqual(["globetrotter"]);
  });

  it("Hard won: a Hard game outscoring Atlas in total, even while losing most rounds", () => {
    const rounds = [
      round("FR", 5, 5000, 1000),
      ...Array.from({ length: 4 }, () => round("FR", 900, 2000, 2100)),
    ];
    expect(totals(rounds as RoundResult[]).playerWins).toBe(1);
    expect(addGame(EMPTY_RECORD, finish(rounds, { hard: true })).badges).toContain("hard-won");
    // The same game on any other tier doesn't count, and neither does losing on Hard.
    expect(addGame(EMPTY_RECORD, finish(rounds)).badges).not.toContain("hard-won");
    expect(addGame(EMPTY_RECORD, finish(dull(), { hard: true })).badges).toEqual([]);
    // Nor does a Hard game in which Atlas guessed nothing.
    expect(gameFeats([round("FR", 900, 2000)], true).hardWon).toBe(false);
  });

  it("names only the badges a game newly earned", () => {
    const before = addGame(
      EMPTY_RECORD,
      finish([...dull().slice(1), round("FR", 900, 3001, 3000)]),
    );
    const after = addGame(before, finish([...dull().slice(1), round("FR", 3, 4999, 3000)]));
    expect(after.badges).toEqual(["first-win", "bullseye"]);
    expect(newBadges(before.badges, after.badges)).toEqual(["bullseye"]);
    expect(mergeBadges(["hard-won"], ["first-win", "hard-won"])).toEqual(["first-win", "hard-won"]);
  });

  it("keeps badges through storage and restores what older records' totals prove", () => {
    const store = memoryStore();
    const r = recordGame(finish([...dull().slice(1), round("FR", 3, 4999, 3000)]), store);
    expect(loadRecord(store).badges).toEqual(["first-win", "bullseye"]);

    // A record saved before badges: its first win comes back; a bullseye can't be proven.
    const old: Record<string, unknown> = { ...r };
    delete old.badges;
    expect(parseRecord(JSON.stringify(old)).badges).toEqual(["first-win"]);
    // An unknown badge drops the stored list, never the record.
    const tampered = parseRecord(JSON.stringify({ ...r, badges: ["bullseye", "moon-landing"] }));
    expect(tampered).toMatchObject({ games: 1, badges: ["first-win"] });
    expect(store.getItem(RECORD_KEY)).toContain('"badges":["first-win","bullseye"]');
  });
});
