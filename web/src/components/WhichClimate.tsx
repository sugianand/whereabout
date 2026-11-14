"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { isShortcut } from "@/lib/controls";
import {
  CLIMATE_CHALLENGE_PARAM,
  climateChallengeLine,
  climateChallengeScore,
  climateChallengeText,
  climateHeadToHead,
  friendCall,
  friendRight,
  parseClimateChallenge,
  type ClimateChallenge,
} from "@/lib/game/climateChallenge";
import {
  climateDailyShare,
  dailyClimateOrder,
  loadClimateDay,
  rememberClimateDay,
} from "@/lib/game/climateDaily";
import { runToday } from "@/lib/game/dailyRuns";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import { recordFreeRound } from "@/lib/game/quickRecord";
import {
  CLIMATE_GIST,
  CLIMATE_PHOTOS,
  climateAtlasLine,
  climateReducer,
  climateTotals,
  climateTruthLine,
  climateVerdict,
  dealClimate,
  initialClimate,
  latitudeLabel,
  loadBestClimate,
  rememberClimate,
  type ClimateMap,
  type ClimateResult,
} from "@/lib/game/whichClimate";
import { placeholderUrl, sources } from "@/lib/photoSources";
import { sendShare, type ShareOutcome } from "@/lib/share";
import { CLIMATE_GROUPS, atlasClimateGroup, type ClimateGroup } from "@/lib/trueClues";

import ControlsHelp from "./ControlsHelp";
import { DailyRunResult } from "./DailyRunShare";
import GamesMenu from "./GamesMenu";
import { HeadToHeadButton } from "./HeadToHeadButton";

type WhichClimateProps = {
  deck: Deck;
  /** Each dealable photo's Köppen group (`bundledClimateGroups`). */
  groups: ClimateMap;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that picks each game's seed. */
  random?: () => number;
  /**
   * Today's game (src/lib/game/climateDaily.ts): dealt from the UTC date, one try a day, picked
   * up after a reload and shared as a score only. It never touches the free games' best.
   */
  daily?: boolean;
  /** For tests: the clock that picks today's game. */
  now?: () => Date;
};

/** 1 to 5 name the groups in the order the buttons show them. */
const KEY_GROUP: Record<string, ClimateGroup> = Object.fromEntries(
  CLIMATE_GROUPS.map((group, i) => [String(i + 1), group]),
);

/** Why a challenge link was set aside for a fresh game. */
export const CLIMATE_CHALLENGE_NOTICE = {
  malformed: "That challenge link was cut short, so here's a fresh game instead.",
  missing: "That challenge's photos aren't in the game any more, so here's a fresh game instead.",
} as const;

