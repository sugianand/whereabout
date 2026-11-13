/**
 * Today's Which climate?: five photos a day that everyone calls in the same order, dealt from the
 * UTC date by the free games' own even deal (`dealClimate` in ./whichClimate.ts), so each photo's
 * group is still drawn by a fair die and always calling one group is still a guess.
 *
 * One try a day: the calls are kept after every photo (./dailyRuns.ts), so a reload picks up at the
 * next photo and a day with all five called shows its result instead of dealing it again. A call
 * is kept whole (your group, the truth and Atlas's read), so the day reads back exactly as played
 * and Your map's clue reading can count it without the free games' tally. It never touches the
 * free games' best, and the share line is a score and squares only, so it spoils no photo.
 */

import { CLIMATE_GROUPS, type ClimateGroup } from "@/lib/trueClues";

import { hashSeed } from "./daily";
import { dailyRunUrl, loadKeptDays, rememberKeptDay } from "./dailyRuns";
import {
  CLIMATE_PHOTOS,
  climateTotals,
  dealClimate,
  type ClimateMap,
  type ClimateResult,
} from "./whichClimate";

export const CLIMATE_DAILY_KEY = "whereabout:which-climate-daily";

/** One day's game: the photos called so far, in the order dealt. */
export interface ClimateDay {
  results: readonly ClimateResult[];
}

/** The day's seed, apart from the Daily Five's and the other daily games'. */
export function climateDaySeed(day: string): number {
  return hashSeed(`whereabout:which-climate:${day}`);
}

/** The day's photos: the same for everyone on `day` with the same photos and groups. */
export function dailyClimateOrder(groups: ClimateMap, day: string): string[] {
  return dealClimate(groups, climateDaySeed(day));
}

const isGroup = (v: unknown): v is ClimateGroup =>
  typeof v === "string" && (CLIMATE_GROUPS as readonly string[]).includes(v);

function parseResult(value: unknown): ClimateResult | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, picked, truth, atlas } = value as Record<string, unknown>;
  if (typeof id !== "string" || id === "" || !isGroup(picked) || !isGroup(truth)) return null;
  if (atlas !== null && !isGroup(atlas)) return null;
  return { id, picked, truth, correct: picked === truth, atlas };
}

/** A stored day read back only in the shape `rememberClimateDay` writes, else null. */
export function parseClimateDay(value: unknown): ClimateDay | null {
  if (typeof value !== "object" || value === null) return null;
  const { results: raw } = value as Record<string, unknown>;
  if (!Array.isArray(raw) || raw.length > CLIMATE_PHOTOS) return null;
  const results = raw.map(parseResult);
  if (!results.every((r) => r !== null)) return null;
  if (new Set(results.map((r) => r!.id)).size !== results.length) return null;
  return { results: results as ClimateResult[] };
}

/** Every day kept in this browser, by day; anything malformed is skipped. */
export function loadClimateDays(): Record<string, ClimateDay> {
  return loadKeptDays(CLIMATE_DAILY_KEY, parseClimateDay);
}

/** The game kept for `day`, or null when it hasn't been started in this browser. */
export function loadClimateDay(day: string): ClimateDay | null {
  return loadClimateDays()[day] ?? null;
}

/** Keep `results` as the game for `day`, written in the shape `parseClimateDay` reads. */
export function rememberClimateDay(day: string, results: readonly ClimateResult[]): void {
  const entry: ClimateDay = {
    results: results.map(({ id, picked, truth, atlas }) => ({
      id,
      picked,
      truth,
      atlas,
      correct: picked === truth,
    })),
  };
  rememberKeptDay(CLIMATE_DAILY_KEY, day, entry, parseClimateDay);
}

/** Whether every photo of the day has been called. */
export function climateDayDone(entry: ClimateDay | null): boolean {
  return entry !== null && entry.results.length >= CLIMATE_PHOTOS;
}

/**
 * The share line: the day, the score, a square a photo (green right, red wrong) and Atlas's tally
 * on the photos it read. Only counts and squares, so it can never name a place or a climate.
 */
export function climateDailyShare(
  day: string,
  results: readonly ClimateResult[],
  href: string,
): string {
  const { right, atlasRight, atlasRead } = climateTotals(results);
  const lines = [
    `Whereabout · Which climate? · ${day}`,
    `🌦️ ${right} of ${results.length}`,
    results.map((r) => (r.correct ? "🟩" : "🟥")).join(""),
  ];
  if (atlasRead > 0) {
    const silent = results.length - atlasRead;
    lines.push(
      `Atlas: ${atlasRight} of ${atlasRead}${silent > 0 ? ` (no read on ${silent})` : ""}`,
    );
  }
  lines.push(dailyRunUrl(href));
  return lines.join("\n");
}
