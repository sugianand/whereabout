"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { challengeOutcome, challengeText, sumScores, type Challenge } from "@/lib/game/challenge";
import { ROUNDS_PER_GAME, totals, type RoundResult } from "@/lib/game/state";
import { MAX_POINTS, formatDistance, formatPoints } from "@/lib/geo";
import { CONTINENTS } from "@/lib/continents";
import {
  MIN_RANKED_ROUNDS,
  continentStandings,
  currentStreak,
  type ContinentStanding,
  type PlayerRecord,
} from "@/lib/playerRecord";
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
  /** The play-again button's text; a tier game offers another game from its tier. */
  playAgainLabel?: string;
  /** Switch to today's Daily Five; omitted when the finished game was the Daily Five. */
  onPlayDaily?: () => void;
  /** The player's record including this game, or null if it couldn't be built. */
  record?: PlayerRecord | null;
  /** Decides whether the Daily Five streak is still alive. */
  today?: Date;
  /** Forget the record in this browser. */
  onResetRecord?: () => void;
  /** Look at a round again (index from 0): its photo, both pins and the arcs, for no score. */
  onReplay?: (index: number) => void;
  /**
   * The round the player just came back from looking at, if any: its row takes focus and the
   * total shows at once instead of counting up again.
   */
  returnedFrom?: number | null;
  /** Offer a link that challenges a friend to these five photos (browser-dealt games only). */
  canChallenge?: boolean;
  /** Set when this game was a friend's challenge: their score on each photo, to compare. */
  challenge?: Challenge;
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
      <ContinentRecordTable record={record} />
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-chalk-dim">
        <p>
          Kept only in this browser. Streaks follow the Daily Five, which changes at midnight UTC.
        </p>
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

const wonOf = (s: ContinentStanding) =>
  `${s.won.toLocaleString("en-US")} of ${plural(s.vsAtlas, "round")}`;

