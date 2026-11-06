"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { runToday, untilNextRun } from "@/lib/game/dailyRuns";
import {
  CALENDAR_WEEKS,
  TODAY_GAMES,
  calendarWeeks,
  dayTallies,
  fullDayStreak,
  fullDaysWords,
  gamesDone,
  todayGames,
  todayShare,
  type DayTally,
  type FullDayStreak,
  type TodayGame,
  type TodayGameInfo,
  type TodayStatus,
} from "@/lib/game/today";

import { ShareDay } from "./DailyRunShare";
import GamesMenu from "./GamesMenu";

/** How often the page rereads the clock, for the countdown and a new day's deal. */
const TICK_MS = 30_000;

const systemNow = () => new Date();

const STATUS_STYLE: Record<TodayStatus, string> = {
  new: "border-graticule hover:border-chalk/50",
  going: "border-flare/60 hover:border-flare",
  done: "border-gold/60 bg-gold/5 hover:border-gold",
};

const STATUS_WORD: Record<TodayStatus, string> = {
  new: "Not started",
  going: "Under way",
  done: "Played",
};

const STATUS_TEXT: Record<TodayStatus, string> = {
  new: "text-chalk-dim",
  going: "text-flare",
  done: "text-gold",
};

function GameCard({ info, game }: { info: TodayGameInfo; game?: TodayGame }) {
  const status = game?.status ?? "new";
  return (
    <li>
      <Link
        href={info.href}
        data-testid={`today-${info.id}`}
        data-status={game?.status}
        className={`block rounded-2xl border p-4 transition sm:p-5 ${STATUS_STYLE[status]}`}
      >
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-sign text-2xl font-bold">{info.name}</span>
          {game && (
            <span className={`text-sm font-semibold ${STATUS_TEXT[status]}`}>
              {STATUS_WORD[status]}
            </span>
          )}
        </span>
        {game && game.status !== "new" ? (
          <span className="mt-1 block text-lg font-semibold">
            {game.line}
            {game.atlas && (
              <span className="ml-2 text-sm font-normal text-chalk-dim">Atlas: {game.atlas}</span>
            )}
          </span>
        ) : (
          <span className="mt-1 block min-h-7 text-chalk-dim">{info.blurb}</span>
        )}
      </Link>
    </li>
  );
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

function dayName(day: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

function streakLine(streak: FullDayStreak, left: number, total: number): string {
  if (streak.days === 0) return `Finish all ${total} in one day to start a run of full days.`;
  const run = `${fullDaysWords(streak)} in a row.`;
  if (streak.today || streak.orMore) return run;
  return `${run} Finish today's ${left} to make it ${streak.days + 1}.`;
}

/** One day on the calendar: gold when every game was finished, else how many were. */
function DayCell({ tally, today, first }: { tally: DayTally; today: boolean; first: boolean }) {
  const { done, of: total } = tally;
  const full = done >= total;
  const name = today ? "Today" : dayName(tally.day, { month: "long", day: "numeric" });
  const month = first || tally.day.endsWith("-01");
  const style = full
    ? "border-gold bg-gold font-semibold text-ocean-deep"
    : done > 0
      ? "border-gold/40 text-chalk"
      : "border-chalk/15 text-chalk-dim";
  return (
    <li
      data-testid={`day-${tally.day}`}
      data-done={done}
      aria-current={today ? "date" : undefined}
      aria-label={`${name}: ${full ? "every game finished" : `${done} of ${total} finished`}`}
      className={`flex h-12 flex-col items-center justify-center rounded-lg border text-xs leading-tight ${style} ${
        today ? "ring-2 ring-flare" : ""
      }`}
    >
      <span>{dayName(tally.day, month ? { month: "short", day: "numeric" } : { day: "numeric" })}</span>
      <span className="tabular mt-0.5">{full ? "All" : done > 0 ? done : ""}</span>
    </li>
  );
}

/** The run of full days, and the last weeks with how much of each day was finished. */
function FullDays({ tallies, today }: { tallies: readonly DayTally[]; today: string }) {
  const streak = fullDayStreak(tallies);
  const total = tallies[0]?.of ?? TODAY_GAMES.length;
  const left = total - (tallies[0]?.done ?? 0);
  const cells = calendarWeeks(tallies).flat();
  return (
    <section aria-labelledby="full-days" className="mt-10">
      <h2 id="full-days" className="font-sign text-2xl font-bold">
        Full days
      </h2>
      <p className="mt-1 text-chalk-dim" data-testid="full-day-streak">
        {streakLine(streak, left, total)}
      </p>
      <div aria-hidden="true" className="mt-4 grid grid-cols-7 gap-1.5 text-center text-xs text-chalk-dim">
        {WEEKDAYS.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <ol
        aria-label={`The last ${CALENDAR_WEEKS} weeks`}
        className="mt-1.5 grid grid-cols-7 gap-1.5"
      >
        {cells.map((tally, i) =>
          tally ? (
            <DayCell key={tally.day} tally={tally} today={tally.day === today} first={i === 0} />
          ) : (
            <li key={`to-come-${i}`} aria-hidden="true" />
          ),
        )}
      </ol>
    </section>
  );
}

/**
 * Today: every daily game on one page, each showing how it stands in this browser, with the time
 * to the next deal, one share line for the whole day and the run of days with every game finished
 * (`lib/game/today.ts`). Read after mount,
 * so the static page never guesses at it, and again when a page comes back into view or the
 * clock passes midnight UTC.
 */
export default function Today({
  deckIds,
  now = systemNow,
}: {
  deckIds: readonly string[];
  now?: () => Date;
}) {
  const [view, setView] = useState<{
    day: string;
    games: TodayGame[];
    tallies: DayTally[];
    until: string;
  } | null>(null);

  const read = useCallback(() => {
    const at = now();
    const day = runToday(at);
    const tallies = dayTallies(day, deckIds, at);
    setView({ day, games: todayGames(day, deckIds, at), tallies, until: untilNextRun(at) });
  }, [deckIds, now]);

  useEffect(() => {
    // Storage only exists in the browser, so the day is read once the page is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    read();
    const tick = window.setInterval(read, TICK_MS);
    const onShow = () => {
      if (document.visibilityState === "visible") read();
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pageshow", onShow);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("pageshow", onShow);
    };
  }, [read]);

  const total = view?.games.length ?? TODAY_GAMES.length;
  const done = view ? gamesDone(view.games) : 0;

  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-16 pt-6 sm:px-6 sm:pt-10">
      <div className="flex items-center justify-between gap-3">
        <Link href="/" className="font-sign text-3xl font-extrabold tracking-tight">
          Whereabout
        </Link>
        <GamesMenu screen="today" streakHref="/streak" />
      </div>
      <h1 className="mt-8 font-sign text-6xl font-extrabold leading-none tracking-tight">Today</h1>
      <p className="mt-2 min-h-7 text-sm text-gold">{view?.day}</p>
      <p className="mt-1 text-lg text-chalk-dim" role="status" data-testid="today-standing">
        {view
          ? done === total
            ? `All ${total} played. The next deal is in ${view.until}.`
            : `${done} of ${total} played. The next deal is in ${view.until}.`
          : `${total} games, the same deal for everyone.`}
      </p>

      <ul className="mt-6 space-y-3" aria-label="Today's games">
        {(view?.games ?? TODAY_GAMES).map((info) => (
          <GameCard key={info.id} info={info} game={view?.games.find((g) => g.id === info.id)} />
        ))}
      </ul>

      {view && done > 0 && (
        <div className="mt-6">
          <ShareDay
            label="Share your day"
            shareText={(href) => todayShare(view.day, view.games, href, fullDayStreak(view.tallies))}
          />
        </div>
      )}

      {view && <FullDays tallies={view.tallies} today={view.day} />}

      <p className="mt-8 text-sm text-chalk-dim">
        Each game deals once a day at midnight UTC, the same for everyone. What you&apos;ve played
        is kept in this browser. A Daily Five played later from its archive counts for its own day.
      </p>
    </main>
  );
}
