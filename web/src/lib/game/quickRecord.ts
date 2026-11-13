/**
 * Atlas's quick-game record: how your picks in Further North and Odd one out, and your clue
 * reading in Left or right? (the road) and Which climate? (the climate), compare with Atlas's
 * on the same photos, from the games played in this browser.
 *
 * Two sources are added up per game:
 * - free runs, tallied here round by round as they are answered (`recordFreeRound`), under
 *   `QUICK_RECORD_KEY`, so leaving mid-run still counts the rounds played;
 * - today's runs, read back from the days each game already keeps (src/lib/game/dailyRuns.ts),
 *   so nothing is counted twice: the daily screens never call `recordFreeRound`. Which climate?
 *   has no daily, so its record is its free games alone.
 *
 * You are judged on every round you answered, Atlas on the rounds it played (it sits out a
 * round where it never guessed one of the photos), so each side's rate is over its own rounds
 * and the record says how many each one is. Storage is best effort, as for the bests.
 */

import { loadDailyRuns, type DailyRun } from "./dailyRuns";
import { NORTH_DAILY_KEY } from "./northDaily";
import { ODD_DAILY_KEY } from "./oddDaily";
import { SIDE_DAILY_KEY } from "./sideDaily";

export const QUICK_RECORD_KEY = "whereabout:quick-record";

/** The quick games Atlas plays along in, in the order the record lists them. */
export const RECORD_GAMES = [
  "further-north",
  "odd-one-out",
  "left-right",
  "which-climate",
] as const;
export type RecordGame = (typeof RECORD_GAMES)[number];

/** The clue games, each drilling one clue the reveal teaches: the road and the climate. */
export const CLUE_GAMES = ["left-right", "which-climate"] as const satisfies readonly RecordGame[];
/** The rest: picking between photos. */
export const PICK_GAMES = ["further-north", "odd-one-out"] as const satisfies readonly RecordGame[];

/** What each game's daily days are kept under; a game with no daily has none. */
const DAILY_KEYS: Partial<Record<RecordGame, string>> = {
  "further-north": NORTH_DAILY_KEY,
  "odd-one-out": ODD_DAILY_KEY,
  "left-right": SIDE_DAILY_KEY,
};

/** Rounds played and got right, by you and by Atlas. */
export interface Tally {
  /** Runs with at least one round answered. */
  runs: number;
  /** Rounds you answered, and how many of them you got right. */
  rounds: number;
  right: number;
  /** Rounds Atlas played (guessed every photo of), and how many it got right. */
  atlasPlayed: number;
  atlasRight: number;
}

export const EMPTY_TALLY: Tally = { runs: 0, rounds: 0, right: 0, atlasPlayed: 0, atlasRight: 0 };

/** One game's record: free runs, today's runs, and both together. */
export interface GameRecord {
  free: Tally;
  daily: Tally;
  total: Tally;
}

export type QuickRecord = Record<RecordGame, GameRecord>;

const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** A stored tally read back only in the shape `recordFreeRound` writes, else null. */
export function parseTally(value: unknown): Tally | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const { runs, rounds, right, atlasPlayed, atlasRight } = v;
  if (
    !count(runs) ||
    !count(rounds) ||
    !count(right) ||
    !count(atlasPlayed) ||
    !count(atlasRight)
  ) {
    return null;
  }
  if (right > rounds || atlasRight > atlasPlayed || atlasPlayed > rounds || runs > rounds) {
    return null;
  }
  return { runs, rounds, right, atlasPlayed, atlasRight };
}

export function addTallies(a: Tally, b: Tally): Tally {
  return {
    runs: a.runs + b.runs,
    rounds: a.rounds + b.rounds,
    right: a.right + b.right,
    atlasPlayed: a.atlasPlayed + b.atlasPlayed,
    atlasRight: a.atlasRight + b.atlasRight,
  };
}

/**
 * Today's runs as a tally. A day's streak is its right rounds; a run that ended on a miss
 * answered one round more. A day started but not yet answered counts for nothing.
 */
