"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { CLUE_CYCLE, type ClueKind } from "@/lib/game/clueMix";
import {
  PICK_GAMES,
  clueReading,
  loadQuickRecord,
  percent,
  rightOf,
  standingLine,
  type QuickRecord as QuickRecordData,
  type RecordGame,
  type ClueReading,
  type Tally,
} from "@/lib/game/quickRecord";
import type { ClimateGroup } from "@/lib/trueClues";

import ClimateMixUps from "./ClimateMixUps";

interface GameInfo {
  name: string;
  href: string;
  /** Today's run, for a game with a daily. */
  daily?: string;
  /** What one round is called, and what a run is. */
  unit: string;
  run: [one: string, many: string];
  /** Why Atlas has played fewer rounds than you. */
  sitsOut: string;
}

const PICKS_SIT_OUT = "Atlas sits out a round when it never guessed one of its photos";

const CLUE_MIX: GameInfo = {
  name: "Clue mix",
  href: "/clue-mix",
  daily: "/clue-mix/daily",
  unit: "photo",
  run: ["run", "runs"],
  sitsOut: "",
};

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
    unit: "photo",
    run: ["run", "runs"],
    sitsOut: "Atlas sits out a photo when it said nothing about the road or the country",
  },
  "which-climate": {
    name: "Which climate?",
    href: "/which-climate",
    daily: "/which-climate/daily",
    unit: "photo",
    run: ["game", "games"],
    sitsOut: "Atlas sits out a photo when it said nothing about the climate",
  },
  "on-the-ground": {
    name: "What's on the ground?",
    href: "/on-the-ground",
    daily: "/on-the-ground/daily",
    unit: "photo",
    run: ["game", "games"],
    sitsOut: "Atlas sits out a photo when none of its clues named a city, a skyline or a coast",
  },
  "clue-mix-road": CLUE_MIX,
  "clue-mix-climate": CLUE_MIX,
  "clue-mix-continent": CLUE_MIX,
  "clue-mix-ground": CLUE_MIX,
};

