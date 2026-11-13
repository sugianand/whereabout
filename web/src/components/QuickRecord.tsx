"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  CLUE_GAMES,
  PICK_GAMES,
  loadQuickRecord,
  percent,
  rightOf,
  standingLine,
  type QuickRecord as QuickRecordData,
  type RecordGame,
  type Tally,
} from "@/lib/game/quickRecord";

interface GameInfo {
  name: string;
  href: string;
  /** Today's run, for a game with a daily. */
  daily?: string;
  /** The clue a clue game drills, shown over its name. */
  clue?: string;
  /** What one round is called, and what a run is. */
  unit: string;
  run: [one: string, many: string];
  /** Why Atlas has played fewer rounds than you. */
  sitsOut: string;
}

const PICKS_SIT_OUT = "Atlas sits out a round when it never guessed one of its photos";

const GAMES: Record<RecordGame, GameInfo> = {
  "further-north": {
    name: "Further North",
    href: "/further-north",
    daily: "/further-north/daily",
    unit: "round",
    run: ["run", "runs"],
    sitsOut: PICKS_SIT_OUT,
  },
  "odd-one-out": {
    name: "Odd one out",
    href: "/odd-one-out",
    daily: "/odd-one-out/daily",
    unit: "round",
    run: ["run", "runs"],
    sitsOut: PICKS_SIT_OUT,
  },
  "left-right": {
    name: "Left or right?",
    href: "/left-right",
    daily: "/left-right/daily",
    clue: "The road",
    unit: "photo",
    run: ["run", "runs"],
    sitsOut: "Atlas sits out a photo when it said nothing about the road or the country",
  },
  "which-climate": {
    name: "Which climate?",
    href: "/which-climate",
    daily: "/which-climate/daily",
    clue: "The climate",
    unit: "photo",
    run: ["game", "games"],
    sitsOut: "Atlas sits out a photo when it said nothing about the climate",
  },
};

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function Bar({
  who,
  right,
  played,
  unit,
  color,
  testId,
}: {
  who: string;
  right: number;
  played: number;
  unit: string;
  color: string;
  testId: string;
}) {
  const rate = percent(right, played);
  const none = `No ${unit}s yet`;
  return (
    <div data-testid={testId} data-right={right} data-played={played}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-semibold">{who}</span>
        <span className="text-chalk-dim">
          {played === 0 ? none : `${rightOf(right, played, unit)} · `}
          {rate !== null && <strong className="text-chalk">{rate}%</strong>}
        </span>
      </div>
      <div
        className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-ocean-deep"
        role="meter"
        aria-label={`${who}: ${unit}s right`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rate ?? 0}
        aria-valuetext={played === 0 ? none : `${rightOf(right, played, unit)}, ${rate}%`}
      >
        <div className={`h-full rounded-full ${color}`} style={{ width: `${rate ?? 0}%` }} />
      </div>
    </div>
  );
}

function GameCard({ game, total, daily }: { game: RecordGame; total: Tally; daily: Tally }) {
  const { name, href, daily: dailyHref, clue, unit, run, sitsOut } = GAMES[game];
  const runs = plural(total.runs, ...run);
  return (
    <li
      className="rounded-2xl border border-graticule p-5"
      data-testid={`record-${game}`}
      aria-labelledby={`record-${game}-name`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          {clue && (
            <p className="text-xs font-semibold uppercase tracking-widest text-chalk-dim">{clue}</p>
          )}
          <h3 id={`record-${game}-name`} className="font-sign text-2xl font-extrabold">
            {name}
          </h3>
        </div>
        <p className="text-sm text-chalk-dim">
          {daily.runs > 0 ? `${runs}, ${daily.runs} of them today's` : runs}
        </p>
      </div>
      <p className="mt-2 text-lg font-semibold" data-testid={`record-${game}-line`}>
        {standingLine(total, unit)}
      </p>
      <div className="mt-4 space-y-3">
        <Bar
          who="You"
          right={total.right}
          played={total.rounds}
          unit={unit}
          color="bg-flare"
          testId={`record-${game}-you`}
        />
        <Bar
          who="Atlas"
          right={total.atlasRight}
          played={total.atlasPlayed}
          unit={unit}
          color="bg-sonar"
          testId={`record-${game}-atlas`}
        />
      </div>
      {total.atlasPlayed < total.rounds && (
        <p className="mt-3 text-xs text-chalk-dim">
          {sitsOut}, so it has played {plural(total.rounds - total.atlasPlayed, unit, `${unit}s`)}{" "}
          fewer than you.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        <Link
          href={href}
          className="rounded-full border border-chalk/30 px-4 py-2 font-semibold transition hover:border-chalk"
        >
          Play {name}
        </Link>
        {dailyHref && (
          <Link
            href={dailyHref}
            className="rounded-full border border-chalk/30 px-4 py-2 font-semibold transition hover:border-chalk"
          >
            {`Today's ${run[0]}`}
          </Link>
        )}
      </div>
    </li>
  );
}

function RecordSection({
  id,
  title,
  blurb,
  games,
  record,
}: {
  id: string;
  title: string;
  blurb: string;
  games: readonly RecordGame[];
  record: QuickRecordData;
}) {
  const played = games.filter((g) => record[g].total.rounds > 0);
  if (played.length === 0) return null;
  return (
    <section className="mt-12" aria-labelledby={`${id}-heading`} data-testid={id}>
      <h2 id={`${id}-heading`} className="font-sign text-3xl font-extrabold">
        {title}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-chalk-dim">{blurb}</p>
      <ul className="mt-4 grid gap-4 md:grid-cols-2">
        {played.map((g) => (
          <GameCard key={g} game={g} total={record[g].total} daily={record[g].daily} />
        ))}
      </ul>
    </section>
  );
}

/**
 * You and Atlas in the quick games, and your clue reading: for Further North and Odd one out,
 * and for the clue games Left or right? (the road) and Which climate? (the climate), how many
 * rounds you got right of those you answered and how many Atlas got right of those it played,
 * from the free runs and today's runs played in this browser (`lib/game/quickRecord.ts`). Read
 * after mount, so the static page never guesses at it; each section shows nothing until one of
 * its games has been played.
 */
export default function QuickRecord() {
  const [record, setRecord] = useState<QuickRecordData | null>(null);

  useEffect(() => {
    // Storage only exists in the browser, so the record is read once the page is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecord(loadQuickRecord());
  }, []);

  if (!record) return null;

  return (
    <>
      <RecordSection
        id="clue-reading"
        title="Your clue reading"
        blurb="How often you've read the road in Left or right? and the climate in Which climate?, free runs and today's, against Atlas's own read of the same photos."
        games={CLUE_GAMES}
        record={record}
      />
      <RecordSection
        id="quick-record"
        title="You and Atlas in the quick games"
        blurb="Every round of Further North and Odd one out you've played here, free runs and today's, against Atlas's picks on the same photos."
        games={PICK_GAMES}
        record={record}
      />
    </>
  );
}
