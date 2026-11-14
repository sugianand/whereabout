/**
 * Today's Clue mix: one run a day that everyone plays on the same photos, asking the same clue
 * of each, dealt from the UTC date by the free runs' own even deal (`dealClueMix` in
 * ./clueMix.ts), so each step's answer is still drawn by a fair die and always giving one answer
 * is still a guess.
 *
 * One try a day: the run is kept after every call (./dailyRuns.ts), so a reload picks up at the
 * same step and a finished run shows the day's result instead of dealing it again. A step's clue
 * is fixed by its place in the cycle, so the streak alone says where a run stands. It never
 * touches the free runs' best, and the share line is counts only, so it spoils no photo.
 */

import { CLUE_CYCLE, dealClueMix, type ClueKind, type ClueMaps, type ClueStep } from "./clueMix";
import { hashSeed } from "./daily";
import {
  dailyRunUrl,
  loadDailyRun,
  loadDailyRuns,
  rememberDailyRun,
  type DailyRun,
} from "./dailyRuns";

export const CLUE_DAILY_KEY = "whereabout:clue-mix-daily";

/** How one day's run stands. In a run still going, the next step is `order[streak]`. */
export type ClueDay = DailyRun;

/** The day's seed, apart from the Daily Five's and the other quick games'. */
export function clueDaySeed(day: string): number {
  return hashSeed(`whereabout:clue-mix:${day}`);
}

/** The day's steps: the same photos and clues for everyone on `day` with the same labels. */
export function dailyClueOrder(maps: ClueMaps, day: string): ClueStep[] {
  return dealClueMix(maps, clueDaySeed(day));
}

/** Every day kept in this browser, by day; anything malformed is skipped. */
export function loadClueDays(): Record<string, ClueDay> {
  return loadDailyRuns(CLUE_DAILY_KEY);
}

/** The run kept for `day`, or null when it hasn't been started in this browser. */
export function loadClueDay(day: string): ClueDay | null {
  return loadDailyRun(CLUE_DAILY_KEY, day);
}

/** Keep `entry` as the run for `day`, with only the latest days kept. */
export function rememberClueDay(day: string, entry: ClueDay): void {
  rememberDailyRun(CLUE_DAILY_KEY, day, entry);
}

/** A mark per clue, so the squares show which clue each call read. */
const CLUE_MARK: Record<ClueKind, string> = { road: "🛣️", climate: "🌦️", continent: "🌍" };

/**
 * The run's squares in clue order: a green one for each right call, under the clue it read, a
 * red one for the miss (on the clue that ended it) or a flag when every step was called. Each
 * clue's mark heads its column, so a friend sees which clue ended the run without the photo.
 */
export function clueRunLine(entry: ClueDay): string {
  // Long runs are capped like every streak's squares: past 30 the line reads "…".
  const shown = Math.min(entry.streak, 30);
  const calls = Array.from({ length: shown }, () => "🟩");
  if (entry.streak <= 30 && entry.ended === "miss") calls.push("🟥");
  const rows: string[] = [];
  for (let i = 0; i < calls.length; i += CLUE_CYCLE.length) {
    rows.push(calls.slice(i, i + CLUE_CYCLE.length).join(""));
  }
  const tail = entry.streak > 30 ? "…" : entry.ended === "cleared" ? "🏁" : "";
  if (tail) rows.push(tail);
  return [CLUE_CYCLE.map((c) => CLUE_MARK[c]).join(""), ...rows].join("\n");
}

/** The clue a run ended on: the clue of the step after its last right call. */
export function clueEndedOn(entry: ClueDay): ClueKind | null {
  return entry.ended === "miss" ? CLUE_CYCLE[entry.streak % CLUE_CYCLE.length] : null;
}

/** "the road", "the climate", "the continent". */
const CLUE_WORDS: Record<ClueKind, string> = {
  road: "the road",
  climate: "the climate",
  continent: "the continent",
};

/** "4 clues in a row", with the clue that ended it: "4 clues in a row, out on the climate". */
export function clueRunWords(entry: ClueDay): string {
  const run = `${entry.streak} clue${entry.streak === 1 ? "" : "s"} in a row`;
  if (entry.ended === "cleared") return `${run}, every clue`;
  const out = clueEndedOn(entry);
  return out ? `${run}, out on ${CLUE_WORDS[out]}` : run;
}

/**
 * The share line: the day, the run in words, its squares three to a row under each clue's mark,
 * and Atlas's tally on the same steps.
 */
export function clueDailyShare(day: string, entry: ClueDay, href: string): string {
  const lines = [`Whereabout · Clue mix · ${day}`, `🔀 ${clueRunWords(entry)}`, clueRunLine(entry)];
  if (entry.atlasPlayed > 0) lines.push(`Atlas: ${entry.atlasRight} of ${entry.atlasPlayed}`);
  lines.push(dailyRunUrl(href));
  return lines.join("\n");
}
