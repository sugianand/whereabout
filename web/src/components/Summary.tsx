"use client";

import Link from "next/link";
import { useState } from "react";

import { ROUNDS_PER_GAME, totals, type RoundResult } from "@/lib/game/state";
import { MAX_POINTS, formatDistance, formatPoints } from "@/lib/geo";
import { currentStreak, type PlayerRecord } from "@/lib/playerRecord";
import {
  VERSUS_LABEL,
  VERSUS_MARK,
  sendShare,
  shareCard,
  shareText,
  type ShareCard,
  type ShareOutcome,
} from "@/lib/share";
import { useCountUp } from "@/lib/useCountUp";

type SummaryProps = {
  results: RoundResult[];
  /** "Daily Five, October 9" or "Fresh game". */
  title: string;
  /** Deal a fresh game of photos the player hasn't seen lately. */
  onPlayAgain: () => void;
  /** Switch to today's Daily Five; omitted when the finished game was the Daily Five. */
  onPlayDaily?: () => void;
  /** The player's record including this game, or null if it couldn't be built. */
  record?: PlayerRecord | null;
  /** Decides whether the Daily Five streak is still alive. */
  today?: Date;
  /** Forget the record in this browser. */
  onResetRecord?: () => void;
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Games, rounds won against Atlas, best game and Daily Five streak, kept in this browser. */
function RecordPanel({
  record,
  today,
  onReset,
}: {
  record: PlayerRecord;
  today: Date;
  onReset?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const streak = currentStreak(record, today);
  const stats: { label: string; value: string; note?: string }[] = [
    { label: "Games played", value: record.games.toLocaleString("en-US") },
    {
      label: "Rounds won against Atlas",
      value: record.roundsWon.toLocaleString("en-US"),
      note: record.roundsVsAtlas > 0 ? `of ${plural(record.roundsVsAtlas, "round")}` : undefined,
    },
    { label: "Best game", value: record.best === null ? "–" : formatPoints(record.best) },
    {
      label: "Daily Five streak",
      value: plural(streak, "day"),
      note: record.bestStreak > 0 ? `best ${plural(record.bestStreak, "day")}` : undefined,
    },
  ];

  return (
    <section aria-labelledby="record-heading" className="mt-10">
      <h2 id="record-heading" className="font-sign text-2xl font-bold">
        Your record against Atlas
      </h2>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-sm text-chalk-dim">{s.label}</dt>
            <dd className="font-sign tabular text-3xl font-bold">{s.value}</dd>
            {s.note && <dd className="tabular text-sm text-chalk-dim">{s.note}</dd>}
          </div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-chalk-dim">
        <p>Kept only in this browser. Streaks follow the Daily Five, which changes at midnight UTC.</p>
        {onReset &&
          (confirming ? (
            <span className="flex items-center gap-3">
              <span>Forget your record?</span>
              <button
                type="button"
                onClick={() => {
                  onReset();
                  setConfirming(false);
                }}
                className="font-semibold text-flare underline underline-offset-2"
              >
                Yes, reset it
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="underline underline-offset-2 hover:text-chalk"
              >
                Keep it
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="underline underline-offset-2 hover:text-chalk"
            >
              Reset record
            </button>
          ))}
      </div>
    </section>
  );
}

/** What the player is about to send, round by round, so nothing in it is a surprise. */
function ShareCardPreview({ card }: { card: ShareCard }) {
  return (
    <figure
      aria-label="Your share card"
      className="mt-10 rounded-2xl border border-graticule/60 bg-ocean-deep/40 p-5"
    >
      <figcaption className="text-sm text-chalk-dim">
        Your share card. No photos or places, so it spoils nothing.
      </figcaption>
      <p className="mt-3 font-sign text-xl font-bold">Whereabout: {card.title}</p>
      <p className="tabular text-chalk-dim">
        {formatPoints(card.score)} / {formatPoints(card.maxScore)}
      </p>
      <div className="mt-3 flex gap-2">
        {card.rounds.map((r, i) => (
          <span
            key={i}
            role="img"
            title={`Round ${i + 1}: ${r.band.label}, ${VERSUS_LABEL[r.versus]}`}
            aria-label={`Round ${i + 1}: ${r.band.label}, ${VERSUS_LABEL[r.versus]}`}
            className="flex flex-col items-center gap-1 text-2xl leading-none"
          >
            <span aria-hidden="true">{r.band.square}</span>
            {card.atlasRounds > 0 && (
              <span aria-hidden="true" className="text-lg">
                {VERSUS_MARK[r.versus]}
              </span>
            )}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs text-chalk-dim">
        🟩 within 25 km · 🟨 750 km · 🟧 2,500 km · 🟥 further
        {card.atlasRounds > 0 && " · ✅ beat Atlas · ❌ Atlas closer · 🤝 tie · ▫️ Atlas sat out"}
      </p>
    </figure>
  );
}

export default function Summary({
  results,
  title,
  onPlayAgain,
  onPlayDaily,
  record,
  today = new Date(),
  onResetRecord,
}: SummaryProps) {
  const t = totals(results);
  const shown = useCountUp(t.player, 1400);
  const [shared, setShared] = useState<ShareOutcome | "idle">("idle");
  // The address only matters once shared; on the server there is no window yet.
  const card = shareCard(
    title,
    results,
    typeof window === "undefined" ? "https://localhost/" : window.location.href,
  );

  async function share() {
    setShared(await sendShare(shareText(card), navigator));
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
          rounds. Atlas scored <span className="tabular text-sonar">{formatPoints(t.atlas)}</span>.{" "}
          <Link
            href="/atlas"
            className="text-base text-chalk-dim underline underline-offset-2 hover:text-chalk"
          >
            How does Atlas guess?
          </Link>
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

      {record && <RecordPanel record={record} today={today} onReset={onResetRecord} />}

      <ShareCardPreview card={card} />

      <div className="mt-6 flex flex-wrap items-center gap-4">
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
          Play a fresh game
        </button>
        {onPlayDaily && (
          <button
            type="button"
            onClick={onPlayDaily}
            className="rounded-full border border-sonar/50 px-6 py-3 font-semibold text-sonar transition hover:border-sonar"
          >
            Play the Daily Five
          </button>
        )}
        <p role="status" className="text-sm text-chalk-dim">
          {shared === "shared" && "Result shared."}
          {shared === "copied" && "Result copied. Paste it anywhere."}
          {shared === "failed" && "Couldn't copy. Your browser blocked the clipboard."}
        </p>
      </div>

      <Link
        href="/you"
        className="mt-10 block rounded-2xl border border-sonar/40 p-5 transition hover:border-sonar hover:bg-sonar/5"
      >
        <span className="block font-sign text-2xl font-bold text-sonar">
          Test Atlas on your own photo
        </span>
        <span className="mt-1 block text-chalk-dim">
          Give it a holiday photo and see if it can tell where you were. It runs on your device;
          your photo never leaves it.
        </span>
      </Link>

      <p className="mt-12 text-sm text-chalk-dim">
        Every game deals photos you haven&apos;t played lately. The Daily Five is the same for
        everyone and changes at midnight UTC. Photos from Wikimedia Commons, credited after each
        round.
      </p>
    </main>
  );
}
