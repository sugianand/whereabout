"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent,
} from "react";

import { isShortcut } from "@/lib/controls";
import type { DrivingSide } from "@/lib/drivingSides";
import { runToday } from "@/lib/game/dailyRuns";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import {
  atlasLine,
  initialLeftRight,
  leftRightOrder,
  leftRightOver,
  leftRightReducer,
  loadBestLeftRight,
  rememberLeftRight,
  truthLine,
  type SideMap,
} from "@/lib/game/leftRight";
import {
  dailySideOrder,
  loadSideDay,
  rememberSideDay,
  sideDailyShare,
  type SideDay,
} from "@/lib/game/sideDaily";
import {
  SIDE_CHALLENGE_PARAM,
  friendMissCall,
  parseSideChallenge,
  sideChallengeLine,
  sideChallengeOrder,
  sideChallengeText,
  sideHeadToHead,
  type SideChallenge,
  type SideRun,
} from "@/lib/game/sideChallenge";
import { placeholderUrl, sources } from "@/lib/photoSources";
import { sendShare, type ShareOutcome } from "@/lib/share";
import { atlasDrivingSide } from "@/lib/trueClues";

import ControlsHelp from "./ControlsHelp";
import { DailyRunResult, ShareDay } from "./DailyRunShare";
import GamesMenu from "./GamesMenu";
import { HeadToHeadButton } from "./HeadToHeadButton";

type LeftRightProps = {
  deck: Deck;
  /** Each dealable photo's driving side (`bundledDrivingSides`). */
  sides: SideMap;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that picks each run's seed. */
  random?: () => number;
  /**
   * Today's run (src/lib/game/sideDaily.ts): dealt from the UTC date, one try a day, picked up
   * after a reload and shared as counts only. It never touches the free runs' best.
   */
  daily?: boolean;
  /** For tests: the clock that picks today's run. */
  now?: () => Date;
};

/** How far a drag has to travel, as a share of the photo's width, to count as a call. */
export const SWIPE_SHARE = 0.25;
/** ...but never more than this many pixels, so a wide desktop photo doesn't need a long drag. */
export const SWIPE_MAX_PX = 140;

const KEY_SIDE: Record<string, DrivingSide> = { ArrowLeft: "left", ArrowRight: "right" };

/** "1 photo", "4 photos". */
function photos(n: number): string {
  return `${n} photo${n === 1 ? "" : "s"}`;
}

/** Why a challenge link was set aside for a fresh run. */
export const SIDE_CHALLENGE_NOTICE = {
  malformed: "That challenge link was cut short, so here's a fresh run instead.",
  missing: "That challenge's photos aren't in the game any more, so here's a fresh run instead.",
} as const;