/** Rounds played and won against Atlas on each continent, with where you beat it most and least. */
function ContinentRecordTable({ record }: { record: PlayerRecord }) {
  const rows = CONTINENTS.flatMap((c) => {
    const t = record.continents[c];
    return t ? [{ continent: c, ...t }] : [];
  });
  if (rows.length === 0) return null;
  const standing = continentStandings(record.continents);
  const ranked = rows.filter((r) => r.vsAtlas >= MIN_RANKED_ROUNDS).length;

  return (
    <div className="mt-6">
      <table className="w-full max-w-md text-left">
        <caption className="mb-2 text-left font-semibold">By continent</caption>
        <thead className="text-sm text-chalk-dim">
          <tr>
            <th scope="col" className="py-1 font-normal">
              Continent
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Rounds
            </th>
            <th scope="col" className="py-1 text-right font-normal">
              Won against Atlas
            </th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((r) => (
            <tr key={r.continent} className="border-t border-graticule/60">
              <th scope="row" className="py-1.5 font-normal">
                {r.continent}
              </th>
              <td className="py-1.5 text-right">{r.rounds.toLocaleString("en-US")}</td>
              <td className="py-1.5 text-right">
                {r.vsAtlas > 0 ? `${r.won.toLocaleString("en-US")} of ${r.vsAtlas}` : "–"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-sm text-chalk-dim">
        {standing ? (
          <>
            You beat Atlas most often in{" "}
            <strong className="text-chalk">{standing.most.continent}</strong> (
            {wonOf(standing.most)}) and least often in{" "}
            <strong className="text-chalk">{standing.least.continent}</strong> (
            {wonOf(standing.least)}).
          </>
        ) : ranked >= 2 ? (
          "You beat Atlas just as often on every continent you've played it on."
        ) : (
          `Play ${MIN_RANKED_ROUNDS} rounds against Atlas on each of two continents to see where you beat it most and least.`
        )}
      </p>
    </div>
  );
}

const SENT_NOTE: Record<"result" | "challenge", Record<ShareOutcome, string>> = {
  result: {
    shared: "Result shared.",
    copied: "Result copied. Paste it anywhere.",
    cancelled: "",
    failed: "Couldn't copy. Your browser blocked the clipboard.",
  },
  challenge: {
    shared: "Challenge sent.",
    copied: "Challenge link copied. Whoever opens it plays these five photos.",
    cancelled: "",
    failed: "Couldn't copy the link. Your browser blocked the clipboard.",
  },
};

/** "You won the challenge by 790 points.", from the player's and the friend's totals. */
export function challengeResultLine(player: number, friend: number): string {
  const outcome = challengeOutcome(player, friend);
  const by = formatPoints(Math.abs(player - friend));
  if (outcome === "won") return `You won the challenge by ${by} points.`;
  if (outcome === "lost") return `Your friend won by ${by} points.`;
  return "A dead heat with your friend.";
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
  playAgainLabel = "Play a fresh game",
  onPlayDaily,
  record,
  today = new Date(),
  onResetRecord,
  onReplay,
  returnedFrom = null,
  canChallenge = false,
  challenge,
}: SummaryProps) {
  const t = totals(results);
  const counted = useCountUp(t.player, 1400);
  const shown = returnedFrom === null ? counted : t.player;
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    if (returnedFrom === null) return;
    const row = rowRefs.current[returnedFrom];
    row?.focus({ preventScroll: true });
    row?.scrollIntoView?.({ block: "center" });
  }, [returnedFrom]);
  // The last thing sent from this screen, the result card or a challenge link, and how it went.
  const [sent, setSent] = useState<{ what: "result" | "challenge"; outcome: ShareOutcome } | null>(
    null,
  );
  // The address only matters once shared; on the server there is no window yet.
  const card = shareCard(
    title,
    results,
    typeof window === "undefined" ? "https://localhost/" : window.location.href,
  );

  async function share() {
    setSent({ what: "result", outcome: await sendShare(shareText(card), navigator) });
  }

  async function sendChallenge() {
    const text = challengeText(results, window.location.href, challenge);
    setSent({ what: "challenge", outcome: await sendShare(text, navigator) });
  }
  const friendTotal = challenge ? sumScores(challenge.scores) : null;

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

      {friendTotal !== null && (
        <p className="mt-3 text-xl" data-testid="challenge-result">
          Your friend scored <span className="tabular text-gold">{formatPoints(friendTotal)}</span>.{" "}
          <strong className="text-gold">{challengeResultLine(t.player, friendTotal)}</strong>
        </p>
      )}

      {onReplay && (
        <p className="mt-10 text-sm text-chalk-dim">
          Tap a round to see it again on the globe, with both pins.
        </p>
      )}
      <ol
        className={`${onReplay ? "mt-2" : "mt-10"} divide-y divide-graticule/60 border-y border-graticule/60`}
      >
        {results.map((r, i) => {
          const row = (
            <>
              <span className="font-sign text-2xl text-chalk-dim">{i + 1}</span>
              <span className="min-w-0">
                <span className="block truncate text-lg">{r.reveal.answer.place}</span>
                {r.atlas && (
                  <span className="text-sm text-sonar">
                    Atlas: {formatDistance(r.atlas.distanceKm)}
                  </span>
                )}
                {challenge && challenge.scores[i] !== undefined && (
                  <span className="ml-3 text-sm text-gold">
                    Friend: {formatPoints(challenge.scores[i])} points
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
            </>
          );
          const grid = "grid items-baseline gap-x-3 py-4";
          return (
            <li key={r.round.roundId}>
              {onReplay ? (
                <button
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  type="button"
                  onClick={() => onReplay(i)}
                  aria-label={`Look again at round ${i + 1}: ${r.reveal.answer.place}, you were ${formatDistance(r.reveal.distanceKm)} away`}
                  className={`${grid} group w-full grid-cols-[2rem_1fr_auto_1rem] rounded-lg px-1 text-left transition hover:bg-chalk/5 focus-visible:bg-chalk/5`}
                >
                  {row}
                  <span
                    aria-hidden="true"
                    className="self-center text-xl text-chalk-dim transition group-hover:translate-x-0.5 group-hover:text-chalk"
                  >
                    ›
                  </span>
                </button>
              ) : (
                <div className={`${grid} grid-cols-[2rem_1fr_auto]`}>{row}</div>
              )}
            </li>
          );
        })}
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
        {canChallenge && (
          <button
            type="button"
            onClick={sendChallenge}
            className="rounded-full border border-gold/60 px-6 py-3 font-semibold text-gold transition hover:border-gold"
          >
            {challenge ? "Send your score back" : "Challenge a friend"}
          </button>
        )}
        <button
          type="button"
          onClick={onPlayAgain}
          className="rounded-full border border-chalk/40 px-6 py-3 font-semibold transition hover:border-chalk"
        >
          {playAgainLabel}
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
          {sent && SENT_NOTE[sent.what][sent.outcome]}
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
