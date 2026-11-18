"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { isShortcut } from "@/lib/controls";
import { runToday } from "@/lib/game/dailyRuns";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import {
  GROUND_CHALLENGE_PARAM,
  groundChallengeLine,
  groundChallengeScore,
  groundChallengeText,
  groundFriendCall,
  groundFriendRight,
  groundHeadToHead,
  parseGroundChallenge,
  type GroundChallenge,
} from "@/lib/game/groundChallenge";
import {
  dailyGroundOrder,
  groundDailyShare,
  loadGroundDay,
  rememberGroundDay,
} from "@/lib/game/groundDaily";
import {
  GROUND_GIST,
  GROUND_NAME,
  GROUND_PHOTOS,
  dealGround,
  groundAtlasLine,
  groundReducer,
  groundTotals,
  groundTruthLine,
  groundVerdict,
  initialGround,
  loadBestGround,
  rememberGround,
  type GroundMap,
  type GroundResult,
} from "@/lib/game/onTheGround";
import { recordFreeRound } from "@/lib/game/quickRecord";
import { placeholderUrl, sources } from "@/lib/photoSources";
import { sendShare, type ShareOutcome } from "@/lib/share";
import { GROUND_COVERS, atlasGroundCover, type GroundCover } from "@/lib/trueClues";

import ControlsHelp from "./ControlsHelp";
import { DailyRunResult } from "./DailyRunShare";
import GamesMenu from "./GamesMenu";
import { HeadToHeadButton } from "./HeadToHeadButton";

type OnTheGroundProps = {
  deck: Deck;
  /** Each dealable photo's land cover (`bundledGroundCovers`). */
  covers: GroundMap;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that picks each game's seed. */
  random?: () => number;
  /**
   * Today's game (src/lib/game/groundDaily.ts): dealt from the UTC date, one try a day, picked
   * up after a reload and shared as a score only. It never touches the free games' best.
   */
  daily?: boolean;
  /** For tests: the clock that picks today's game. */
  now?: () => Date;
};

/** 1 to 5 name the covers in the order the buttons show them. */
const KEY_COVER: Record<string, GroundCover> = Object.fromEntries(
  GROUND_COVERS.map((cover, i) => [String(i + 1), cover]),
);

/** Why a challenge link was set aside for a fresh game. */
export const GROUND_CHALLENGE_NOTICE = {
  malformed: "That challenge link was cut short, so here's a fresh game instead.",
  missing: "That challenge's photos aren't in the game any more, so here's a fresh game instead.",
} as const;