/** Take the challenge out of the address, so a reload deals a fresh run, not the old link. */
function dropChallengeParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(SIDE_CHALLENGE_PARAM)) return;
  url.searchParams.delete(SIDE_CHALLENGE_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

const CHALLENGE_NOTE: Record<ShareOutcome, string> = {
  shared: "Challenge sent.",
  copied: "Challenge link copied. Whoever opens it plays these photos, in the same order.",
  cancelled: "",
  failed: "Couldn't copy the link. Your browser blocked the clipboard.",
};

/**
 * Left or right? (src/lib/game/leftRight.ts): one photo, and the player calls which side of the
 * road they drive on where it was taken, by swiping the photo, tapping a side or pressing an
 * arrow key. The first wrong call ends the run.
 */
export default function LeftRight({
  deck,
  sides,
  loadRecords,
  random,
  daily = false,
  now,
}: LeftRightProps) {
  const [state, dispatch] = useReducer(leftRightReducer, initialLeftRight);
  const [best, setBest] = useState(0);
  const [bestBeforeRun, setBestBeforeRun] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  // Today's run: the day it was dealt for (kept when the clock passes midnight mid-run) and,
  // once it has ended, how it went, which shows instead of the game.
  const [day, setDay] = useState<string | null>(null);
  const [dayDone, setDayDone] = useState<SideDay | null>(null);
  // A free run's seed, for the challenge link its end can send.
  const [seed, setSeed] = useState(0);
  // A friend's challenge this run answers: their photos, and the run to beat.
  const [challenge, setChallenge] = useState<SideChallenge | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Deal a run; `fromLink` takes up a challenge the address carries, as the page opens. */
  const start = useCallback(
    (fromLink = false) => {
      if (daily) {
        const today = runToday(now?.());
        const kept = loadSideDay(today);
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
          order: dailySideOrder(sides, today),
          from: { streak, atlasRight, atlasPlayed },
        });
        return;
      }
      const stored = loadBestLeftRight();
      setBest(stored);
      setBestBeforeRun(stored);
      const value = fromLink
        ? new URLSearchParams(window.location.search).get(SIDE_CHALLENGE_PARAM)
        : null;
      const linked = value === null ? null : parseSideChallenge(value, sides);
      setNotice(linked && !linked.ok ? SIDE_CHALLENGE_NOTICE[linked.reason] : null);
      if (linked?.ok) {
        setChallenge(linked.challenge);
        setSeed(linked.challenge.seed);
        dispatch({ type: "start", order: sideChallengeOrder(linked.challenge, sides) });
        return;
      }
      setChallenge(null);
      dropChallengeParam();
      const fresh = Math.floor((random ?? Math.random)() * 2 ** 32);
      setSeed(fresh);
      dispatch({ type: "start", order: leftRightOrder(sides, fresh) });
    },
    [sides, random, daily, now],
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
    return state.order.slice(state.index, state.index + 2);
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
  const record = playing ? records.get(playing.order[playing.index]) : undefined;
  const upcoming = playing ? records.get(playing.order[playing.index + 1] ?? "") : undefined;

  // Warm the cache with the photo dealt next while the player reads the answer.
  useEffect(() => {
    if (upcoming) new Image().src = sources(upcoming.photo).src;
  }, [upcoming]);

  const answered = state.phase === "answered" ? state : null;
  const over = leftRightOver(state);
  const ready = state.phase === "picking" && record !== undefined;

  const choose = useCallback(
    (side: DrivingSide) => {
      if (state.phase !== "picking" || !record) return;
      const truth = sides[record.photo.id] ?? record.photo.drivingSide;
      if (!truth) return;
      const action = {
        type: "picked",
        side,
        truth,
        atlas: atlasDrivingSide(record.atlas),
      } as const;
      const after = leftRightReducer(state, action);
      if (after.phase === "answered" && day) {
        // Today's run is kept after every call, so a reload resumes it and never deals it again.
        const cleared = after.verdict.correct && after.index + 1 >= after.order.length;
        rememberSideDay(day, {
          streak: after.streak,
          atlasRight: after.atlasRight,
          atlasPlayed: after.atlasPlayed,
          ended: !after.verdict.correct ? "miss" : cleared ? "cleared" : null,
        });
      } else if (after.phase === "answered" && after.verdict.correct && !challenge) {
        // Keep the run as the best after every right call, so leaving mid-run keeps it. A
        // challenge's photos may have been seen before, so it is played for the friend only.
        setBest(rememberLeftRight(after.streak));
      }
      dispatch(action);
    },
    [state, record, sides, day, challenge],
  );

  // ← and → make the call from the keyboard.
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      const side = KEY_SIDE[e.key];
      if (!side || !isShortcut(e)) return;
      e.preventDefault();
      choose(side);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, choose]);

  const streak = state.phase === "idle" ? 0 : state.streak;

  if (dayDone && day) return <SideDayResult day={day} entry={dayDone} now={now} />;

  if (state.phase === "cleared" && day && state.order.length > 0) {
    return (
      <SideDayResult
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
        <p className="text-sm text-gold">Left or right?</p>
        <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
          {none ? "No photos to play yet" : "You called every photo"}
        </h1>
        <p className="mt-4 text-lg text-chalk-dim">
          {none
            ? "Left or right? needs photos from both sides of the road to deal."
            : `${photos(state.streak)} in a row, as many as the game can deal evenly.`}
        </p>
        {!none && challenge && (
          <p className="mt-2 text-chalk">{sideChallengeLine(state.streak, challenge)}</p>
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
              run={{ order: state.order, index: state.index - 1, seed, streak: state.streak }}
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

  return (
    <main
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-ocean-deep"
      data-phase={answered ? "revealed" : "picking"}
    >
      <h1 className="sr-only">{`Whereabout: Left or right?, streak ${streak}`}</h1>

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
              ? `Left or right?, today's run (${day}): which side do they drive on here?`
              : challenge
                ? `A friend's challenge: ${photos(challenge.streak)} in a row to beat`
                : "Left or right? Which side of the road do they drive on here?"}
          </p>
          <Link
            href={daily ? "/left-right" : "/left-right/daily"}
            className="mt-0.5 inline-block text-sm text-gold underline underline-offset-2 hover:brightness-110"
          >
            {daily ? "Free runs" : "Today's run"}
          </Link>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          <GamesMenu screen="left-right" streakHref="/streak" />
          <ControlsHelp screen="left-right" />
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

      <SwipePhoto
        record={record}
        ready={ready}
        truth={answered?.verdict.truth ?? null}
        correct={answered?.verdict.correct ?? null}
        onPick={choose}
      />

      {!answered && (
        <div className="grid grid-cols-2 gap-2 px-2 pb-3 md:mx-auto md:w-full md:max-w-xl md:gap-3 md:pb-6">
          <SideButton side="left" ready={ready} onPick={choose} />
          <SideButton side="right" ready={ready} onPick={choose} />
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
          <SideCard
            key={answered.index}
            headline={answered.verdict.correct ? "Correct" : "Wrong"}
            correct={answered.verdict.correct}
            truth={truthLine(record.photo.country, answered.verdict.truth)}
            place={record.photo.place}
            atlas={answered.atlas ? atlasLine(answered.atlas) : null}
            atlasTally={[answered.atlasRight, answered.atlasPlayed]}
            friendCall={
              challenge ? friendMissCall(answered.index, challenge, answered.verdict.truth) : null
            }
            beaten={
              challenge !== null &&
              answered.verdict.correct &&
              answered.streak === challenge.streak + 1
                ? challenge.streak
                : null
            }
            end={
              over && day
                ? `Today's run is over: ${photos(answered.streak)} in a row.`
                : over
                  ? `Run over: ${photos(answered.streak)} in a row. ` +
                    (challenge
                      ? sideChallengeLine(answered.streak, challenge)
                      : answered.streak > bestBeforeRun
                        ? "That's your new best!"
                        : best > 0
                          ? `Your best is ${photos(best)}.`
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
                    },
                    answering: challenge,
                  }
                : null
            }
            share={
              over && day
                ? (href: string) =>
                    sideDailyShare(
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
            onNext={over ? () => start() : () => dispatch({ type: "next" })}
            nextLabel={over ? (challenge ? "Play a fresh run" : "Start a new run") : "Next photo"}
          />
        </div>
      )}
    </main>
  );
}

function SideButton({
  side,
  ready,
  onPick,
}: {
  side: DrivingSide;
  ready: boolean;
  onPick: (side: DrivingSide) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(side)}
      disabled={!ready}
      data-testid={`side-${side}`}
      aria-label={`${side === "left" ? "Left" : "Right"}: they drive on the ${side}`}
      aria-keyshortcuts={side === "left" ? "ArrowLeft" : "ArrowRight"}
      className="flex items-center justify-center gap-2 rounded-2xl bg-gold px-4 py-4 font-sign text-2xl font-extrabold text-ocean-deep transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
    >
      {side === "left" ? (
        <>
          <span aria-hidden="true">←</span> Left
        </>
      ) : (
        <>
          Right <span aria-hidden="true">→</span>
        </>
      )}
    </button>
  );
}

/**
 * The photo, which can be swiped: dragged past a quarter of its width (at most `SWIPE_MAX_PX`)
 * to one side, it makes that call; let go short of that, it springs back. Vertical drags are
 * left to the page, so a swipe never fights a scroll.
 */
function SwipePhoto({
  record,
  ready,
  truth,
  correct,
  onPick,
}: {
  record: GameRecord | undefined;
  ready: boolean;
  truth: DrivingSide | null;
  correct: boolean | null;
  onPick: (side: DrivingSide) => void;
}) {
  const [dx, setDx] = useState(0);
  // The photo's width as the drag began, which sets how far a swipe has to go.
  const [width, setWidth] = useState(400);
  const drag = useRef<{ x: number; id: number; width: number } | null>(null);
  const photo = record?.photo;
  const src = photo ? sources(photo) : null;
  const blur = photo ? placeholderUrl(photo.imageUrl) : null;

  const threshold = (width: number) => Math.min(SWIPE_MAX_PX, width * SWIPE_SHARE);
  const reset = () => {
    drag.current = null;
    setDx(0);
  };

  function onDown(e: PointerEvent<HTMLDivElement>) {
    if (!ready || drag.current) return;
    drag.current = { x: e.clientX, id: e.pointerId, width: e.currentTarget.clientWidth };
    setWidth(e.currentTarget.clientWidth || 400);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === e.pointerId) setDx(e.clientX - drag.current.x);
  }
  function onUp(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const moved = e.clientX - d.x;
    const need = threshold(d.width || 1);
    reset();
    if (moved <= -need) onPick("left");
    else if (moved >= need) onPick("right");
  }

  const need = threshold(width);
  const lean = Math.max(-1, Math.min(1, dx / need));
  const ring = correct === null ? "border-graticule" : correct ? "border-sonar" : "border-flare";

  return (
    <div className="relative min-h-0 flex-1 px-2 pb-2 md:px-6">
      <div
        className={`wb-night relative h-full w-full touch-pan-y select-none overflow-hidden rounded-2xl border-2 bg-graticule/40 ${ring} ${dx === 0 ? "transition-transform duration-200" : ""} ${ready ? "cursor-grab active:cursor-grabbing" : ""}`}
        data-testid="side-photo"
        data-photo={photo?.id}
        style={{
          transform: dx === 0 ? undefined : `translateX(${dx}px) rotate(${dx / 30}deg)`,
          ...(blur ? { backgroundImage: `url(${blur})`, backgroundSize: "cover" } : {}),
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={reset}
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
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
          />
        )}
        {ready && (
          <>
            <span
              aria-hidden="true"
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-gold px-4 py-2 font-sign text-2xl font-extrabold text-ocean-deep"
              style={{ opacity: Math.max(0, -lean) }}
            >
              ← Left
            </span>
            <span
              aria-hidden="true"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-gold px-4 py-2 font-sign text-2xl font-extrabold text-ocean-deep"
              style={{ opacity: Math.max(0, lean) }}
            >
              Right →
            </span>
          </>
        )}
        {truth && (
          <span className="absolute left-2 top-2 rounded-full bg-gold px-3 py-1 text-sm font-semibold text-ocean-deep">
            {`Drives on the ${truth}`}
          </span>
        )}
        {photo && (
          <a
            href={photo.credit.sourceUrl}
            target="_blank"
            rel="noreferrer"
            onPointerDown={(e) => e.stopPropagation()}
            className={`absolute bottom-1 right-2 max-w-[60%] truncate text-[11px] text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk ${truth ? "" : "hidden md:block"}`}
          >
            Photo: {photo.credit.author}, {photo.credit.license}
          </a>
        )}
      </div>
    </div>
  );
}

function SideCard({
  headline,
  correct,
  truth,
  place,
  atlas,
  atlasTally,
  friendCall,
  beaten,
  end,
  challengeRun,
  onNext,
  nextLabel,
  share,
}: {
  headline: string;
  correct: boolean;
  truth: string;
  place: string;
  atlas: string | null;
  atlasTally: readonly [number, number];
  /** On the photo that ended a friend's challenge: the side they called, which was wrong. */
  friendCall: DrivingSide | null;
  /** The friend's streak, on the call that just went past it. */
  beaten: number | null;
  end: string | null;
  /** A free run that has ended: the link it can send, answering the friend's when it was one. */
  challengeRun: { run: SideRun; answering: SideChallenge | null } | null;
  onNext: () => void;
  nextLabel: string;
  /** Today's run's share line, once it is over: shown in place of the next button. */
  share: ((href: string) => string) | null;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);
  const [atlasRight, atlasPlayed] = atlasTally;
  return (
    <section
      aria-labelledby="side-verdict"
      className="pointer-events-auto w-full max-w-md rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-4 shadow-2xl md:p-5"
    >
      <h2
        id="side-verdict"
        className={`font-sign text-3xl font-extrabold leading-tight ${correct ? "text-sonar" : "text-flare"}`}
      >
        {headline}
      </h2>
      <p className="mt-1 text-chalk">{truth}</p>
      <p className="text-sm text-chalk-dim">{place}</p>
      {atlas && (
        <p className="mt-2 text-sm text-chalk-dim">
          {`${atlas} Atlas this run: ${atlasRight} of ${photos(atlasPlayed)}.`}
        </p>
      )}
      {friendCall && (
        <p className="mt-2 text-sm text-chalk">
          {`Your friend's run ended here: they called ${friendCall}.`}
        </p>
      )}
      {beaten !== null && (
        <p className="mt-2 font-semibold text-sonar">
          {`That beats your friend's ${beaten} in a row!`}
        </p>
      )}
      {end && <p className="mt-2 text-chalk">{end}</p>}
      {share ? (
        <ShareDay shareText={share} freeHref="/left-right" focus />
      ) : (
        <div className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-2">
          <button
            ref={nextRef}
            type="button"
            onClick={onNext}
            className="shrink-0 rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
          >
            {nextLabel}
          </button>
          {challengeRun && (
            <ChallengeButton run={challengeRun.run} answering={challengeRun.answering} />
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Challenge a friend from a finished run (src/lib/game/sideChallenge.ts): a link to the same
 * photos in the same order, and the run to beat. Answering a challenge, it sends one back, with
 * the head-to-head picture beside it.
 */
function ChallengeButton({ run, answering }: { run: SideRun; answering: SideChallenge | null }) {
  const [sent, setSent] = useState("");
  async function send() {
    const text = sideChallengeText(run, window.location.href, answering ?? undefined);
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
            headToHead={sideHeadToHead(run, answering, window.location.href)}
            replyText={() => sideChallengeText(run, window.location.href, answering)}
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

/** Today's Left or right? once it has ended. */
function SideDayResult({ day, entry, now }: { day: string; entry: SideDay; now?: () => Date }) {
  const cleared = entry.ended === "cleared";
  return (
    <DailyRunResult
      game="Left or right?"
      day={day}
      headline={cleared ? "You called every photo" : `${photos(entry.streak)} in a row`}
      summary={
        (cleared
          ? `${photos(entry.streak)} in a row, every photo today's run could deal.`
          : "That's today's run played.") +
        (entry.atlasPlayed > 0
          ? ` Atlas got ${entry.atlasRight} of the ${photos(entry.atlasPlayed)} it called.`
          : "")
      }
      shareText={(href) => sideDailyShare(day, entry, href)}
      freeHref="/left-right"
      now={now}
    />
  );
}
