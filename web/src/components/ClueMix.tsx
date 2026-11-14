"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { isShortcut } from "@/lib/controls";
import {
  CLUE_CHALLENGE_PARAM,
  clueChallengeLine,
  clueChallengeOrder,
  clueChallengeText,
  clueHeadToHead,
  friendMissAnswer,
  parseClueChallenge,
  type ClueChallenge,
  type ClueRun,
} from "@/lib/game/clueChallenge";
import {
  clueDailyShare,
  clueRunWords,
  dailyClueOrder,
  loadClueDay,
  rememberClueDay,
  type ClueDay,
} from "@/lib/game/clueDaily";
import {
  CLUE_CYCLE,
  CLUE_QUESTION,
  answerName,
  atlasClueRead,
  clueAnswers,
  clueAtlasLine,
  clueMixOver,
  clueMixReducer,
  clueTruth,
  clueTruthLine,
  dealClueMix,
  initialClueMix,
  loadBestClueMix,
  rememberClueMix,
  type ClueKind,
  type ClueMaps,
} from "@/lib/game/clueMix";
import { runToday } from "@/lib/game/dailyRuns";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import { placeholderUrl, sources } from "@/lib/photoSources";
import { sendShare, type ShareOutcome } from "@/lib/share";

import ControlsHelp from "./ControlsHelp";
import { DailyRunResult, ShareDay } from "./DailyRunShare";
import GamesMenu from "./GamesMenu";
import { HeadToHeadButton } from "./HeadToHeadButton";

type ClueMixProps = {
  deck: Deck;
  /** Each dealable photo's driving side, climate group and continent (bundled.ts). */
  maps: ClueMaps;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that picks each run's seed. */
  random?: () => number;
  /**
   * Today's run (src/lib/game/clueDaily.ts): dealt from the UTC date, one try a day, picked up
   * after a reload and shared as counts only. It never touches the free runs' best.
   */
  daily?: boolean;
  /** For tests: the clock that picks today's run. */
  now?: () => Date;
};

/** The clue's name on the cycle shown over the buttons. */
const CLUE_NAME: Record<ClueKind, string> = {
  road: "Road",
  climate: "Climate",
  continent: "Continent",
};

const ROAD_KEYS: Record<string, string> = { ArrowLeft: "left", ArrowRight: "right" };

/** "1 clue", "4 clues". */
function clues(n: number): string {
  return `${n} clue${n === 1 ? "" : "s"}`;
}

/** Why a challenge link was set aside for a fresh run. */
export const CLUE_CHALLENGE_NOTICE = {
  malformed: "That challenge link was cut short, so here's a fresh run instead.",
  missing: "That challenge's photos aren't in the game any more, so here's a fresh run instead.",
} as const;

