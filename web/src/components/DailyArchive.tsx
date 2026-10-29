"use client";

import { ARCHIVE_DAYS, archiveDays, type DailyScores } from "@/lib/game/dailyArchive";
import { formatPoints } from "@/lib/geo";

/** "18.2k", "25k" or "940": a whole game's score short enough for a calendar cell. */
export function compactPoints(points: number): string {
  if (points < 1000) return String(points);
  return `${(Math.floor(points / 100) / 10).toFixed(1).replace(/\.0$/, "")}k`;
}

function dayLabel(day: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

/**
 * The Daily Five archive on the summary: the last 30 puzzle days as a calendar, oldest first,
 * each with the score this browser kept for it, or an invitation to play it. Any day opens its
 * Daily Five; past days count toward the record but never the streak.
 */
export default function DailyArchive({
  today,
  scores,
  playedDay,
  onPlay,
}: {
  /** Today's puzzle day, "YYYY-MM-DD" (UTC). */
  today: string;
  scores: DailyScores;
  /** The Daily Five just finished, marked on the calendar. */
  playedDay?: string;
  onPlay: (day: string) => void;
}) {
  const days = archiveDays(today).reverse();
  const played = days.filter((d) => d in scores).length;
  return (
    <section aria-labelledby="daily-archive" className="mt-10">
      <h2 id="daily-archive" className="font-sign text-2xl font-bold">
        Daily Five archive
      </h2>
      <p className="mt-1 text-sm text-chalk-dim">
        {played === 0
          ? `Play any of the last ${ARCHIVE_DAYS} days.`
          : `You've played ${played} of the last ${ARCHIVE_DAYS} days.`}{" "}
        Past days count toward your record, not your streak.
      </p>
      <ol className="mt-4 grid grid-cols-6 gap-1.5 sm:grid-cols-10">
        {days.map((day, i) => {
          const score = scores[day];
          const isToday = day === today;
          const name = isToday ? "Today" : dayLabel(day, { month: "long", day: "numeric" });
          // The month is named on the first cell and wherever a new month starts.
          const month = i === 0 || day.endsWith("-01");
          const label =
            score === undefined
              ? `${name}: not played yet. Play it`
              : `${name}: ${formatPoints(score)} points. Play it again`;
          return (
            <li key={day}>
              <button
                type="button"
                onClick={() => onPlay(day)}
                aria-label={label}
                aria-current={day === playedDay ? "date" : undefined}
                className={`flex h-14 w-full flex-col items-center justify-center rounded-lg border text-xs leading-tight transition ${
                  score === undefined
                    ? "border-chalk/20 text-chalk-dim hover:border-chalk hover:text-chalk"
                    : "border-sonar/40 bg-sonar/10 text-chalk hover:border-sonar"
                } ${day === playedDay ? "ring-2 ring-flare" : ""}`}
              >
                <span className={`font-semibold ${isToday ? "text-flare" : ""}`}>
                  {isToday
                    ? "Today"
                    : month
                      ? dayLabel(day, { month: "short", day: "numeric" })
                      : dayLabel(day, { day: "numeric" })}
                </span>
                <span className="tabular mt-0.5">
                  {score === undefined ? "Play" : compactPoints(score)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
