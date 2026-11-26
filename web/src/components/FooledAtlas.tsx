"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { isShortcut } from "@/lib/controls";
import { seededShuffle } from "@/lib/game/daily";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import {
  NEAR_KM,
  TIE_RATIO,
  atlasMissKm,
  atlasSureness,
  fooledOver,
  fooledReducer,
  initialFooled,
  loadBestFooled,
  rememberFooled,
  surenessWords,
  type FooledVerdict,
  type Side,
} from "@/lib/game/fooledAtlas";
import {
  FOOLED_CHALLENGE_PARAM,
  fooledChallengeLine,
  fooledChallengeOrder,
  fooledChallengeText,
  fooledHeadToHead,
  friendMissPick,
  isFooledFriendMiss,
  parseFooledChallenge,
  type FooledChallenge,
  type FooledRun,
} from "@/lib/game/fooledChallenge";
import {
  dailyFooledOrder,
  fooledDailyShare,
  fooledToday,
  loadFooledDay,
  rememberFooledDay,
  type FooledDay,
} from "@/lib/game/fooledDaily";
import { recordFooledRead } from "@/lib/game/fooledRead";
import { formatDistance } from "@/lib/geo";
import { placeholderUrl, sources } from "@/lib/photoSources";
import { sendShare, type ShareOutcome } from "@/lib/share";
import type { Units } from "@/lib/units";
import { useUnits } from "@/lib/useUnits";

import ControlsHelp from "./ControlsHelp";
import { DailyRunResult, ShareDay } from "./DailyRunShare";
import GamesMenu from "./GamesMenu";
import { HeadToHeadButton } from "./HeadToHeadButton";
import UnitsSwitch from "./UnitsSwitch";

type FooledAtlasProps = {
  deck: Deck;
  /** The photos the game can deal: those Atlas pinned (`bundledFooledIds`). */
  ids: readonly string[];
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that shuffles each run. */
  random?: () => number;
  /**
   * Today's run (src/lib/game/fooledDaily.ts): dealt from the UTC date, one try a day, picked
   * back up where it was left, with a share line at the end. Off, every run is a fresh shuffle.
   */
  daily?: boolean;
  /** For tests: the clock that picks today's run. */
  now?: () => Date;
};

const SIDES: readonly Side[] = ["a", "b"];
const number = (side: Side) => (side === "a" ? 1 : 2);

/** "1 pair", "4 pairs". */
function pairs(n: number): string {
  return `${n} pair${n === 1 ? "" : "s"}`;
}

const percent = (p: number) => `${Math.round(p * 100)}%`;

/** Why a challenge link was set aside for a fresh run. */
export const FOOLED_CHALLENGE_NOTICE = {
  malformed: "That challenge link was cut short, so here's a fresh run instead.",
  missing: "That challenge's photos aren't in the game any more, so here's a fresh run instead.",
} as const;