/** Take the challenge out of the address, so a reload deals a fresh run, not the old link. */
function dropChallengeParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(CLUE_CHALLENGE_PARAM)) return;
  url.searchParams.delete(CLUE_CHALLENGE_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

const CHALLENGE_NOTE: Record<ShareOutcome, string> = {
  shared: "Challenge sent.",
  copied: "Challenge link copied. Whoever opens it plays these photos, asking the same clues.",
  cancelled: "",
  failed: "Couldn't copy the link. Your browser blocked the clipboard.",
};

/**
 * Clue mix (src/lib/game/clueMix.ts): one photo at a time, each asking the next clue in turn,
 * the side of the road, the climate or the continent, until the first wrong call.
 */
export default function ClueMix({
  deck,
  maps,
  loadRecords,
  random,
  daily = false,
  now,
}: ClueMixProps) {
  const [state, dispatch] = useReducer(clueMixReducer, initialClueMix);
  const [best, setBest] = useState(0);
  const [bestBeforeRun, setBestBeforeRun] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  // Today's run: the day it was dealt for (kept when the clock passes midnight mid-run) and,
  // once it has ended, how it went, which shows instead of the game.
  const [day, setDay] = useState<string | null>(null);
  const [dayDone, setDayDone] = useState<ClueDay | null>(null);
  // A free run's seed, for the challenge link its end can send.
  const [seed, setSeed] = useState(0);
  // A friend's challenge this run answers (src/lib/game/clueChallenge.ts): their steps, the run
  // to beat and the answer that ended it.
  const [challenge, setChallenge] = useState<ClueChallenge | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Deal a run; `fromLink` takes up a challenge the address carries, as the page opens. */
  const start = useCallback(
    (fromLink = false) => {
      if (daily) {
        const today = runToday(now?.());
        const kept = loadClueDay(today);
        setDay(today);
        if (kept?.ended) {
          setDayDone(kept);
          return;
        }
        const { streak, atlasRight, atlasPlayed } = kept ?? {
          streak: 0,
          atlasRight: 0,
          atlasPlayed: 0,
        };
        dispatch({
          type: "start",
          order: dailyClueOrder(maps, today),
          from: { streak, atlasRight, atlasPlayed },
        });
        return;
      }
      const stored = loadBestClueMix();
      setBest(stored);
      setBestBeforeRun(stored);
      const value = fromLink
        ? new URLSearchParams(window.location.search).get(CLUE_CHALLENGE_PARAM)
        : null;
      const linked = value === null ? null : parseClueChallenge(value, maps);
      setNotice(linked && !linked.ok ? CLUE_CHALLENGE_NOTICE[linked.reason] : null);
      if (linked?.ok) {
        setChallenge(linked.challenge);
        setSeed(linked.challenge.seed);
        dispatch({ type: "start", order: clueChallengeOrder(linked.challenge, maps) });
        return;
      }
      setChallenge(null);
      dropChallengeParam();
      const fresh = Math.floor((random ?? Math.random)() * 2 ** 32);
      setSeed(fresh);
      dispatch({ type: "start", order: dealClueMix(maps, fresh) });
    },
    [maps, random, daily, now],
  );

  // The run is dealt in the browser after hydration, never at build time.
  useEffect(() => {
    const id = requestAnimationFrame(() => start(true));
    return () => cancelAnimationFrame(id);
  }, [start]);

  const load = useCallback(
    (ids: string[]) => (loadRecords ? loadRecords(ids) : fetchRecords(deck, ids)),
    [deck, loadRecords],
  );

  // The photo on screen and the one dealt after it, so the next call opens without waiting.
  const wanted = useMemo(() => {
    if (state.phase !== "picking" && state.phase !== "answered") return [];
    return state.order.slice(state.index, state.index + 2).map((s) => s.id);
  }, [state]);
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

  const playing = state.phase === "picking" || state.phase === "answered" ? state : null;
  const step = playing ? playing.order[playing.index] : undefined;
  const record = step ? records.get(step.id) : undefined;
  const upcoming = playing ? records.get(playing.order[playing.index + 1]?.id ?? "") : undefined;

  // Warm the cache with the photo dealt next while the player reads the answer.
  useEffect(() => {
    if (upcoming) new Image().src = sources(upcoming.photo).src;
  }, [upcoming]);

  const answered = state.phase === "answered" ? state : null;
  const over = clueMixOver(state);
  const ready = state.phase === "picking" && record !== undefined;
  const answers = useMemo(() => (step ? clueAnswers(step.clue, maps) : []), [step, maps]);

  const choose = useCallback(
    (answer: string) => {
      if (state.phase !== "picking" || !record || !step) return;
      const truth = clueTruth(step.clue, step.id, maps);
      if (truth === null) return;
      const action = {
        type: "picked",
        answer,
        truth,
        atlas: atlasClueRead(step.clue, record.atlas),
      } as const;
      const after = clueMixReducer(state, action);
      if (after.phase === "answered" && day) {
        // Today's run is kept after every call, so a reload resumes it and never deals it again.
        const cleared = after.verdict.correct && after.index + 1 >= after.order.length;
        rememberClueDay(day, {
          streak: after.streak,
          atlasRight: after.atlasRight,
          atlasPlayed: after.atlasPlayed,
          ended: !after.verdict.correct ? "miss" : cleared ? "cleared" : null,
        });
      } else if (after.phase === "answered" && after.verdict.correct && !challenge) {
        // Keep the run as the best after every right call, so leaving mid-run keeps it. A
        // challenge's photos may have been seen before, so it is played for the friend only.
        setBest(rememberClueMix(after.streak));
      }
      dispatch(action);
    },
    [state, record, step, maps, day, challenge],
  );

  // ← and → call the road; 1 to 7 name a climate or a continent by its place in the row.
  useEffect(() => {
    if (!ready || !step) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e)) return;
      const answer =
        step.clue === "road"
          ? ROAD_KEYS[e.key]
          : /^[1-9]$/.test(e.key)
            ? answers[Number(e.key) - 1]
            : undefined;
      if (!answer) return;
      e.preventDefault();
      choose(answer);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, step, answers, choose]);

  const streak = state.phase === "idle" ? 0 : state.streak;

  if (dayDone && day) return <ClueDayResult day={day} entry={dayDone} now={now} />;

  if (state.phase === "cleared" && day && state.order.length > 0) {
    return (
      <ClueDayResult
        day={day}
        entry={{
          streak: state.streak,
          atlasRight: state.atlasRight,
          atlasPlayed: state.atlasPlayed,
          ended: "cleared",
        }}
        now={now}
      />
    );
  }

  if (state.phase === "cleared") {
    const none = state.order.length === 0;
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
        <p className="text-sm text-gold">Clue mix</p>
        <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
          {none ? "No photos to play yet" : "You read every clue"}
        </h1>
        <p className="mt-4 text-lg text-chalk-dim">
          {none
            ? "Clue mix needs photos with at least two answers to each clue to deal."
            : `${clues(state.streak)} in a row, as many as the game can deal evenly.`}
        </p>
        {!none && challenge && (
          <p className="mt-2 text-chalk">{clueChallengeLine(state.streak, challenge)}</p>
        )}
        <div className="mt-8 flex flex-wrap items-center gap-4">
          {!none && (
            <button
              type="button"
              onClick={() => start()}
              className="rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
            >
              Play again
            </button>
          )}
          {!none && (
            <ChallengeButton
              run={{
                order: state.order,
                index: state.index - 1,
                seed,
                streak: state.streak,
                miss: null,
              }}
              answering={challenge}
            />
          )}
          <Link href="/" className="text-chalk-dim underline underline-offset-2 hover:text-chalk">
            Back to the main game
          </Link>
        </div>
      </main>
    );
  }

  const clue = step?.clue ?? "road";

  return (
    <main
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-ocean-deep"
      data-phase={answered ? "revealed" : "picking"}
    >
      <h1 className="sr-only">{`Whereabout: Clue mix, streak ${streak}`}</h1>

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
              ? `Clue mix, today's run (${day}).`
              : challenge
                ? `A friend's challenge: ${clues(challenge.streak)} in a row to beat`
                : "Clue mix: a new clue each photo."}
          </p>
          <Link
            href={daily ? "/clue-mix" : "/clue-mix/daily"}
            className="mt-0.5 inline-block text-sm text-gold underline underline-offset-2 hover:brightness-110"
          >
            {daily ? "Free runs" : "Today's run"}
          </Link>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          <GamesMenu screen="clue-mix" streakHref="/streak" />
          <ControlsHelp screen="clue-mix" />
          <dl className="text-right">
            <dt className="text-sm text-chalk-dim">Streak</dt>
            <dd className="font-sign tabular text-3xl font-bold leading-none" aria-live="polite">
              {streak}
            </dd>
            {!daily && (
              <div className="mt-1 flex justify-end gap-1.5 text-sm text-chalk-dim">
                <dt>Best</dt>
                <dd className="tabular">{best}</dd>
              </div>
            )}
          </dl>
        </div>
      </header>

      <ol
        aria-label="Clues in turn"
        className="flex justify-center gap-1.5 px-2 pb-2 text-xs md:text-sm"
      >
        {CLUE_CYCLE.map((kind) => (
          <li
            key={kind}
            aria-current={kind === clue ? "step" : undefined}
            className={`rounded-full border px-2 py-0.5 ${kind === clue ? "border-gold bg-gold font-semibold text-ocean-deep" : "border-graticule text-chalk-dim"}`}
          >
            {CLUE_NAME[kind]}
          </li>
        ))}
      </ol>

      <CluePhoto
        record={record}
        clue={step?.clue}
        truth={answered ? answerName(answered.verdict.clue, answered.verdict.truth) : null}
        correct={answered?.verdict.correct ?? null}
      />

      {!answered && step && (
        <div className="px-2 pb-3 md:mx-auto md:w-full md:max-w-4xl md:pb-6">
          <p
            id="clue-question"
            data-testid="clue-question"
            className="pb-2 text-center font-sign text-xl font-bold leading-tight md:text-2xl"
          >
            {CLUE_QUESTION[step.clue]}
          </p>
          <div
            role="group"
            aria-labelledby="clue-question"
            className={`grid gap-2 md:gap-3 ${step.clue === "road" ? "grid-cols-2" : step.clue === "climate" ? "grid-cols-3 md:grid-cols-5" : "grid-cols-3 md:grid-cols-7"}`}
          >
            {answers.map((answer, i) => (
              <AnswerButton
                key={answer}
                clue={step.clue}
                answer={answer}
                shortcut={
                  step.clue === "road"
                    ? answer === "left"
                      ? "ArrowLeft"
                      : "ArrowRight"
                    : String(i + 1)
                }
                ready={ready}
                onPick={choose}
              />
            ))}
          </div>
        </div>
      )}

      {notice && state.phase === "picking" && streak === 0 && (
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
          <ClueCard
            key={answered.index}
            correct={answered.verdict.correct}
            truth={clueTruthLine(
              answered.verdict.clue,
              answered.verdict.truth,
              record.photo.country,
            )}
            place={record.photo.place}
            atlas={`${clueAtlasLine(answered.verdict.clue, answered.atlas)} Atlas this run: ${answered.atlasRight} of ${answered.atlasPlayed}.`}
            friendAnswer={challenge ? friendMissAnswer(answered.index, challenge) : null}
            beaten={
              challenge !== null &&
              answered.verdict.correct &&
              answered.streak === challenge.streak + 1
                ? challenge.streak
                : null
            }
            end={
              over && day
                ? `Today's run is over: ${clueRunWords({ ...answered, ended: "miss" })}.`
                : over
                  ? `Run over: ${clues(answered.streak)} in a row. ` +
                    (challenge
                      ? clueChallengeLine(answered.streak, challenge)
                      : answered.streak > bestBeforeRun
                        ? "That's your new best!"
                        : best > 0
                          ? `Your best is ${clues(best)}.`
                          : "")
                  : null
            }
            challengeRun={
              over && !day
                ? {
                    run: {
                      order: answered.order,
                      index: answered.index,
                      seed,
                      streak: answered.streak,
                      miss: answered.verdict.correct ? null : answered.verdict.picked,
                    },
                    answering: challenge,
                  }
                : null
            }
            share={
              over && day
                ? (href: string) =>
                    clueDailyShare(
                      day,
                      {
                        streak: answered.streak,
                        atlasRight: answered.atlasRight,
                        atlasPlayed: answered.atlasPlayed,
                        ended: "miss",
                      },
                      href,
                    )
                : null
            }
            nextClue={over ? null : CLUE_CYCLE[(answered.index + 1) % CLUE_CYCLE.length]}
            onNext={over ? () => start() : () => dispatch({ type: "next" })}
            nextLabel={over ? (challenge ? "Play a fresh run" : "Start a new run") : "Next photo"}
          />
        </div>
      )}
    </main>
  );
}

