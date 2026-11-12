"use client";

import Link from "next/link";

import {
  MIN_FORM_ROUNDS,
  continentForms,
  formBar,
  formExtremes,
  practiceHref,
  type ContinentForm as Form,
  type Trend,
} from "@/lib/continentForm";
import { CLOSENESS_KM } from "@/lib/feel";
import type { Regions } from "@/lib/game/regions";
import { formatDistance } from "@/lib/geo";
import type { PlayedPhoto } from "@/lib/playedMap";
import { useUnits } from "@/lib/useUnits";

const TREND_TEXT: Record<Trend, string> = {
  better: "Getting closer",
  worse: "Drifting further",
  same: "Holding steady",
};

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

interface Props {
  played: readonly PlayedPhoto[];
  /** The continents the deck can deal a game on, for the practice links. */
  regions: Regions;
}

/**
 * Your continents: one row per continent you've played, with how far off your pins land there
 * (the median, on a log bar), how many landed within 500 km and, after ten pinned rounds, whether
 * your last five are closer than the five before. The continent your pins land furthest from is
 * your weak spot, with a five-photo game there to practise; the nearest is your strong suit.
 */
export default function ContinentForm({ played, regions }: Props) {
  const units = useUnits();
  const forms = continentForms(played);
  if (forms.length === 0) return null;
  const extremes = formExtremes(forms);
  const weakHref = extremes && practiceHref(extremes.weak.continent, regions);

  const tag = (f: Form) =>
    extremes?.weak.continent === f.continent
      ? "Your weak spot"
      : extremes?.strong.continent === f.continent
        ? "Your strong suit"
        : null;

  return (
    <section className="mt-12" aria-labelledby="continent-form">
      <h2 id="continent-form" className="font-sign text-3xl font-extrabold">
        Your continents
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-chalk-dim">
        How far off your pins land on each continent, by the middle of your rounds there, so one
        wild miss doesn&apos;t count for more than it should. A continent is ranked after{" "}
        {MIN_FORM_ROUNDS} pinned rounds.
      </p>

      {extremes && (
        <div
          className="mt-4 flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-flare/60 px-4 py-3"
          data-testid="weak-spot"
        >
          <p className="min-w-0">
            Your pins land furthest off in <strong>{extremes.weak.continent}</strong>, about{" "}
            {formatDistance(extremes.weak.medianKm!, units)} away, and nearest in{" "}
            {extremes.strong.continent}.
          </p>
          {weakHref && (
            <Link
              href={weakHref}
              className="shrink-0 rounded-full bg-gold px-5 py-2 font-semibold text-ocean-deep transition hover:brightness-110"
            >
              Practise {extremes.weak.continent}
            </Link>
          )}
        </div>
      )}

      <ul className="mt-4 grid max-w-2xl gap-3" aria-label="Your continents">
        {forms.map((f) => {
          const label = tag(f);
          const href = practiceHref(f.continent, regions);
          return (
            <li
              key={f.continent}
              className="rounded-2xl border border-graticule px-4 py-3"
              data-testid="continent-form-row"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="font-semibold">
                  {f.continent}
                  {label && (
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${label === "Your weak spot" ? "bg-flare/20 text-flare" : "bg-sonar/20 text-sonar"}`}
                    >
                      {label}
                    </span>
                  )}
                </h3>
                <span className="font-sign text-2xl font-extrabold">
                  {f.medianKm === null ? "No pins" : formatDistance(f.medianKm, units)}
                </span>
              </div>
              {f.medianKm !== null && (
                <div
                  className="mt-2 h-2 overflow-hidden rounded-full bg-graticule/50"
                  aria-hidden="true"
                >
                  <div
                    className={`h-full rounded-full ${f.ranked ? "bg-chalk" : "bg-chalk/40"}`}
                    style={{ width: `${Math.round(formBar(f.medianKm) * 100)}%` }}
                  />
                </div>
              )}
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-chalk-dim">
                <span>{count(f.rounds, "round", "rounds")}</span>
                {f.pinned > 0 && (
                  <span>
                    {f.close.toLocaleString("en-US")} within{" "}
                    {formatDistance(CLOSENESS_KM.close, units)}
                  </span>
                )}
                {!f.ranked && (
                  <span>
                    {count(MIN_FORM_ROUNDS - f.pinned, "more pinned round", "more pinned rounds")}{" "}
                    to rank
                  </span>
                )}
                {f.lately && (
                  <span data-testid="continent-trend">
                    {TREND_TEXT[f.lately.trend]}: last 5 {formatDistance(f.lately.nowKm, units)}, 5
                    before {formatDistance(f.lately.beforeKm, units)}
                  </span>
                )}
                {href && label !== "Your weak spot" && (
                  <Link
                    href={href}
                    className="font-semibold text-chalk underline-offset-2 hover:underline"
                  >
                    Play {f.continent}
                  </Link>
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