/** Take the challenge out of the address, so a reload deals a fresh run, not the old link. */
function dropChallengeParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(FOOLED_CHALLENGE_PARAM)) return;
  url.searchParams.delete(FOOLED_CHALLENGE_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

const CHALLENGE_NOTE: Record<ShareOutcome, string> = {
  shared: "Challenge sent.",
  copied: "Challenge link copied. Whoever opens it plays these pairs, in the same order.",
  cancelled: "",
  failed: "Couldn't copy the link. Your browser blocked the clipboard.",
};

/**
 * Which fooled Atlas? (src/lib/game/fooledAtlas.ts): two photos, pick the one Atlas placed
 * further from where it was taken. A right pick keeps the second photo and deals a new one beside
 * it; the first wrong pick ends the run.
 */
export default function FooledAtlas({
  deck,
  ids,
  loadRecords,
  random,
  daily = false,
  now,
}: FooledAtlasProps) {
  const [state, dispatch] = useReducer(fooledReducer, initialFooled);
  const [best, setBest] = useState(0);
  // The best before this run, so the end card can say when it was beaten.
  const [bestBeforeRun, setBestBeforeRun] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const units = useUnits();
  // Today's run: the day it was dealt for (kept when the clock passes midnight mid-run) and,
  // once it has ended, how it went, which shows instead of the game.
  const [day, setDay] = useState<string | null>(null);
  const [dayDone, setDayDone] = useState<FooledDay | null>(null);
  // A free run's seed, for the challenge link its end can send.
  const [seed, setSeed] = useState(0);
  // A friend's challenge this run answers: their photos, and the run to beat.
  const [challenge, setChallenge] = useState<FooledChallenge | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Deal a run; `fromLink` takes up a challenge the address carries, as the page opens. */
  const start = useCallback(
    (fromLink = false) => {
      if (daily) {
        const today = fooledToday(now?.());
        const kept = loadFooledDay(today);
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
          order: dailyFooledOrder(ids, today),
          from: { streak, atlasRight, atlasPlayed },
        });
        return;
      }
      const stored = loadBestFooled();
      setBest(stored);
      setBestBeforeRun(stored);
      const value = fromLink
        ? new URLSearchParams(window.location.search).get(FOOLED_CHALLENGE_PARAM)
        : null;
      const linked = value === null ? null : parseFooledChallenge(value, ids);
      setNotice(linked && !linked.ok ? FOOLED_CHALLENGE_NOTICE[linked.reason] : null);
      if (linked?.ok) {
        setChallenge(linked.challenge);
        setSeed(linked.challenge.seed);
        dispatch({ type: "start", order: fooledChallengeOrder(linked.challenge, ids) });
        return;
      }
      setChallenge(null);
      dropChallengeParam();
      const fresh = Math.floor((random ?? Math.random)() * 2 ** 32);
      setSeed(fresh);
      dispatch({ type: "start", order: seededShuffle(ids, fresh) });
    },
    [ids, random, daily, now],
  );

  // The order is shuffled in the browser after hydration, never at build time.
  useEffect(() => {
    const id = requestAnimationFrame(() => start(true));
    return () => cancelAnimationFrame(id);
  }, [start]);

  const load = useCallback(
    (wanted: string[]) => (loadRecords ? loadRecords(wanted) : fetchRecords(deck, wanted)),
    [deck, loadRecords],
  );

  // The pair on screen and the photo dealt after it, so the next pair opens without waiting.
  const wanted = useMemo(() => {
    if (state.phase !== "picking" && state.phase !== "answered") return [];
    return state.order.slice(state.index, state.index + 3);
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
  const recA = playing ? records.get(playing.order[playing.index]) : undefined;
  const recB = playing ? records.get(playing.order[playing.index + 1]) : undefined;
  const upcoming = playing ? records.get(playing.order[playing.index + 2] ?? "") : undefined;

  // Warm the cache with the photo dealt next while the player reads the answer.
  useEffect(() => {
    if (upcoming) new Image().src = sources(upcoming.photo).src;
  }, [upcoming]);

  const answered = state.phase === "answered" ? state : null;
  const over = fooledOver(state);
  const missA = recA ? atlasMissKm(recA) : null;
  const missB = recB ? atlasMissKm(recB) : null;
  const ready = state.phase === "picking" && missA !== null && missB !== null;

  const choose = useCallback(
    (side: Side) => {
      if (state.phase !== "picking" || !recA || !recB || missA === null || missB === null) return;
      const action = {
        type: "picked",
        side,
        missA,
        missB,
        sureA: atlasSureness(recA),
        sureB: atlasSureness(recB),
      } as const;
      const after = fooledReducer(state, action);
      // Every pick counts once toward What fools Atlas on Your map, whatever the run.
      if (after.phase === "answered") recordFooledRead(after.verdict, after.atlas, missA, missB);
      if (after.phase === "answered" && day) {
        // Today's run is kept after every pick, so a reload resumes it and never deals it again.
        // It is a day's result, apart from the free runs' best.
        const cleared = after.verdict.correct && after.index + 2 >= after.order.length;
        rememberFooledDay(day, {
          streak: after.streak,
          atlasRight: after.atlasRight,
          atlasPlayed: after.atlasPlayed,
          ended: !after.verdict.correct ? "miss" : cleared ? "cleared" : null,
        });
      } else if (after.phase === "answered" && after.verdict.correct && !challenge) {
        // Keep the streak as the best after every right pick, so leaving mid-run keeps it. A
        // challenge's photos may have been seen before, so it is played for the friend only.
        setBest(rememberFooled(after.streak));
      }
      dispatch(action);
    },
    [state, recA, recB, missA, missB, day, challenge],
  );

  // 1 and 2 pick a photo from the keyboard.
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e)) return;
      if (e.key === "1") choose("a");
      else if (e.key === "2") choose("b");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, choose]);

  const streak = state.phase === "idle" ? 0 : state.streak;
  // On the pair that ended the friend's run: they picked the photo Atlas missed by less.
  const friendMiss =
    challenge !== null && playing !== null && isFooledFriendMiss(playing.index, challenge);
  const runOf = (
    s: { order: readonly string[]; streak: number; atlasRight: number; atlasPlayed: number },
    index: number,
  ): FooledRun => ({
    order: s.order,
    index,
    seed,
    streak: s.streak,
    atlasRight: s.atlasRight,
    atlasPlayed: s.atlasPlayed,
  });

  if (dayDone && day) return <FooledDayResult day={day} entry={dayDone} now={now} />;

  if (state.phase === "cleared" && day && state.order.length >= 2) {
    const { streak: cleared, atlasRight, atlasPlayed } = state;
    return (
      <FooledDayResult
        day={day}
        entry={{ streak: cleared, atlasRight, atlasPlayed, ended: "cleared" }}
        now={now}
      />
    );
  }

  if (state.phase === "cleared") {
    const none = state.order.length < 2;
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
        <p className="text-sm text-gold">Which fooled Atlas?</p>
        <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
          {none ? "No photos to play yet" : "You called every pair"}
        </h1>
        <p className="mt-4 text-lg text-chalk-dim">
          {none
            ? "Which fooled Atlas? needs at least two photos Atlas has pinned."
            : `${pairs(state.streak)} in a row, every photo Atlas has pinned. Atlas's own pick got ${state.atlasRight} of ${pairs(state.atlasPlayed)}.`}
        </p>
        {!none && challenge && (
          <p className="mt-2 text-chalk">{fooledChallengeLine(state.streak, challenge)}</p>
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
          {!none && <ChallengeButton run={runOf(state, state.index - 1)} answering={challenge} />}
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
      <h1 className="sr-only">{`Whereabout: Which fooled Atlas?, streak ${streak}`}</h1>

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
              ? `Which fooled Atlas?, today's run (${day}): pick the photo Atlas placed further from home.`
              : challenge
                ? `A friend's challenge: ${pairs(challenge.streak)} in a row to beat`
                : "Which fooled Atlas? Pick the photo Atlas placed further from home."}
          </p>
          <Link
            href={daily ? "/fooled-atlas" : "/fooled-atlas/daily"}
            className="mt-0.5 inline-block text-sm text-gold underline underline-offset-2 hover:brightness-110"
          >
            {daily ? "Free runs" : "Today's run"}
          </Link>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          <GamesMenu screen="fooled-atlas" streakHref="/streak" />
          <ControlsHelp screen="fooled-atlas" />
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

      <div className="grid min-h-0 flex-1 grid-rows-2 gap-2 px-2 pb-2 md:grid-cols-2 md:grid-rows-1 md:gap-3 md:px-6 md:pb-6">
        {SIDES.map((side) => (
          <PhotoChoice
            key={side}
            side={side}
            record={side === "a" ? recA : recB}
            missKm={side === "a" ? missA : missB}
            units={units}
            ready={ready}
            verdict={answered?.verdict ?? null}
            friendPick={
              friendMiss && answered !== null && friendMissPick(answered.verdict.fooled) === side
            }
            onPick={choose}
          />
        ))}
      </div>

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

      {answered && recA && recB && missA !== null && missB !== null && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-3 md:p-6">
          <FooledCard
            key={answered.index}
            verdict={answered.verdict}
            atlas={answered.atlas}
            places={[recA.photo.place, recB.photo.place]}
            misses={[missA, missB]}
            sureness={[atlasSureness(recA), atlasSureness(recB)]}
            streak={answered.streak}
            atlasTally={[answered.atlasRight, answered.atlasPlayed]}
            units={units}
            over={over}
            best={best}
            newBest={over && answered.streak > bestBeforeRun}
            daily={day}
            run={runOf(answered, answered.index)}
            challenge={challenge}
            friendMiss={friendMiss}
            onNext={over ? () => start() : () => dispatch({ type: "next" })}
          />
        </div>
      )}
    </main>
  );
}