function AnswerButton({
  clue,
  answer,
  shortcut,
  ready,
  onPick,
}: {
  clue: ClueKind;
  answer: string;
  shortcut: string;
  ready: boolean;
  onPick: (answer: string) => void;
}) {
  const name = answerName(clue, answer);
  return (
    <button
      type="button"
      onClick={() => onPick(answer)}
      disabled={!ready}
      data-testid={`clue-${answer}`}
      aria-keyshortcuts={shortcut}
      aria-label={clue === "road" ? `${name}: they drive on the ${answer}` : undefined}
      className="flex min-h-12 min-w-0 items-center justify-center gap-2 rounded-2xl bg-gold px-1 py-2.5 text-center font-sign text-lg font-extrabold leading-tight text-ocean-deep transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60 md:py-3 md:text-xl"
    >
      {clue === "road" && answer === "left" && <span aria-hidden="true">←</span>}
      {name}
      {clue === "road" && answer === "right" && <span aria-hidden="true">→</span>}
    </button>
  );
}

function CluePhoto({
  record,
  clue,
  truth,
  correct,
}: {
  record: GameRecord | undefined;
  clue: ClueKind | undefined;
  truth: string | null;
  correct: boolean | null;
}) {
  const photo = record?.photo;
  const src = photo ? sources(photo) : null;
  const blur = photo ? placeholderUrl(photo.imageUrl) : null;
  const ring = correct === null ? "border-graticule" : correct ? "border-sonar" : "border-flare";
  return (
    <div className="relative min-h-0 flex-1 px-2 pb-2 md:px-6">
      <div
        className={`wb-night relative h-full w-full overflow-hidden rounded-2xl border-2 bg-graticule/40 ${ring}`}
        data-testid="clue-photo"
        data-photo={photo?.id}
        data-clue={clue}
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
        {truth && (
          <span className="absolute left-2 top-2 rounded-full bg-gold px-3 py-1 text-sm font-semibold text-ocean-deep">
            {truth}
          </span>
        )}
        {photo && (
          <a
            href={photo.credit.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className={`absolute right-2 top-1 max-w-[60%] truncate text-[11px] text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk ${truth ? "" : "hidden md:block"}`}
          >
            Photo: {photo.credit.author}, {photo.credit.license}
          </a>
        )}
      </div>
    </div>
  );
}

function ClueCard({
  correct,
  truth,
  place,
  atlas,
  friendAnswer,
  beaten,
  end,
  challengeRun,
  nextClue,
  onNext,
  nextLabel,
  share,
}: {
  correct: boolean;
  truth: string;
  place: string;
  atlas: string;
  /** On the step that ended a friend's challenge: the answer they gave, which was wrong. */
  friendAnswer: string | null;
  /** The friend's streak, on the call that just went past it. */
  beaten: number | null;
  end: string | null;
  /** A free run that has ended: the link it can send, answering the friend's when it was one. */
  challengeRun: { run: ClueRun; answering: ClueChallenge | null } | null;
  /** The clue the next photo asks, while the run goes on. */
  nextClue: ClueKind | null;
  onNext: () => void;
  nextLabel: string;
  /** Today's run's share line, once it is over: shown in place of the next button. */
  share: ((href: string) => string) | null;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section
      aria-labelledby="clue-verdict"
      className="pointer-events-auto w-full max-w-md rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-4 shadow-2xl md:p-5"
    >
      <h2
        id="clue-verdict"
        className={`font-sign text-3xl font-extrabold leading-tight ${correct ? "text-sonar" : "text-flare"}`}
      >
        {correct ? "Correct" : "Wrong"}
      </h2>
      <p className="mt-1 text-chalk">{truth}</p>
      <p className="text-sm text-chalk-dim">{place}</p>
      <p className="mt-2 text-sm text-chalk-dim">{atlas}</p>
      {friendAnswer && (
        <p className="mt-2 text-sm text-chalk">
          {`Your friend's run ended here: they said ${friendAnswer}.`}
        </p>
      )}
      {beaten !== null && (
        <p className="mt-2 font-semibold text-sonar">
          {`That beats your friend's ${beaten} in a row!`}
        </p>
      )}
      {end && <p className="mt-2 text-chalk">{end}</p>}
      {share ? (
        <ShareDay shareText={share} freeHref="/clue-mix" focus />
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            ref={nextRef}
            type="button"
            onClick={onNext}
            className="shrink-0 rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
          >
            {nextLabel}
          </button>
          {nextClue && <span className="text-sm text-chalk-dim">{`Next up: the ${nextClue}`}</span>}
          {challengeRun && (
            <ChallengeButton run={challengeRun.run} answering={challengeRun.answering} />
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Challenge a friend from a finished run (src/lib/game/clueChallenge.ts): a link to the same
 * steps in the same order, the run to beat and the answer that ended it. Answering a challenge,
 * it sends one back, with the head-to-head picture beside it.
 */
function ChallengeButton({ run, answering }: { run: ClueRun; answering: ClueChallenge | null }) {
  const [sent, setSent] = useState("");
  async function send() {
    const text = clueChallengeText(run, window.location.href, answering ?? undefined);
    setSent(CHALLENGE_NOTE[await sendShare(text, navigator)]);
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
            headToHead={clueHeadToHead(run, answering, window.location.href)}
            replyText={() => clueChallengeText(run, window.location.href, answering)}
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

/** Today's Clue mix once it has ended. */
function ClueDayResult({ day, entry, now }: { day: string; entry: ClueDay; now?: () => Date }) {
  const cleared = entry.ended === "cleared";
  return (
    <DailyRunResult
      game="Clue mix"
      day={day}
      headline={cleared ? "You read every clue" : clues(entry.streak) + " in a row"}
      summary={
        (cleared
          ? `${clues(entry.streak)} in a row, every clue today's run could deal.`
          : `That's today's run played: ${clueRunWords(entry)}.`) +
        (entry.atlasPlayed > 0
          ? ` Atlas got ${entry.atlasRight} of the ${clues(entry.atlasPlayed)} it called.`
          : "")
      }
      shareText={(href) => clueDailyShare(day, entry, href)}
      freeHref="/clue-mix"
      now={now}
    />
  );
}
