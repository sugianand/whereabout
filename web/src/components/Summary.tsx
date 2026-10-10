"use client";

import { useState } from "react";

import { ROUNDS_PER_GAME, totals, type RoundResult } from "@/lib/game/state";
import { MAX_POINTS, formatDistance, formatPoints } from "@/lib/geo";
import { useCountUp } from "@/lib/useCountUp";

type SummaryProps = {
  results: RoundResult[];
  /** "Daily Five, October 9" or "Practice game". */
  title: string;
  onPlayAgain: () => void;
};

/** One square per round, so a result can be pasted into a chat without spoilers. */
function square(r: RoundResult): string {
  const km = r.reveal.distanceKm;
  if (km <= 25) return "🟩";
  if (km <= 750) return "🟨";
  if (km <= 2500) return "🟧";
  return "🟥";
}

/** The text copied by "Share result": totals and squares, never the answers. */
export function shareText(title: string, results: readonly RoundResult[], url: string): string {
  const t = totals(results);
  const lines = [
    `Whereabout: ${title}`,
    `${formatPoints(t.player)} / ${formatPoints(MAX_POINTS * ROUNDS_PER_GAME)}`,
    results.map(square).join(""),
  ];
  if (t.atlasRounds > 0) lines.push(`Beat Atlas in ${t.playerWins} of ${t.atlasRounds} rounds`);
  lines.push(url);
  return lines.join("\n");
}

export default function Summary({ results, title, onPlayAgain }: SummaryProps) {
  const t = totals(results);
  const shown = useCountUp(t.player, 1400);
  const [shared, setShared] = useState<"idle" | "copied" | "failed">("idle");

  async function share() {
    const text = shareText(title, results, window.location.href.split("#")[0]);
    try {
      await navigator.clipboard.writeText(text);
      setShared("copied");
    } catch {
      setShared("failed");
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-6 pb-16 pt-16 md:pt-24">
      <p className="font-sign text-3xl font-extrabold tracking-tight">Whereabout</p>
      <p className="mt-10 text-chalk-dim">{title}</p>
      <h1 className="font-sign tabular text-7xl font-extrabold leading-none text-flare sm:text-9xl">
        <span aria-hidden="true">{formatPoints(shown)}</span>
        <span className="sr-only">{`${formatPoints(t.player)} points`}</span>
      </h1>
      <p className="mt-2 text-chalk-dim">
        out of {formatPoints(MAX_POINTS * ROUNDS_PER_GAME)} points
      </p>

      {t.atlasRounds > 0 ? (
        <p className="mt-6 text-xl">
          You beat Atlas in{" "}
          <strong className="text-flare">
            {t.playerWins} of {t.atlasRounds}
          </strong>{" "}
          rounds. Atlas scored <span className="tabular text-sonar">{formatPoints(t.atlas)}</span>.
        </p>
      ) : (
        <p className="mt-6 text-chalk-dim">
          Atlas, the AI player, hasn&apos;t seen these photos yet, so this game was just you.
        </p>
      )}

      <ol className="mt-10 divide-y divide-graticule/60 border-y border-graticule/60">
        {results.map((r, i) => (
          <li
            key={r.round.roundId}
            className="grid grid-cols-[2rem_1fr_auto] items-baseline gap-x-3 py-4"
          >
            <span className="font-sign text-2xl text-chalk-dim">{i + 1}</span>
            <span className="min-w-0">
              <span className="block truncate text-lg">{r.reveal.answer.place}</span>
              {r.atlas && (
                <span className="text-sm text-sonar">
                  Atlas: {formatDistance(r.atlas.distanceKm)}
                </span>
              )}
            </span>
            <span className="text-right">
              <span className="block font-sign tabular text-2xl font-bold text-flare">
                {formatDistance(r.reveal.distanceKm)}
              </span>
              <span className="tabular text-sm text-chalk-dim">
                {formatPoints(r.reveal.score)} points
              </span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-10 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={share}
          className="rounded-full bg-flare px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          Share result
        </button>
        <button
          type="button"
          onClick={onPlayAgain}
          className="rounded-full border border-chalk/40 px-6 py-3 font-semibold transition hover:border-chalk"
        >
          Play a practice game
        </button>
        <p role="status" className="text-sm text-chalk-dim">
          {shared === "copied" && "Result copied. Paste it anywhere."}
          {shared === "failed" && "Couldn't copy. Your browser blocked the clipboard."}
        </p>
      </div>

      <p className="mt-12 text-sm text-chalk-dim">
        A new Daily Five arrives at midnight UTC. Photos from Wikimedia Commons, credited after each
        round.
      </p>
    </main>
  );
}