function PhotoChoice({
  side,
  record,
  missKm,
  units,
  ready,
  verdict,
  friendPick,
  onPick,
}: {
  side: Side;
  record: GameRecord | undefined;
  missKm: number | null;
  units: Units;
  ready: boolean;
  verdict: FooledVerdict | null;
  /** The friend whose challenge this is picked this photo, and it ended their run. */
  friendPick: boolean;
  onPick: (side: Side) => void;
}) {
  const n = number(side);
  const photo = record?.photo;
  const src = photo ? sources(photo) : null;
  const blur = photo ? placeholderUrl(photo.imageUrl) : null;
  const fooled = verdict !== null && verdict.fooled === side;
  const picked = verdict !== null && verdict.picked === side;
  const ring = !verdict
    ? "border-graticule hover:border-gold focus-visible:border-gold"
    : picked
      ? verdict.correct
        ? "border-sonar"
        : "border-flare"
      : "border-graticule";

  return (
    <div
      className={`wb-night relative min-h-0 overflow-hidden rounded-2xl border-2 bg-graticule/40 transition-colors ${ring}`}
      data-testid={`fooled-photo-${n}`}
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
          sizes="(min-width: 768px) 50vw, 100vw"
          alt={`Photo ${n}`}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <span className="absolute left-2 top-2 rounded-full bg-ocean-deep/85 px-2.5 py-0.5 font-sign text-lg font-extrabold">
        {n}
      </span>
      {verdict && photo && missKm !== null ? (
        <div className="absolute inset-x-2 top-2 ml-9 flex flex-wrap items-center justify-end gap-1.5 text-right">
          {friendPick && (
            <span className="rounded-full border border-flare bg-ocean-deep/85 px-2.5 py-0.5 text-sm font-semibold text-flare">
              Friend&apos;s pick
            </span>
          )}
          {fooled && (
            <span className="rounded-full bg-gold px-2.5 py-0.5 text-sm font-semibold text-ocean-deep">
              {verdict.tie ? "Fooled it by a hair" : "Fooled Atlas"}
            </span>
          )}
          <span className="max-w-full truncate rounded-full bg-ocean-deep/85 px-2.5 py-0.5 text-sm">
            {photo.place} · Atlas off by{" "}
            <span className="tabular">{formatDistance(missKm, units)}</span>
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onPick(side)}
          disabled={!ready}
          aria-keyshortcuts={String(n)}
          className="absolute inset-0 flex items-end justify-center p-3 outline-none disabled:cursor-wait"
        >
          <span className="rounded-full bg-gold px-5 py-2.5 font-semibold text-ocean-deep shadow-lg">
            {`Photo ${n} fooled Atlas`}
          </span>
        </button>
      )}
      {photo && (
        <a
          href={photo.credit.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className={`absolute bottom-1 right-2 max-w-[60%] truncate text-[11px] leading-6 text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk ${verdict ? "" : "hidden md:block"}`}
        >
          Photo: {photo.credit.author}, {photo.credit.license}
        </a>
      )}
    </div>
  );
}