/** Take the challenge out of the address, so a reload deals a fresh game, not the old link. */
function dropChallengeParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(GROUND_CHALLENGE_PARAM)) return;
  url.searchParams.delete(GROUND_CHALLENGE_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

const CHALLENGE_NOTE: Record<ShareOutcome, string> = {
  shared: "Challenge sent.",
  copied: "Challenge link copied. Whoever opens it plays these five photos, in the same order.",
  cancelled: "",
  failed: "Couldn't copy the link. Your browser blocked the clipboard.",
};

/**
 * What's on the ground? (src/lib/game/onTheGround.ts): one photo and five land covers. Name what
 * covers the ground around the spot by tapping a cover or pressing 1 to 5; the answer lights the
 * spot's own cover on a band of all five, with your call and Atlas's on it. Five photos a game.
 */
export default function OnTheGround({
  deck,
  covers,
  loadRecords,
  random,
  daily = false,
  now,
}: OnTheGroundProps) {
  const [state, dispatch] = useReducer(groundReducer, initialGround);
  const [best, setBest] = useState(0);
  const [bestBeforeGame, setBestBeforeGame] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  // Today's game: the day it was dealt for, kept when the clock passes midnight mid-game.
  const [day, setDay] = useState<string | null>(null);
  // A friend's challenge this game answers (src/lib/game/groundChallenge.ts): their five photos
  // and their call on each, shown once you have made yours.
  const [challenge, setChallenge] = useState<GroundChallenge | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Deal a game; `fromLink` takes up a challenge the address carries, as the page opens. */
  const start = useCallback(
    (fromLink = false) => {
      if (daily) {
        const today = runToday(now?.());
        const kept = loadGroundDay(today)?.results ?? [];
        setDay(today);
        // The calls kept come first. With the same photos they are the day's deal anyway; a day
        // kept from an earlier deal (the catalog changed since) still reads back as it was played.
        const played = kept.map((r) => r.id);
        const order = [
          ...played,
          ...dailyGroundOrder(covers, today).filter((id) => !played.includes(id)),
        ].slice(0, Math.max(GROUND_PHOTOS, played.length));
        dispatch({ type: "start", order, from: kept });
        return;
      }
      const stored = loadBestGround();
      setBest(stored);
      setBestBeforeGame(stored);
      const seed = Math.floor((random ?? Math.random)() * 2 ** 32);
      const value = fromLink
        ? new URLSearchParams(window.location.search).get(GROUND_CHALLENGE_PARAM)
        : null;
      const linked = value === null ? null : parseGroundChallenge(value, covers);
      setNotice(linked && !linked.ok ? GROUND_CHALLENGE_NOTICE[linked.reason] : null);
      if (linked?.ok) {
        setChallenge(linked.challenge);
        dispatch({ type: "start", order: linked.challenge.ids });
        return;
      }
      setChallenge(null);
      dropChallengeParam();
      dispatch({ type: "start", order: dealGround(covers, seed) });
    },
    [covers, random, daily, now],
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
    (cover: GroundCover) => {
      if (state.phase !== "picking" || !record) return;
      const truth = covers[record.photo.id];
      if (!truth) return;
      const action = {
        type: "picked",
        cover,
        truth,
        atlas: atlasGroundCover(record.atlas),
      } as const;
      const after = groundReducer(state, action);
      if (after.phase === "answered" && day) {
        // Today's game is kept after every call, so a reload resumes it and never deals it again.
        rememberGroundDay(day, after.results);
      } else if (after.phase === "answered") {
        // Count the call in your clue reading on Your map as it is made, so leaving mid-game
        // still counts the photos called. Today's game is read back from its kept day instead.
        const call = after.results[after.results.length - 1];
        recordFreeRound("on-the-ground", {
          first: after.results.length === 1,
          correct: call.correct,
          atlas: call.atlas === null ? null : call.atlas === call.truth,
        });
        // Only a whole free game counts as a best, and never a friend's challenge: its photos
        // may have been seen before, so it is played for the friend only.
        if (after.results.length === after.order.length && !challenge) {
          setBest(rememberGround(groundTotals(after.results).right));
        }
      }
      dispatch(action);
    },
    [state, record, covers, day, challenge],
  );

  // 1 to 5 make the call from the keyboard.
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      const cover = KEY_COVER[e.key];
      if (!cover || !isShortcut(e)) return;
      e.preventDefault();
      choose(cover);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, choose]);

  if (state.phase === "done" && day && state.results.length > 0) {
    return <GroundDayResult day={day} results={state.results} records={records} now={now} />;
  }

  if (state.phase === "done") {
    return (
      <GroundSummary
        results={state.results}
        records={records}
        best={best}
        newBest={!challenge && groundTotals(state.results).right > bestBeforeGame}
        covers={covers}
        challenge={challenge}
        onAgain={() => start()}
      />
    );
  }

  const results = playing?.results ?? [];
  const totals = groundTotals(results);
  const answered = state.phase === "answered" ? results[results.length - 1] : null;
  const last = playing !== null && results.length === playing.order.length;

  return (
    <main
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-ocean-deep"
      data-phase={answered ? "revealed" : "picking"}
    >
      <h1 className="sr-only">{`Whereabout: What's on the ground?, photo ${index + 1} of ${GROUND_PHOTOS}`}</h1>

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
              ? `What's on the ground?, today's game (${day}).`
              : challenge
                ? `A friend's challenge: ${groundChallengeScore(challenge, covers)} of ${GROUND_PHOTOS} to beat.`
                : "What's on the ground? Name the cover."}
          </p>
          <Link
            href={daily ? "/on-the-ground" : "/on-the-ground/daily"}
            className="mt-0.5 inline-block text-sm text-gold underline underline-offset-2 hover:brightness-110"
          >
            {daily ? "Free games" : "Today's game"}
          </Link>
          <p className="text-sm text-chalk-dim" aria-live="polite">
            {`Photo ${Math.min(index + 1, GROUND_PHOTOS)} of ${GROUND_PHOTOS}`}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          <GamesMenu screen="on-the-ground" streakHref="/streak" />
          <ControlsHelp screen="on-the-ground" />
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

      <GroundPhoto record={record} answered={answered} />

      {!answered && (
        <div
          role="group"
          aria-label="Land covers"
          className="grid grid-cols-6 gap-2 px-2 pb-3 md:mx-auto md:w-full md:max-w-3xl md:grid-cols-5 md:gap-3 md:pb-6"
        >
          {GROUND_COVERS.map((cover, i) => (
            <button
              key={cover}
              type="button"
              onClick={() => choose(cover)}
              disabled={!ready}
              data-testid={`ground-${i + 1}`}
              data-cover={cover}
              aria-keyshortcuts={String(i + 1)}
              className={`${i < 3 ? "col-span-2" : "col-span-3"} flex min-w-0 flex-col items-center rounded-2xl bg-gold px-1 py-2.5 text-ocean-deep transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60 md:col-span-1 md:py-3`}
            >
              <span className="font-sign text-lg font-extrabold leading-tight md:text-xl">
                {GROUND_NAME[cover]}
              </span>{" "}
              {/* What the cover means: read out everywhere, shown where there's room. */}
              <span className="sr-only text-xs leading-tight md:not-sr-only md:block">
                {GROUND_GIST[cover]}
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
          <GroundCard
            key={results.length}
            result={answered}
            place={record.photo.place}
            atlasTally={[totals.atlasRight, results.length]}
            friend={
              challenge
                ? {
                    call: groundFriendCall(challenge, results.length - 1),
                    right: results.filter((_, i) => groundFriendRight(challenge, i, covers)).length,
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

function GroundPhoto({
  record,
  answered,
}: {
  record: GameRecord | undefined;
  answered: GroundResult | null;
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
        data-testid="ground-photo"
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

/** The covers' names on the band, free to break at a soft hyphen on a narrow phone. */
const BAND_WORD: Record<GroundCover, string> = {
  "Built-up": "Built-up",
  "Tree cover": "Trees",
  Grassland: "Grass­land",
  "Permanent water bodies": "Water",
  "Bare / sparse vegetation": "Bare ground",
};

/**
 * The five covers in a row, the spot's own lit, with the player's call and Atlas's marked under
 * theirs in words, so it reads without colour.
 */
export function GroundBand({
  result,
  friend = null,
}: {
  result: GroundResult;
  /** On a friend's challenge: the call they made on this photo. */
  friend?: GroundCover | null;
}) {
  return (
    <ol
      aria-label="The five land covers"
      className="mt-3 grid grid-cols-5 gap-1"
      data-testid="ground-band"
    >
      {GROUND_COVERS.map((cover) => {
        const here = cover === result.truth;
        const marks = [
          result.picked === cover ? "You" : null,
          result.atlas === cover ? "Atlas" : null,
          friend === cover ? "Friend" : null,
        ].filter((m): m is string => m !== null);
        return (
          <li
            key={cover}
            data-cover={cover}
            aria-current={here ? "location" : undefined}
            className="flex min-w-0 flex-col items-center"
          >
            <span
              className={`flex min-h-9 w-full items-center justify-center hyphens-manual break-words rounded-md px-0.5 py-1 text-center text-[11px] font-semibold leading-tight sm:text-xs ${here ? "bg-gold text-ocean-deep" : "border border-graticule text-chalk-dim"}`}
            >
              {BAND_WORD[cover]}
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

function GroundCard({
  result,
  place,
  atlasTally,
  friend,
  onNext,
  nextLabel,
}: {
  result: GroundResult;
  place: string;
  atlasTally: readonly [number, number];
  /** On a friend's challenge: their call on this photo and their score so far. */
  friend: { call: GroundCover | null; right: number } | null;
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
      aria-labelledby="ground-verdict"
      className="pointer-events-auto w-full max-w-md rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-4 shadow-2xl md:p-5"
    >
      <h2
        id="ground-verdict"
        className={`font-sign text-3xl font-extrabold leading-tight ${result.correct ? "text-sonar" : "text-flare"}`}
      >
        {result.correct ? "Correct" : "Wrong"}
      </h2>
      <p className="mt-1 text-chalk">{groundTruthLine(result.truth)}</p>
      <p className="text-sm text-chalk-dim">{`${place} · from the ESA WorldCover map`}</p>
      <GroundBand result={result} friend={friend?.call ?? null} />
      <p className="mt-2 text-sm text-chalk-dim">
        {`${groundAtlasLine(result.atlas, result.truth)} Atlas this game: ${atlasRight} of ${played}.`}
      </p>
      {friend?.call && (
        <p className="text-sm text-chalk-dim" data-testid="ground-friend">
          {`Your friend called it ${GROUND_NAME[friend.call].toLowerCase()}${friend.call === result.truth ? ", and got it." : ": wrong."} Your friend so far: ${friend.right} of ${played}.`}
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

function GroundSummary({
  results,
  records,
  best,
  newBest,
  covers,
  challenge,
  onAgain,
}: {
  results: readonly GroundResult[];
  records: ReadonlyMap<string, GameRecord>;
  best: number;
  newBest: boolean;
  covers: GroundMap;
  /** The friend's challenge this game answered, if it was one. */
  challenge: GroundChallenge | null;
  onAgain: () => void;
}) {
  const none = results.length === 0;
  const { right, atlasRight, atlasRead } = groundTotals(results);
  const againRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    againRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-sm text-gold">What&apos;s on the ground?</p>
      <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
        {none ? "No photos to play yet" : `${right} of ${results.length}`}
      </h1>
      {none ? (
        <p className="mt-4 text-lg text-chalk-dim">
          What&apos;s on the ground? needs photos of at least two land covers to deal a game.
        </p>
      ) : (
        <>
          <p className="mt-4 text-lg text-chalk">
            {`${groundVerdict(right, atlasRight)} Atlas's clues named the ground on ${atlasRead} of the ${results.length} photos.`}
          </p>
          {challenge ? (
            <p className="mt-1 text-chalk" data-testid="ground-challenge-line">
              {groundChallengeLine(right, challenge, covers)}
            </p>
          ) : (
            <p className="mt-1 text-chalk-dim">
              {newBest ? "That's your new best!" : `Your best is ${best} of ${GROUND_PHOTOS}.`}
            </p>
          )}
          <GroundRows results={results} records={records} friend={challenge} />
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
        {results.length === GROUND_PHOTOS && (
          <ChallengeButton results={results} covers={covers} answering={challenge} />
        )}
        <Link href="/" className="text-chalk-dim underline underline-offset-2 hover:text-chalk">
          Back to the main game
        </Link>
      </div>
    </main>
  );
}

/** Each photo of a game as it was called: the place, its cover, your call and Atlas's. */
function GroundRows({
  results,
  records,
  friend = null,
}: {
  results: readonly GroundResult[];
  records: ReadonlyMap<string, GameRecord>;
  /** On a friend's challenge: their calls, listed beside yours. */
  friend?: GroundChallenge | null;
}) {
  return (
    <ol className="mt-6 space-y-2" aria-label="Your calls">
      {results.map((r, i) => (
        <li
          key={r.id}
          className="rounded-xl border border-graticule/70 px-3 py-2 text-sm"
          data-testid="ground-row"
        >
          <span className="block text-chalk">
            {records.get(r.id)?.photo.place ?? `Photo ${i + 1}`}
          </span>
          <span className="block text-chalk-dim">
            {`${GROUND_NAME[r.truth]}. You: ${GROUND_NAME[r.picked]} ${r.correct ? "✓" : "✗"}. Atlas: ${r.atlas === null ? "no read" : `${GROUND_NAME[r.atlas]} ${r.atlas === r.truth ? "✓" : "✗"}`}`}
            {friend?.calls[i] &&
              `. Friend: ${GROUND_NAME[friend.calls[i]]} ${friend.calls[i] === r.truth ? "✓" : "✗"}`}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Challenge a friend from a whole free game (src/lib/game/groundChallenge.ts): a link to the same
 * five photos with your call on each. Answering a challenge, it sends one back, with the
 * head-to-head picture beside it.
 */
function ChallengeButton({
  results,
  covers,
  answering,
}: {
  results: readonly GroundResult[];
  covers: GroundMap;
  answering: GroundChallenge | null;
}) {
  const [sent, setSent] = useState("");
  const text = () =>
    groundChallengeText(results, window.location.href, covers, answering ?? undefined);
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
            headToHead={groundHeadToHead(results, answering, covers, window.location.href)}
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

/** Today's What's on the ground? once every photo is called: the score, the share and each call. */
function GroundDayResult({
  day,
  results,
  records,
  now,
}: {
  day: string;
  results: readonly GroundResult[];
  records: ReadonlyMap<string, GameRecord>;
  now?: () => Date;
}) {
  const { right, atlasRight, atlasRead } = groundTotals(results);
  const atlas =
    atlasRead === results.length
      ? groundVerdict(right, atlasRight)
      : atlasRead > 0
        ? `Atlas got ${atlasRight} of the ${atlasRead} it read.`
        : "Atlas's clues named the ground on none of today's photos.";
  return (
    <DailyRunResult
      game="What's on the ground?"
      day={day}
      headline={`${right} of ${results.length}`}
      summary={`That's today's game played. ${atlas}`}
      shareText={(href) => groundDailyShare(day, results, href)}
      freeHref="/on-the-ground"
      now={now}
      unit="game"
    >
      <GroundRows results={results} records={records} />
    </DailyRunResult>
  );
}