/** Each clue's card: its name, and why Atlas has read fewer photos of it than you. */
const CLUES: Record<ClueKind, { name: string; sitsOut: string }> = {
  road: {
    name: "The road",
    sitsOut: "Atlas sits out a photo when it said nothing about the road or the country",
  },
  climate: {
    name: "The climate",
    sitsOut: "Atlas sits out a photo when it said nothing about the climate",
  },
  continent: {
    name: "The continent",
    sitsOut: "Atlas sits out a photo when it named no country",
  },
  ground: {
    name: "The ground",
    sitsOut: "Atlas sits out a photo when none of its clues named a city, a skyline or a coast",
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
  const { name, href, daily: dailyHref, unit, run, sitsOut } = GAMES[game];
  const runs = plural(total.runs, ...run);
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

const LINK =
  "rounded-full border border-chalk/30 px-4 py-2 font-semibold transition hover:border-chalk";

/**
 * One clue's card in your clue reading: every game that asks the clue added up (Left or right?
 * and Clue mix for the road, say), with each game's runs counted apart and a way into each.
 */
function ClueCard({ clue, reading }: { clue: ClueKind; reading: ClueReading }) {
  const { name, sitsOut } = CLUES[clue];
  const { total } = reading;
  const id = `record-${clue}`;
  const played = reading.sources.filter((s) => s.record.total.runs > 0);
  return (
    <li
      className="rounded-2xl border border-graticule p-5"
      data-testid={id}
      aria-labelledby={`${id}-name`}
    >
      <h3 id={`${id}-name`} className="font-sign text-2xl font-extrabold">
        {name}
      </h3>
      <ul className="mt-1 text-sm text-chalk-dim" aria-label="Played in">
        {played.map(({ game, record }) => {
          const info = GAMES[game];
          const runs = plural(
            record.total.runs,
            `${info.name} ${info.run[0]}`,
            `${info.name} ${info.run[1]}`,
          );
          return (
            <li key={game} data-testid={`${id}-${game}`}>
              {record.daily.runs > 0 ? `${runs}, ${record.daily.runs} of them today's` : runs}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-lg font-semibold" data-testid={`${id}-line`}>
        {standingLine(total, "photo")}
      </p>
      <div className="mt-4 space-y-3">
        <Bar
          who="You"
          right={total.right}
          played={total.rounds}
          unit="photo"
          color="bg-flare"
          testId={`${id}-you`}
        />
        <Bar
          who="Atlas"
          right={total.atlasRight}
          played={total.atlasPlayed}
          unit="photo"
          color="bg-sonar"
          testId={`${id}-atlas`}
        />
      </div>
      {total.atlasPlayed < total.rounds && (
        <p className="mt-3 text-xs text-chalk-dim">
          {sitsOut}, so it has played {plural(total.rounds - total.atlasPlayed, "photo", "photos")}{" "}
          fewer than you.
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {reading.sources.flatMap(({ game }) => {
          const info = GAMES[game];
          return [
            <Link key={game} href={info.href} className={LINK}>
              Play {info.name}
            </Link>,
            info.daily && (
              <Link key={`${game}-daily`} href={info.daily} className={LINK}>
                {`Today's ${info.name}`}
              </Link>
            ),
          ];
        })}
      </div>
    </li>
  );
}

function RecordSection({
  id,
  title,
  blurb,
  children,
}: {
  id: string;
  title: string;
  blurb: string;
  /** The cards, then anything shown under them. */
  children: ReactNode;
}) {
  return (
    <section className="mt-12" aria-labelledby={`${id}-heading`} data-testid={id}>
      <h2 id={`${id}-heading`} className="font-sign text-3xl font-extrabold">
        {title}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-chalk-dim">{blurb}</p>
      {children}
    </section>
  );
}

const GRID = "mt-4 grid gap-4 md:grid-cols-2";

/**
 * You and Atlas in the quick games, and your clue reading: for Further North and Odd one out,
 * how many rounds you got right of those you answered and how many Atlas got right of those it
 * played; for each clue (the road, the climate, the continent, the ground), the same over every
 * game that asks it, so Clue mix's road calls count with Left or right?'s, its climate calls with
 * Which climate?'s and its ground calls with What's on the ground?'s. From the free runs and today's runs played in this browser
 * (`lib/game/quickRecord.ts`). Read after mount, so the static page never guesses at it; each
 * section, and each clue, shows nothing until it has been played. Under the clue reading, the
 * climates you misread most (`ClimateMixUps`).
 */
export default function QuickRecord({
  climateCounts = {},
}: {
  /** Photos Which climate? can deal in each climate, for the climate mix-ups' practice game. */
  climateCounts?: Readonly<Partial<Record<ClimateGroup, number>>>;
}) {
  const [record, setRecord] = useState<QuickRecordData | null>(null);

  useEffect(() => {
    // Storage only exists in the browser, so the record is read once the page is mounted.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecord(loadQuickRecord());
  }, []);

  if (!record) return null;

  const reading = clueReading(record);
  const clues = CLUE_CYCLE.filter((c) => reading[c].total.rounds > 0);
  const picks = PICK_GAMES.filter((g) => record[g].total.rounds > 0);

  return (
    <>
      {clues.length > 0 && (
        <RecordSection
          id="clue-reading"
          title="Your clue reading"
          blurb="How often you've read the road, the climate, the continent and the ground, in the clue games and Clue mix, free runs and today's, against Atlas's own read of the same photos."
        >
          <ul className={GRID}>
            {clues.map((c) => (
              <ClueCard key={c} clue={c} reading={reading[c]} />
            ))}
          </ul>
          <ClimateMixUps counts={climateCounts} />
        </RecordSection>
      )}
      {picks.length > 0 && (
        <RecordSection
          id="quick-record"
          title="You and Atlas in the quick games"
          blurb="Every round of Further North and Odd one out you've played here, free runs and today's, against Atlas's picks on the same photos."
        >
          <ul className={GRID}>
            {picks.map((g) => (
              <GameCard key={g} game={g} total={record[g].total} daily={record[g].daily} />
            ))}
          </ul>
        </RecordSection>
      )}
    </>
  );
}