export function dailyTally(days: Readonly<Record<string, DailyRun>>): Tally {
  let tally = EMPTY_TALLY;
  for (const day of Object.values(days)) {
    const rounds = day.streak + (day.ended === "miss" ? 1 : 0);
    if (rounds === 0) continue;
    tally = addTallies(tally, {
      runs: 1,
      rounds,
      right: day.streak,
      atlasPlayed: day.atlasPlayed,
      atlasRight: day.atlasRight,
    });
  }
  return tally;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The free runs' tallies kept in this browser; a game with nothing (or junk) kept is empty. */
export function loadFreeTallies(): Record<RecordGame, Tally> {
  const tallies = Object.fromEntries(RECORD_GAMES.map((g) => [g, EMPTY_TALLY])) as Record<
    RecordGame,
    Tally
  >;
  try {
    const raw = storage()?.getItem(QUICK_RECORD_KEY);
    if (!raw) return tallies;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return tallies;
    for (const game of RECORD_GAMES) {
      const parsed = parseTally((value as Record<string, unknown>)[game]);
      if (parsed) tallies[game] = parsed;
    }
  } catch {
    // Unreadable storage: nothing kept.
  }
  return tallies;
}

/** One answered round of a free run. */
export interface RoundResult {
  /** True for the run's first answered round, which starts a new run in the tally. */
  first: boolean;
  correct: boolean;
  /** Whether Atlas got the round right, or null when it sat the round out. */
  atlas: boolean | null;
}

/** The tally after one more round. */
export function addRound(tally: Tally, round: RoundResult): Tally {
  return addTallies(tally, {
    runs: round.first ? 1 : 0,
    rounds: 1,
    right: round.correct ? 1 : 0,
    atlasPlayed: round.atlas === null ? 0 : 1,
    atlasRight: round.atlas ? 1 : 0,
  });
}

/** Count one answered round of a free run of `game`, and return that game's free tally. */
export function recordFreeRound(game: RecordGame, round: RoundResult): Tally {
  const tallies = loadFreeTallies();
  tallies[game] = addRound(tallies[game], round);
  try {
    storage()?.setItem(QUICK_RECORD_KEY, JSON.stringify(tallies));
  } catch {
    // Private mode or full storage: the round still counted on screen.
  }
  return tallies[game];
}

/** Every game's record in this browser: the free runs' tallies and the days kept. */
export function loadQuickRecord(): QuickRecord {
  const free = loadFreeTallies();
  const record = {} as QuickRecord;
  for (const game of RECORD_GAMES) {
    const key = DAILY_KEYS[game];
    const daily = key ? dailyTally(loadDailyRuns(key)) : EMPTY_TALLY;
    record[game] = { free: free[game], daily, total: addTallies(free[game], daily) };
  }
  return record;
}

/** A whole-number percentage of `part` in `whole`, or null with no rounds. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/** Who is ahead: each side's rate, and the gap in percentage points (positive: you lead). */
export interface Standing {
  you: number | null;
  atlas: number | null;
  /** "you" or "atlas" ahead, "level" on the same rate, null until both have played a round. */
  lead: "you" | "atlas" | "level" | null;
  gap: number;
}

export function standing(tally: Tally): Standing {
  const you = percent(tally.right, tally.rounds);
  const atlas = percent(tally.atlasRight, tally.atlasPlayed);
  if (you === null || atlas === null) return { you, atlas, lead: null, gap: 0 };
  const gap = you - atlas;
  return { you, atlas, lead: gap > 0 ? "you" : gap < 0 ? "atlas" : "level", gap };
}

const counted = (n: number, unit: string) =>
  `${n.toLocaleString("en-US")} ${unit}${n === 1 ? "" : "s"}`;

/**
 * The record in one sentence, from its own numbers. `unit` is what a round is called: a round
 * of picking between photos, or a photo in the clue games.
 */
export function standingLine(tally: Tally, unit = "round"): string {
  const s = standing(tally);
  if (s.you === null) return `No ${unit}s played yet.`;
  if (s.atlas === null) return `Atlas hasn't played a ${unit} with you yet.`;
  const points = Math.abs(s.gap);
  const by = `${points} point${points === 1 ? "" : "s"}`;
  if (s.lead === "you") return `You're ahead of Atlas by ${by}.`;
  if (s.lead === "atlas") return `Atlas is ahead of you by ${by}.`;
  return `You and Atlas are level.`;
}

/** "31 of 40 rounds right" for you, the same for Atlas over the rounds it played. */
export function rightOf(right: number, played: number, unit = "round"): string {
  return `${right.toLocaleString("en-US")} of ${counted(played, unit)} right`;
}
