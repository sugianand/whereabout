/**
 * Getting closer: the median distance of your rounds week by week, read from Your map's history
 * (`lib/playedMap.ts`), so a player can see their form over time.
 *
 * Each round is filed under the week of the UTC day it was kept (`PlayedPhoto.day`), weeks
 * starting on Monday. A week's figure is the median distance of its pinned rounds, as on Your
 * continents (`lib/continentForm.ts`), so one wild miss doesn't swamp it; a round with no pin
 * is counted but says nothing about distance. The chart shows the last `MAX_WEEKS` weeks up to
 * the newest week with a round, quiet weeks in between kept as gaps so the time axis is honest,
 * and nothing at all until `MIN_CHART_WEEKS` weeks have a median to compare.
 *
 * Your map keeps your latest try on each photo, so a photo played again moves to its new week.
 */

import { median, trendOf, type Trend } from "@/lib/continentForm";
import type { PlayedPhoto } from "@/lib/playedMap";

/** Weeks with a median the chart needs before it is drawn; one week has nothing to compare. */
export const MIN_CHART_WEEKS = 2;

/** Weeks the chart shows, ending at the newest week played; about three months fits a phone. */
export const MAX_WEEKS = 12;

const DAY_MS = 86_400_000;

function dayMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The Monday starting the UTC week of a "YYYY-MM-DD" day, in the same form. */
export function weekStart(day: string): string {
  const ms = dayMs(day);
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
  return dayOf(ms - sinceMonday * DAY_MS);
}

export interface WeekForm {
  /** The week's Monday, "YYYY-MM-DD". */
  start: string;
  /** The week's rounds, newest last, as Your map keeps them. */
  rounds: PlayedPhoto[];
  /** Rounds with a pin, the ones the median is taken over. */
  pinned: number;
  /** Median distance off over the pinned rounds, or null with none (or no rounds). */
  medianKm: number | null;
}

export interface WeeklyForm {
  /** Consecutive weeks, oldest first, ending at the newest week with a round. */
  weeks: WeekForm[];
  /**
   * The newest week with a median against the one with a median before it, within a tenth
   * either way being "same", as on Your continents.
   */
  latest: { trend: Trend; week: WeekForm; before: WeekForm };
}

/**
 * The weekly chart for a history, or null until `MIN_CHART_WEEKS` of the shown weeks have a
 * median. A malformed day (parsePlayed never lets one through) is skipped.
 */
export function weeklyForm(
  history: readonly PlayedPhoto[],
  maxWeeks = MAX_WEEKS,
): WeeklyForm | null {
  const byWeek = new Map<string, PlayedPhoto[]>();
  for (const p of history) {
    if (Number.isNaN(dayMs(p.day))) continue;
    const start = weekStart(p.day);
    const list = byWeek.get(start) ?? [];
    list.push(p);
    byWeek.set(start, list);
  }
  if (byWeek.size === 0) return null;

  const newest = [...byWeek.keys()].sort().at(-1)!;
  const oldest = [...byWeek.keys()].sort()[0];
  const weeks: WeekForm[] = [];
  for (let i = maxWeeks - 1; i >= 0; i--) {
    const start = dayOf(dayMs(newest) - i * 7 * DAY_MS);
    if (start < oldest) continue;
    const rounds = byWeek.get(start) ?? [];
    const kms = rounds.flatMap((p) => (p.km === null ? [] : [p.km]));
    weeks.push({ start, rounds, pinned: kms.length, medianKm: median(kms) });
  }

  const charted = weeks.filter((w) => w.medianKm !== null);
  if (charted.length < MIN_CHART_WEEKS) return null;
  const week = charted.at(-1)!;
  const before = charted.at(-2)!;
  return { weeks, latest: { trend: trendOf(before.medianKm!, week.medianKm!), week, before } };
}

/** "Nov 2": a week's Monday, as the chart labels it. */
export function weekLabel(start: string): string {
  return new Date(dayMs(start)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