/** Where each miss sits from a bullseye to the far side of the planet, on a log scale. */
function MissScale({ misses }: { misses: readonly [number, number] }) {
  const lo = Math.log10(1);
  const hi = Math.log10(20_000);
  const x = (km: number) =>
    ((Math.log10(Math.min(Math.max(km, 1), 20_000)) - lo) / (hi - lo)) * 100;
  return (
    <div className="mt-3" aria-hidden="true">
      <div className="relative h-7">
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-chalk/20" />
        {misses.map((km, i) => (
          <span
            key={i}
            data-testid={`miss-mark-${i + 1}`}
            className={`absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-sign text-sm font-extrabold text-ocean-deep ${i === 0 ? "bg-gold" : "bg-sonar"}`}
            style={{ left: `${x(km)}%` }}
          >
            {i + 1}
          </span>
        ))}
      </div>
      <div className="flex justify-between text-xs text-chalk-dim">
        <span>Spot on</span>
        <span>Next country</span>
        <span>Other side of the world</span>
      </div>
    </div>
  );
}

function FooledCard({
  verdict,
  atlas,
  places,
  misses,
  sureness,
  streak,
  atlasTally,
  units,
  over,
  best,
  newBest,
  daily,
  run,
  challenge,
  friendMiss,
  onNext,
}: {
  verdict: FooledVerdict;
  atlas: FooledVerdict | null;
  places: readonly [string, string];
  misses: readonly [number, number];
  sureness: readonly [number | null, number | null];
  streak: number;
  atlasTally: readonly [number, number];
  units: Units;
  over: boolean;
  best: number;
  newBest: boolean;
  /** Today's run's day, when this is it: its end shares the day instead of starting again. */
  daily: string | null;
  /** The run as it stands, for the challenge link its end can send. */
  run: FooledRun;
  /** The friend's challenge this run answers, if it is one. */
  challenge: FooledChallenge | null;
  /** True on the pair that ended the friend's run. */
  friendMiss: boolean;
  onNext: () => void;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);
  const far = verdict.fooled === "a" ? 0 : 1;
  const near = 1 - far;
  const [atlasRight, atlasPlayed] = atlasTally;
  const atlasSure = atlas ? sureness[atlas.picked === "a" ? 0 : 1] : null;

  return (
    <section
      aria-labelledby="fooled-verdict"
      className="pointer-events-auto w-full max-w-md rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-4 shadow-2xl md:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="fooled-verdict"
          className={`font-sign text-3xl font-extrabold leading-tight ${verdict.correct ? "text-sonar" : "text-flare"}`}
        >
          {verdict.tie ? "Too close to call" : verdict.correct ? "Right" : "Wrong"}
        </h2>
        <UnitsSwitch />
      </div>
      <p className="mt-1 text-chalk">
        {verdict.tie
          ? misses[far] < NEAR_KM
            ? `Atlas came within ${formatDistance(NEAR_KM, units)} of both, so either pick counts.`
            : `Atlas missed ${places[0]} by ${formatDistance(misses[0], units)} and ${places[1]} by ${formatDistance(misses[1], units)}, under ${TIE_RATIO} times apart, so either pick counts.`
          : `Atlas missed ${places[far]} by ${formatDistance(misses[far], units)}, but ${places[near]} by only ${formatDistance(misses[near], units)}.`}
      </p>
      <MissScale misses={misses} />
      {atlas && atlasSure !== null && (
        <p className="mt-2 text-sm text-chalk-dim">
          {`Atlas was less sure of photo ${number(atlas.picked)} (${surenessWords(atlasSure)}, ${percent(atlasSure)}), so it picked that one${atlas.correct ? " and got it" : ", wrong"}. `}
          {`Atlas this run: ${atlasRight} of ${pairs(atlasPlayed)}.`}
        </p>
      )}
      {friendMiss && (
        <p className="mt-2 text-sm text-chalk">
          {`Your friend's run ended here: they picked photo ${number(friendMissPick(verdict.fooled))}.`}
        </p>
      )}
      {challenge && verdict.correct && streak === challenge.streak + 1 && (
        <p className="mt-2 font-semibold text-sonar">
          {`That beats your friend's ${challenge.streak} in a row!`}
        </p>
      )}
      {over && daily && (
        <p className="mt-2 text-chalk">{`Today's run is over: ${pairs(streak)} in a row.`}</p>
      )}
      {over && !daily && (
        <p className="mt-2 text-chalk">
          {`Run over: ${pairs(streak)} in a row. `}
          {challenge
            ? fooledChallengeLine(streak, challenge)
            : newBest
              ? "That's your new best!"
              : best > 0
                ? `Your best is ${pairs(best)}.`
                : ""}
        </p>
      )}
      {over && daily ? (
        <ShareDay
          shareText={(href) =>
            fooledDailyShare(daily, { streak, atlasRight, atlasPlayed, ended: "miss" }, href)
          }
          freeHref="/fooled-atlas"
          focus
        />
      ) : (
        <div className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-2">
          <button
            ref={nextRef}
            type="button"
            onClick={onNext}
            className="shrink-0 rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
          >
            {over ? (challenge ? "Play a fresh run" : "Start a new run") : "Next pair"}
          </button>
          {over && <ChallengeButton run={run} answering={challenge} />}
        </div>
      )}
    </section>
  );
}