/** Take the challenge out of the address, so a reload deals a fresh game, not the old link. */
function dropChallengeParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(CLIMATE_CHALLENGE_PARAM)) return;
  url.searchParams.delete(CLIMATE_CHALLENGE_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

const CHALLENGE_NOTE: Record<ShareOutcome, string> = {
  shared: "Challenge sent.",
  copied: "Challenge link copied. Whoever opens it plays these five photos, in the same order.",
  cancelled: "",
  failed: "Couldn't copy the link. Your browser blocked the clipboard.",
};

/**
 * Which climate? (src/lib/game/whichClimate.ts): one photo and the five Köppen groups. Name the
 * climate the place sits in by tapping a group or pressing 1 to 5; the answer shows the place on
 * the band of groups, with your call and Atlas's on it. Five photos a game, against Atlas.
 */
export default function WhichClimate({
  deck,
  groups,
  loadRecords,
  random,
  daily = false,
  now,
}: WhichClimateProps) {
  const [state, dispatch] = useReducer(climateReducer, initialClimate);
  const [best, setBest] = useState(0);
  const [bestBeforeGame, setBestBeforeGame] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  // Today's game: the day it was dealt for, kept when the clock passes midnight mid-game.
  const [day, setDay] = useState<string | null>(null);
  // A friend's challenge this game answers (src/lib/game/climateChallenge.ts): their five photos
  // and their call on each, shown once you have made yours.
  const [challenge, setChallenge] = useState<ClimateChallenge | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Deal a game; `fromLink` takes up a challenge the address carries, as the page opens. */
  const start = useCallback(
    (fromLink = false) => {
      if (daily) {
        const today = runToday(now?.());
        const kept = loadClimateDay(today)?.results ?? [];
        setDay(today);
        // The calls kept come first. With the same photos they are the day's deal anyway; a day
        // kept from an earlier deal (the catalog changed since) still reads back as it was played.
        const played = kept.map((r) => r.id);
        const order = [
          ...played,
          ...dailyClimateOrder(groups, today).filter((id) => !played.includes(id)),
        ].slice(0, Math.max(CLIMATE_PHOTOS, played.length));
        dispatch({ type: "start", order, from: kept });
        return;
      }
      const stored = loadBestClimate();
      setBest(stored);
      setBestBeforeGame(stored);
      const value = fromLink
        ? new URLSearchParams(window.location.search).get(CLIMATE_CHALLENGE_PARAM)
        : null;
      const linked = value === null ? null : parseClimateChallenge(value, groups);
      setNotice(linked && !linked.ok ? CLIMATE_CHALLENGE_NOTICE[linked.reason] : null);
      if (linked?.ok) {
        setChallenge(linked.challenge);
        dispatch({ type: "start", order: linked.challenge.ids });
        return;
      }
      setChallenge(null);
      dropChallengeParam();
      const seed = Math.floor((random ?? Math.random)() * 2 ** 32);
      dispatch({ type: "start", order: dealClimate(groups, seed) });
    },
    [groups, random, daily, now],
  );

  // The game is dealt in the browser after hydration, never at build time.
  useEffect(() => {
    const id = requestAnimationFrame(() => start(true));
    return () => cancelAnimationFrame(id);
  }, [start]);

  const load = useCallback(
    (ids: string[]) => (loadRecords ? loadRecords(ids) : fetchRecords(deck, ids)),
    [deck, loadRecords],
  );

  // The photo being called (or just answered) and the one after it.
  const playing = state.phase === "picking" || state.phase === "answered" ? state : null;
  const index = playing ? playing.results.length - (playing.phase === "answered" ? 1 : 0) : 0;
  // Today's finished game lists every photo it called, so it needs them all.
  const dayOver = state.phase === "done" && day !== null ? state.results : null;
  const wanted = useMemo(
    () =>
      playing ? playing.order.slice(index, index + 2) : dayOver ? dayOver.map((r) => r.id) : [],
    [playing, index, dayOver],
  );
  const missing = wanted.filter((id) => !records.has(id)).join(",");

  useEffect(() => {
    if (!missing) return;
    let cancelled = false;
    load(missing.split(","))
      .then((loaded) => {
        if (cancelled) return;
        setRecords((known) => {
          const next = new Map(known);
          for (const r of loaded) next.set(r.photo.id, r);
          return next;
        });
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [missing, load]);

  const record = playing ? records.get(playing.order[index]) : undefined;
  const upcoming = playing ? records.get(playing.order[index + 1] ?? "") : undefined;

  // Warm the cache with the next photo while the player reads the answer.
  useEffect(() => {
    if (upcoming) new Image().src = sources(upcoming.photo).src;
  }, [upcoming]);

  const ready = state.phase === "picking" && record !== undefined;

  const choose = useCallback(
    (group: ClimateGroup) => {
      if (state.phase !== "picking" || !record) return;
      const truth = groups[record.photo.id];
      if (!truth) return;
      const action = {
        type: "picked",
        group,
        truth,
        atlas: atlasClimateGroup(record.atlas),
      } as const;
      const after = climateReducer(state, action);
      if (after.phase === "answered" && day) {
        // Today's game is kept after every call, so a reload resumes it and never deals it again.
        rememberClimateDay(day, after.results);
      } else if (after.phase === "answered") {
        // Count the call in your clue reading on Your map, as it is made, so leaving mid-game
        // still counts the photos called.
        const call = after.results[after.results.length - 1];
        recordFreeRound("which-climate", {
          first: after.results.length === 1,
          correct: call.correct,
          atlas: call.atlas === null ? null : call.atlas === call.truth,
        });
        // Only a whole game counts as a best, and never a friend's challenge: its photos may
        // have been seen before, so it is played for the friend only.
        if (after.results.length === after.order.length && !challenge) {
          setBest(rememberClimate(climateTotals(after.results).right));
        }
      }
      dispatch(action);
    },
    [state, record, groups, day, challenge],
  );

  // 1 to 5 make the call from the keyboard.
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      const group = KEY_GROUP[e.key];
      if (!group || !isShortcut(e)) return;
      e.preventDefault();
      choose(group);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, choose]);

  if (state.phase === "done" && day && state.results.length > 0) {
    return <ClimateDayResult day={day} results={state.results} records={records} now={now} />;
  }

  if (state.phase === "done") {
    return (
      <ClimateSummary
        results={state.results}
        records={records}
        best={best}
        newBest={!challenge && climateTotals(state.results).right > bestBeforeGame}
        groups={groups}
        challenge={challenge}
        onAgain={() => start()}
      />
    );
  }

  const results = playing?.results ?? [];
  const totals = climateTotals(results);
  const answered = state.phase === "answered" ? results[results.length - 1] : null;
  const last = playing !== null && results.length === playing.order.length;

  return (
    <main
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-ocean-deep"
      data-phase={answered ? "revealed" : "picking"}
    >
      <h1 className="sr-only">{`Whereabout: Which climate?, photo ${index + 1} of ${CLIMATE_PHOTOS}`}</h1>

      <header className="flex items-start justify-between gap-4 px-4 pb-2 pt-4 md:px-6">
        <div className="min-w-0">
          <Link
            href="/"
            className="font-sign text-3xl font-extrabold leading-none tracking-tight md:text-4xl"
          >
            Whereabout
          </Link>
          <p className="mt-1 text-sm text-chalk-dim">
            {day
              ? `Which climate?, today's game (${day}).`
              : challenge
                ? `A friend's challenge: ${climateChallengeScore(challenge, groups)} of ${CLIMATE_PHOTOS} to beat.`
                : "Which climate? Name the Köppen group."}
          </p>
          <Link
            href={daily ? "/which-climate" : "/which-climate/daily"}
            className="mt-0.5 inline-block text-sm text-gold underline underline-offset-2 hover:brightness-110"
          >
            {daily ? "Free games" : "Today's game"}
          </Link>
          <p className="text-sm text-chalk-dim" aria-live="polite">
            {`Photo ${Math.min(index + 1, CLIMATE_PHOTOS)} of ${CLIMATE_PHOTOS}`}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          <GamesMenu screen="which-climate" streakHref="/streak" />
          <ControlsHelp screen="which-climate" />
          <dl className="text-right">
            <dt className="text-sm text-chalk-dim">Score</dt>
            <dd className="font-sign tabular text-3xl font-bold leading-none">{totals.right}</dd>
            {!daily && (
              <div className="mt-1 flex justify-end gap-1.5 text-sm text-chalk-dim">
                <dt>Best</dt>
                <dd className="tabular">{best}</dd>
              </div>
            )}
          </dl>
        </div>
      </header>

      <ClimatePhoto record={record} answered={answered} />

      {!answered && (
        <div
          role="group"
          aria-label="Climates"
          className="grid grid-cols-6 gap-2 px-2 pb-3 md:mx-auto md:w-full md:max-w-3xl md:grid-cols-5 md:gap-3 md:pb-6"
        >
          {CLIMATE_GROUPS.map((group, i) => (
            <button
              key={group}
              type="button"
              onClick={() => choose(group)}
              disabled={!ready}
              data-testid={`climate-${group}`}
              aria-keyshortcuts={String(i + 1)}
              className={`${i < 3 ? "col-span-2" : "col-span-3"} flex min-w-0 flex-col items-center rounded-2xl bg-gold px-1 py-2.5 text-ocean-deep transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60 md:col-span-1 md:py-3`}
            >
              <span className="font-sign text-lg font-extrabold leading-tight md:text-xl">
                {group}
              </span>{" "}
              {/* What the group means: read out everywhere, shown where there's room. */}
              <span className="sr-only text-xs leading-tight md:not-sr-only md:block">
                {CLIMATE_GIST[group]}
              </span>
            </button>
          ))}
        </div>
      )}

      {notice && state.phase === "picking" && results.length === 0 && (
        <p role="status" className="px-4 pb-2 text-center text-sm text-chalk-dim">
          {notice}
        </p>
      )}

      {error && (
        <p role="alert" className="absolute inset-x-4 bottom-4 text-center text-sm text-flare">
          {error}
        </p>
      )}

      {answered && record && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-3 md:p-6">
          <ClimateCard
            key={results.length}
            result={answered}
            place={record.photo.place}
            lat={record.photo.lat}
            atlasTally={[totals.atlasRight, results.length]}
            friend={
              challenge
                ? {
                    call: friendCall(challenge, results.length - 1),
                    right: results.filter((_, i) => friendRight(challenge, i, groups)).length,
                  }
                : null
            }
            onNext={() => dispatch({ type: "next" })}
            nextLabel={last ? (day ? "See today's result" : "See the results") : "Next photo"}
          />
        </div>
      )}
    </main>
  );
}

function ClimatePhoto({
  record,
  answered,
}: {
  record: GameRecord | undefined;
  answered: ClimateResult | null;
}) {
  const photo = record?.photo;
  const src = photo ? sources(photo) : null;
  const blur = photo ? placeholderUrl(photo.imageUrl) : null;
  const ring =
    answered === null ? "border-graticule" : answered.correct ? "border-sonar" : "border-flare";
  return (
    <div className="relative min-h-0 flex-1 px-2 pb-2 md:px-6">
      <div
        className={`wb-night relative h-full w-full overflow-hidden rounded-2xl border-2 bg-graticule/40 ${ring}`}
        data-testid="climate-photo"
        data-photo={photo?.id}
        style={blur ? { backgroundImage: `url(${blur})`, backgroundSize: "cover" } : undefined}
      >
        {src && (
          // Wikimedia thumbnails, already sized; next/image can't optimise a static export.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={photo!.id}
            src={src.src}
            srcSet={src.srcSet}
            sizes="100vw"
            alt="The photo"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {photo && (
          <a
            href={photo.credit.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className={`absolute right-2 top-1 max-w-[60%] truncate text-[11px] text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk ${answered ? "" : "hidden md:block"}`}
          >
            Photo: {photo.credit.author}, {photo.credit.license}
          </a>
        )}
      </div>
    </div>
  );
}

/** The groups' names on the band, free to break at a soft hyphen on a narrow phone. */
const BAND_WORD: Record<ClimateGroup, string> = {
  Tropical: "Tropi\u00adcal",
  Arid: "Arid",
  Temperate: "Tem\u00adper\u00adate",
  Continental: "Conti\u00adnental",
  Polar: "Polar",
};

/**
 * The five groups in a row, the place's own lit: where it sits among them, with the player's
 * call and Atlas's marked under theirs in words, so it reads without colour.
 */
export function ClimateBand({
  result,
  friend = null,
}: {
  result: ClimateResult;
  /** On a friend's challenge: the call they made on this photo. */
  friend?: ClimateGroup | null;
}) {
  return (
    <ol
      aria-label="The five climate groups"
      className="mt-3 grid grid-cols-5 gap-1"
      data-testid="climate-band"
    >
      {CLIMATE_GROUPS.map((group) => {
        const here = group === result.truth;
        const marks = [
          result.picked === group ? "You" : null,
          result.atlas === group ? "Atlas" : null,
          friend === group ? "Friend" : null,
        ].filter((m): m is string => m !== null);
        return (
          <li
            key={group}
            data-group={group}
            aria-current={here ? "location" : undefined}
            className="flex min-w-0 flex-col items-center"
          >
            <span
              className={`flex min-h-9 w-full items-center justify-center hyphens-manual break-words rounded-md px-0.5 py-1 text-center text-[11px] font-semibold leading-tight sm:text-xs ${here ? "bg-gold text-ocean-deep" : "border border-graticule text-chalk-dim"}`}
            >
              {BAND_WORD[group]}
            </span>
            <span className="mt-0.5 h-4 text-center text-[11px] leading-4 text-chalk">
              {here ? "Here" : ""}
            </span>
            {marks.length > 0 && (
              <span className="text-center text-[11px] leading-tight text-chalk-dim">
                {marks.join(" · ")}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ClimateCard({
  result,
  place,
  lat,
  atlasTally,
  friend,
  onNext,
  nextLabel,
}: {
  result: ClimateResult;
  place: string;
  lat: number;
  atlasTally: readonly [number, number];
  /** On a friend's challenge: their call on this photo and their score so far. */
  friend: { call: ClimateGroup | null; right: number } | null;
  onNext: () => void;
  nextLabel: string;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);
  const [atlasRight, played] = atlasTally;
  return (
    <section
      aria-labelledby="climate-verdict"
      className="pointer-events-auto w-full max-w-md rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-4 shadow-2xl md:p-5"
    >
      <h2
        id="climate-verdict"
        className={`font-sign text-3xl font-extrabold leading-tight ${result.correct ? "text-sonar" : "text-flare"}`}
      >
        {result.correct ? "Correct" : "Wrong"}
      </h2>
      <p className="mt-1 text-chalk">{climateTruthLine(result.truth)}</p>
      <p className="text-sm text-chalk-dim">{`${place} · ${latitudeLabel(lat)}`}</p>
      <ClimateBand result={result} friend={friend?.call ?? null} />
      <p className="mt-2 text-sm text-chalk-dim">
        {`${climateAtlasLine(result.atlas, result.truth)} Atlas this game: ${atlasRight} of ${played}.`}
      </p>
      {friend?.call && (
        <p className="text-sm text-chalk-dim" data-testid="climate-friend">
          {`Your friend called it ${friend.call.toLowerCase()}${friend.call === result.truth ? ", and got it." : ": wrong."} Your friend so far: ${friend.right} of ${played}.`}
        </p>
      )}
      <button
        ref={nextRef}
        type="button"
        onClick={onNext}
        className="mt-3 rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
      >
        {nextLabel}
      </button>
    </section>
  );
}

function ClimateSummary({
  results,
  records,
  best,
  newBest,
  groups,
  challenge,
  onAgain,
}: {
  results: readonly ClimateResult[];
  records: ReadonlyMap<string, GameRecord>;
  best: number;
  newBest: boolean;
  groups: ClimateMap;
  /** The friend's challenge this game answered, if it was one. */
  challenge: ClimateChallenge | null;
  onAgain: () => void;
}) {
  const none = results.length === 0;
  const { right, atlasRight, atlasRead } = climateTotals(results);
  const againRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    againRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-sm text-gold">Which climate?</p>
      <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
        {none ? "No photos to play yet" : `${right} of ${results.length}`}
      </h1>
      {none ? (
        <p className="mt-4 text-lg text-chalk-dim">
          Which climate? needs photos from at least two climates to deal a game.
        </p>
      ) : (
        <>
          <p className="mt-4 text-lg text-chalk">
            {`${climateVerdict(right, atlasRight)} Atlas read the climate on ${atlasRead} of the ${results.length} photos.`}
          </p>
          {challenge ? (
            <p className="mt-1 text-chalk" data-testid="climate-challenge-line">
              {climateChallengeLine(right, challenge, groups)}
            </p>
          ) : (
            <p className="mt-1 text-chalk-dim">
              {newBest ? "That's your new best!" : `Your best is ${best} of ${CLIMATE_PHOTOS}.`}
            </p>
          )}
          <ClimateRows results={results} records={records} friend={challenge} />
        </>
      )}
      <div className="mt-8 flex flex-wrap items-center gap-4">
        {!none && (
          <button
            ref={againRef}
            type="button"
            onClick={onAgain}
            className="rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
          >
            {challenge ? "Play a fresh game" : "Play again"}
          </button>
        )}
        {!none && results.length === CLIMATE_PHOTOS && (
          <ChallengeButton results={results} groups={groups} answering={challenge} />
        )}
        <Link href="/" className="text-chalk-dim underline underline-offset-2 hover:text-chalk">
          Back to the main game
        </Link>
      </div>
    </main>
  );
}

/** Each photo called: the place, its climate, your call and Atlas's. */
function ClimateRows({
  results,
  records,
  friend = null,
}: {
  results: readonly ClimateResult[];
  records: ReadonlyMap<string, GameRecord>;
  /** On a friend's challenge: their calls, listed beside yours. */
  friend?: ClimateChallenge | null;
}) {
  return (
    <ol className="mt-6 space-y-2" aria-label="Your calls">
      {results.map((r, i) => (
        <li
          key={r.id}
          className="rounded-xl border border-graticule/70 px-3 py-2 text-sm"
          data-testid="climate-row"
        >
          <span className="block text-chalk">
            {records.get(r.id)?.photo.place ?? `Photo ${i + 1}`}
          </span>
          <span className="block text-chalk-dim">
            {`${r.truth}. You: ${r.picked} ${r.correct ? "✓" : "✗"}. Atlas: ${r.atlas === null ? "no read" : `${r.atlas} ${r.atlas === r.truth ? "✓" : "✗"}`}`}
            {friend?.calls[i] &&
              `. Friend: ${friend.calls[i]} ${friend.calls[i] === r.truth ? "✓" : "✗"}`}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Challenge a friend from a whole free game (src/lib/game/climateChallenge.ts): a link to the
 * same five photos with your call on each. Answering a challenge, it sends one back, with the
 * head-to-head picture beside it.
 */
function ChallengeButton({
  results,
  groups,
  answering,
}: {
  results: readonly ClimateResult[];
  groups: ClimateMap;
  answering: ClimateChallenge | null;
}) {
  const [sent, setSent] = useState("");
  const text = () =>
    climateChallengeText(results, window.location.href, groups, answering ?? undefined);
  async function send() {
    setSent(CHALLENGE_NOTE[await sendShare(text(), navigator)]);
  }
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex flex-wrap gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={send}
          className="rounded-full border-2 border-gold px-5 py-2.5 font-semibold text-gold transition hover:bg-gold/10"
        >
          {answering ? "Send yours back" : "Challenge a friend"}
        </button>
        {answering && (
          <HeadToHeadButton
            headToHead={climateHeadToHead(results, answering, groups, window.location.href)}
            replyText={text}
            onNote={setSent}
          />
        )}
      </span>
      <span role="status" className={sent ? "mt-1 text-xs text-chalk-dim" : "sr-only"}>
        {sent}
      </span>
    </span>
  );
}

/** Today's Which climate? once every photo is called: the score, the share and each call. */
function ClimateDayResult({
  day,
  results,
  records,
  now,
}: {
  day: string;
  results: readonly ClimateResult[];
  records: ReadonlyMap<string, GameRecord>;
  now?: () => Date;
}) {
  const { right, atlasRight, atlasRead } = climateTotals(results);
  const atlas =
    atlasRead === results.length
      ? climateVerdict(right, atlasRight)
      : atlasRead > 0
        ? `Atlas got ${atlasRight} of the ${atlasRead} it read.`
        : "Atlas said nothing about the climate today.";
  return (
    <DailyRunResult
      game="Which climate?"
      day={day}
      headline={`${right} of ${results.length}`}
      summary={`That's today's game played. ${atlas}`}
      shareText={(href) => climateDailyShare(day, results, href)}
      freeHref="/which-climate"
      now={now}
      unit="game"
    >
      <ClimateRows results={results} records={records} />
    </DailyRunResult>
  );
}
