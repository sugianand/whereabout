"use client";

import { useEffect, useState } from "react";

import {
  byGame,
  loadChallengeLog,
  tally,
  tallyLine,
  type AnsweredChallenge,
  type ChallengeOutcome,
} from "@/lib/challengeLog";
import { sendShare, type ShareOutcome } from "@/lib/share";

const OUTCOME: Record<ChallengeOutcome, { word: string; className: string }> = {
  won: { word: "Won", className: "border-sonar text-sonar" },
  lost: { word: "Lost", className: "border-flare text-flare" },
  tied: { word: "Tied", className: "border-gold text-gold" },
};

const SENT: Record<ShareOutcome, string> = {
  shared: "Rematch sent.",
  copied: "Rematch link copied. Paste it to your friend.",
  cancelled: "",
  failed: "Couldn't share or copy the rematch in this browser.",
};

/** "12 Nov", or "12 Nov 2025" from another year; the day as kept, in the player's own calendar. */
export function dayLabel(day: string, today: Date = new Date()): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(y === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

function Entry({ entry, onNote }: { entry: AnsweredChallenge; onNote: (note: string) => void }) {
  const { word, className } = OUTCOME[entry.outcome];
  async function rematch() {
    onNote(SENT[await sendShare(entry.reply, navigator)]);
  }
  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
      data-testid="head-to-head-entry"
    >
      <span
        className={`w-14 shrink-0 rounded-full border px-2 py-0.5 text-center text-xs font-bold uppercase tracking-wide ${className}`}
        data-outcome={entry.outcome}
      >
        {word}
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">You {entry.you}</span>
        <span className="text-chalk-dim"> · Friend {entry.friend}</span>
        <span className="block text-xs text-chalk-dim">{dayLabel(entry.day)}</span>
      </span>
      <span className="flex flex-wrap gap-2 text-sm">
        {/* A path on this site, kept as answered: the friend's same game, to play again. */}
        <a
          href={entry.link}
          className="rounded-full border border-chalk/30 px-3 py-1.5 font-semibold transition hover:border-chalk"
        >
          Play theirs again
        </a>
        <button
          type="button"
          onClick={rematch}
          className="rounded-full border border-gold/60 px-3 py-1.5 font-semibold text-gold transition hover:border-gold"
        >
          Send a rematch
        </button>
      </span>
    </li>
  );
}

function GameCard({ game, entries }: { game: string; entries: AnsweredChallenge[] }) {
  const [note, setNote] = useState("");
  const slug = game.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <li
      className="rounded-2xl border border-graticule p-5"
      data-testid={`head-to-head-${slug}`}
      aria-labelledby={`head-to-head-${slug}-name`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={`head-to-head-${slug}-name`} className="font-sign text-2xl font-extrabold">
          {game}
        </h3>
        <p className="text-sm font-semibold" data-testid={`head-to-head-${slug}-tally`}>
          {tallyLine(tally(entries))}
        </p>
      </div>
      <ul className="mt-2 divide-y divide-graticule">
        {entries.map((e) => (
          <Entry key={e.link} entry={e} onNote={setNote} />
        ))}
      </ul>
      <p role="status" className={note ? "mt-2 text-xs text-chalk-dim" : "sr-only"}>
        {note}
      </p>
    </li>
  );
}

/**
 * Head to head with friends: every friend's challenge answered in this browser, won, lost or
 * tied, by game, newest first, each with the friend's link to play again and the player's own
 * result to send back as a rematch (`lib/challengeLog.ts`). Read after mount, so the static page
 * never guesses at it; shows nothing until a challenge has been answered.
 */
export default function HeadToHeadLog() {
  const [log, setLog] = useState<AnsweredChallenge[] | null>(null);

  useEffect(() => {
    // Storage only exists in the browser, so the log is read once the page is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLog(loadChallengeLog());
  }, []);

  if (!log || log.length === 0) return null;
  const games = byGame(log);

  return (
    <section className="mt-12" aria-labelledby="head-to-head-heading">
      <h2 id="head-to-head-heading" className="font-sign text-3xl font-extrabold">
        Head to head with friends
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-chalk-dim">
        Every challenge you&apos;ve answered from a friend&apos;s link here:{" "}
        <strong className="text-chalk" data-testid="head-to-head-total">
          {tallyLine(tally(log))}
        </strong>
        . Play theirs again, or send yours as a rematch.
      </p>
      <ul className="mt-4 grid gap-4 md:grid-cols-2">
        {games.map((g) => (
          <GameCard key={g.game} game={g.game} entries={g.entries} />
        ))}
      </ul>
    </section>
  );
}
