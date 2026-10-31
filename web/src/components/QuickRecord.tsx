"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  RECORD_GAMES,
  loadQuickRecord,
  percent,
  rightOf,
  standingLine,
  type QuickRecord as QuickRecordData,
  type RecordGame,
  type Tally,
} from "@/lib/game/quickRecord";

const GAMES: Record<RecordGame, { name: string; href: string; daily: string }> = {
  "further-north": {
    name: "Further North",
    href: "/further-north",
    daily: "/further-north/daily",
  },
  "odd-one-out": { name: "Odd one out", href: "/odd-one-out", daily: "/odd-one-out/daily" },
};

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function Bar({
  who,
  right,
  played,
  color,
  testId,
}: {
  who: string;
  right: number;
  played: number;
  color: string;
  testId: string;
}) {
  const rate = percent(right, played);
  return (
    <div data-testid={testId} data-right={right} data-played={played}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold">{who}</span>
        <span className="text-chalk-dim">
          {played === 0 ? "No rounds yet" : `${rightOf(right, played)} · `}
          {rate !== null && <strong className="text-chalk">{rate}%</strong>}
        </span>
      </div>
      <div
        className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-ocean-deep"
        role="meter"
        aria-label={`${who}: rounds right`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rate ?? 0}
        aria-valuetext={played === 0 ? "No rounds yet" : `${rightOf(right, played)}, ${rate}%`}
      >
        <div className={`h-full rounded-full ${color}`} style={{ width: `${rate ?? 0}%` }} />
      </div>
    </div>
  );
}

function GameCard({ game, total, daily }: { game: RecordGame; total: Tally; daily: Tally }) {
  const { name, href, daily: dailyHref } = GAMES[game];
  const runs = plural(total.runs, "run", "runs");
  return (
    <li
      className="rounded-2xl border border-graticule p-5"
      data-testid={`record-${game}`}
      aria-labelledby={`record-${game}-name`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={`record-${game}-name`} className="font-sign text-2xl font-extrabold">
          {name}
        </h3>
        <p className="text-sm text-chalk-dim">
          {daily.runs > 0 ? `${runs}, ${daily.runs} of them today's` : runs}
        </p>
      </div>
      <p className="mt-2 text-lg font-semibold" data-testid={`record-${game}-line`}>
        {standingLine(total)}
      </p>
      <div className="mt-4 space-y-3">
        <Bar
          who="You"
          right={total.right}
          played={total.rounds}
          color="bg-flare"
          testId={`record-${game}-you`}
        />
        <Bar
          who="Atlas"
          right={total.atlasRight}
          played={total.atlasPlayed}
          color="bg-sonar"
          testId={`record-${game}-atlas`}
        />
      </div>
      {total.atlasPlayed < total.rounds && (
        <p className="mt-3 text-xs text-chalk-dim">
          Atlas sits out a round when it never guessed one of its photos, so it has played{" "}
          {plural(total.rounds - total.atlasPlayed, "round", "rounds")} fewer than you.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link
          href={href}
          className="rounded-full border border-chalk/30 px-4 py-2 font-semibold transition hover:border-chalk"
        >
          Play {name}
        </Link>
        <Link
          href={dailyHref}
          className="rounded-full border border-chalk/30 px-4 py-2 font-semibold transition hover:border-chalk"
        >
          Today&apos;s run
        </Link>
      </div>
    </li>
  );
}

/**
 * You and Atlas in the quick games: for Further North and Odd one out, how many rounds you got
 * right of those you answered and how many Atlas got right of those it played, from the free
 * runs and today's runs played in this browser (`lib/game/quickRecord.ts`). Read after mount,
 * so the static page never guesses at it; shows nothing until a round has been played.
 */
export default function QuickRecord() {
  const [record, setRecord] = useState<QuickRecordData | null>(null);

  useEffect(() => {
    // Storage only exists in the browser, so the record is read once the page is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecord(loadQuickRecord());
  }, []);

  if (!record) return null;
  const played = RECORD_GAMES.filter((g) => record[g].total.rounds > 0);
  if (played.length === 0) return null;

  return (
    <section className="mt-12" aria-labelledby="quick-record-heading">
      <h2 id="quick-record-heading" className="font-sign text-3xl font-extrabold">
        You and Atlas in the quick games
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-chalk-dim">
        Every round of Further North and Odd one out you&apos;ve played here, free runs and
        today&apos;s, against Atlas&apos;s picks on the same photos.
      </p>
      <ul className="mt-4 grid gap-4 md:grid-cols-2">
        {played.map((g) => (
          <GameCard key={g} game={g} total={record[g].total} daily={record[g].daily} />
        ))}
      </ul>
    </section>
  );
}
