"use client";

import { useState } from "react";

import type { Trend } from "@/lib/continentForm";
import { formBar } from "@/lib/continentForm";
import { formatDistance } from "@/lib/geo";
import type { PlayedPhoto } from "@/lib/playedMap";
import { useUnits } from "@/lib/useUnits";
import { weekLabel, weeklyForm, type WeekForm } from "@/lib/weeklyForm";

const TREND_TEXT: Record<Trend, string> = {
  better: "Getting closer",
  worse: "Drifting further",
  same: "Holding steady",
};

/** Rounds listed for a week before "Show all". */
const LIST_FIRST = 8;

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

interface Props {
  played: readonly PlayedPhoto[];
}

/**
 * Getting closer: a column per week, as tall as the median distance your pins landed off that
 * week (on the same log scale as Your continents, so shorter is closer), with how the newest
 * week compares with the one before. Tap a week for its rounds. Nothing is drawn until two
 * weeks have pinned rounds.
 */
export default function WeeklyForm({ played }: Props) {
  const units = useUnits();
  const form = weeklyForm(played);
  const [picked, setPicked] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  if (!form) return null;

  const { weeks, latest } = form;
  const selected: WeekForm =
    weeks.find((w) => w.start === picked && w.rounds.length > 0) ?? latest.week;
  const newestFirst = [...selected.rounds].reverse();
  const listed = showAll ? newestFirst : newestFirst.slice(0, LIST_FIRST);
  const describe = (w: WeekForm) =>
    w.medianKm === null
      ? `Week of ${weekLabel(w.start)}: ${count(w.rounds.length, "round", "rounds")}, no pins`
      : `Week of ${weekLabel(w.start)}: ${formatDistance(w.medianKm, units)} off over ${count(w.pinned, "pinned round", "pinned rounds")}`;

  return (
    <section className="mt-12" aria-labelledby="weekly-form">
      <h2 id="weekly-form" className="font-sign text-3xl font-extrabold">
        Getting closer
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-chalk-dim">
        How far off your pins land week by week, by the middle of each week&apos;s rounds. Shorter
        is closer. Tap a week for its rounds.
      </p>

      <p className="mt-4 max-w-2xl" data-testid="weekly-trend">
        <strong>{TREND_TEXT[latest.trend]}</strong>: {formatDistance(latest.week.medianKm!, units)}{" "}
        the week of {weekLabel(latest.week.start)}, from{" "}
        {formatDistance(latest.before.medianKm!, units)} the week of{" "}
        {weekLabel(latest.before.start)}.
      </p>

      <div className="mt-4 max-w-2xl rounded-2xl border border-graticule px-3 pb-2 pt-3">
        <ol
          className="flex h-36 items-end gap-0.5 border-b border-graticule"
          aria-label="Your weeks"
        >
          {weeks.map((w) => {
            const isSelected = w.start === selected.start;
            if (w.rounds.length === 0) {
              return (
                <li key={w.start} className="h-full flex-1" data-testid="week-empty">
                  <span className="sr-only">Week of {weekLabel(w.start)}: no rounds</span>
                </li>
              );
            }
            const height = w.medianKm === null ? 0.03 : formBar(w.medianKm);
            return (
              <li key={w.start} className="h-full flex-1">
                <button
                  type="button"
                  onClick={() => {
                    setPicked(w.start);
                    setShowAll(false);
                  }}
                  aria-pressed={isSelected}
                  aria-label={describe(w)}
                  title={describe(w)}
                  className="group flex h-full w-full items-end justify-center rounded-t-md outline-offset-2 focus-visible:outline-2 focus-visible:outline-gold"
                  data-testid="week-bar"
                >
                  <span
                    aria-hidden="true"
                    className={`block w-full max-w-8 rounded-t-[4px] transition-colors ${
                      isSelected
                        ? "bg-gold"
                        : w.medianKm === null
                          ? "bg-graticule"
                          : "bg-chalk/70 group-hover:bg-chalk"
                    }`}
                    style={{ height: `${Math.round(height * 100)}%` }}
                  />
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-1 flex justify-between text-xs text-chalk-dim" aria-hidden="true">
          <span>{weekLabel(weeks[0].start)}</span>
          <span>{weekLabel(weeks.at(-1)!.start)}</span>
        </div>
      </div>

      <div className="mt-4 max-w-2xl" aria-live="polite" data-testid="week-detail">
        <h3 className="font-semibold">{describe(selected)}</h3>
        <ul
          className="mt-2 grid gap-1 text-sm"
          aria-label={`Rounds, week of ${weekLabel(selected.start)}`}
        >
          {listed.map((p) => (
            <li key={p.id} className="flex justify-between gap-3 border-b border-graticule/50 py-1">
              <span className="min-w-0 truncate">{p.place}</span>
              <span className="shrink-0 text-chalk-dim">
                {p.km === null ? "No pin" : formatDistance(p.km, units)} ·{" "}
                {p.score.toLocaleString("en-US")} pts
              </span>
            </li>
          ))}
        </ul>
        {!showAll && newestFirst.length > LIST_FIRST && (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="mt-2 text-sm font-semibold underline-offset-2 hover:underline"
          >
            Show all {newestFirst.length.toLocaleString("en-US")}
          </button>
        )}
      </div>
    </section>
  );
}