/**
 * Challenge a friend from a finished run (src/lib/game/fooledChallenge.ts): a link to the same
 * photos in the same order, and the run to beat. Answering a challenge, it sends one back.
 */
function ChallengeButton({
  run,
  answering,
}: {
  run: FooledRun;
  answering: FooledChallenge | null;
}) {
  const [sent, setSent] = useState("");
  async function send() {
    const text = fooledChallengeText(run, window.location.href, answering ?? undefined);
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
            headToHead={fooledHeadToHead(run, answering, window.location.href)}
            replyText={() => fooledChallengeText(run, window.location.href, answering)}
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

/** Today's Which fooled Atlas? once it has ended. */
function FooledDayResult({ day, entry, now }: { day: string; entry: FooledDay; now?: () => Date }) {
  const cleared = entry.ended === "cleared";
  return (
    <DailyRunResult
      game="Which fooled Atlas?"
      day={day}
      headline={cleared ? "You called every pair" : `${pairs(entry.streak)} in a row`}
      summary={
        (cleared
          ? `${pairs(entry.streak)} in a row, every photo Atlas has pinned.`
          : "That's today's run played.") +
        (entry.atlasPlayed > 0
          ? ` Atlas's own pick got ${entry.atlasRight} of the ${pairs(entry.atlasPlayed)} it played.`
          : "")
      }
      shareText={(href) => fooledDailyShare(day, entry, href)}
      freeHref="/fooled-atlas"
      now={now}
    />
  );
}
