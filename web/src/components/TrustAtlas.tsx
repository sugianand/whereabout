"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { isShortcut } from "@/lib/controls";
import { countryName } from "@/lib/countries";
import { runToday } from "@/lib/game/dailyRuns";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import {
  TRUST_PHOTOS,
  atlasCallLine,
  atlasPick,
  dealTrust,
  initialTrust,
  loadBestTrust,
  percent,
  rememberTrust,
  trustEndLine,
  trustReducer,
  trustResult,
  trustTotals,
  truthRank,
  type TrustCall,
  type TrustResult,
} from "@/lib/game/trustAtlas";
import {
  dailyTrustOrder,
  loadTrustDay,
  rememberTrustDay,
  settleTrust,
  trustDailyShare,
} from "@/lib/game/trustDaily";
import {
  TRUST_CHALLENGE_PARAM,
  parseTrustChallenge,
  trustChallengeLine,
  trustChallengeScore,
  trustChallengeText,
  trustFriendLine,
  trustFriendResult,
  trustFriendResults,
  trustHeadToHead,
  type TrustChallenge,
} from "@/lib/game/trustChallenge";
import { placeholderUrl, sources } from "@/lib/photoSources";
import { sendShare, type ShareOutcome } from "@/lib/share";

import ControlsHelp from "./ControlsHelp";
import { DailyRunResult } from "./DailyRunShare";
import GamesMenu from "./GamesMenu";
import { HeadToHeadButton } from "./HeadToHeadButton";

type TrustAtlasProps = {
  deck: Deck;
  /** The photos Atlas named a country for (`bundledTrustIds`). */
  ids: readonly string[];
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that picks each game's seed. */
  random?: () => number;
  /**
   * Today's game (src/lib/game/trustDaily.ts): the day's ten photos, one try a day, picked back
   * up after a reload at the first photo not yet called.
   */
  daily?: boolean;
  /** For tests: the clock that picks today's game. */
  now?: () => Date;
};

const CALL_KEYS: Record<string, TrustCall> = { y: "trust", n: "doubt" };

/** Why a challenge link was set aside for a fresh game. */
export const TRUST_CHALLENGE_NOTICE = {
  malformed: "That challenge link was cut short, so here's a fresh game instead.",
  missing: "That challenge's photos aren't in the game any more, so here's a fresh game instead.",
} as const;

/** Take the challenge out of the address, so a reload deals a fresh game, not the old link. */
function dropChallengeParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(TRUST_CHALLENGE_PARAM)) return;
  url.searchParams.delete(TRUST_CHALLENGE_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

const CHALLENGE_NOTE: Record<ShareOutcome, string> = {
  shared: "Challenge sent.",
  copied: "Challenge link copied. Whoever opens it plays these ten photos, in the same order.",
  cancelled: "",
  failed: "Couldn't copy the link. Your browser blocked the clipboard.",
};

function ordinal(n: number): string {
  return n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
}

/**
 * Trust Atlas? (src/lib/game/trustAtlas.ts): a photo, the country Atlas named for it and how
 * sure it was; trust the answer (Y) or doubt it (N). The answer says where the photo really is,
 * where that country sat on Atlas's shortlist, and what Atlas's own sureness made of the answer.
 * Ten photos, the best kept in this browser.
 */
export default function TrustAtlas({
  deck,
  ids,
  loadRecords,
  random,
  daily = false,
  now,
}: TrustAtlasProps) {
  const [state, dispatch] = useReducer(trustReducer, initialTrust);
  const [best, setBest] = useState(0);
  const [bestBeforeGame, setBestBeforeGame] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  // The day today's game was dealt for, kept when the clock passes midnight mid-game.
  const [day, setDay] = useState<string | null>(null);
  // A friend's challenge this game answers (src/lib/game/trustChallenge.ts): their ten photos and
  // the call they made on each, shown once you have made yours.
  const [challenge, setChallenge] = useState<TrustChallenge | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Deal a game; `fromLink` takes up a challenge the address carries, as the page opens. */
  const start = useCallback(
    (fromLink = false) => {
      if (daily) {
        const today = runToday(now?.());
        setDay(today);
        dispatch({
          type: "start",
          order: dailyTrustOrder(ids, today),
          from: loadTrustDay(today)?.results,
        });
        return;
      }
      const stored = loadBestTrust();
      setBest(stored);
      setBestBeforeGame(stored);
      const value = fromLink
        ? new URLSearchParams(window.location.search).get(TRUST_CHALLENGE_PARAM)
        : null;
      const linked = value === null ? null : parseTrustChallenge(value, ids);
      setNotice(linked && !linked.ok ? TRUST_CHALLENGE_NOTICE[linked.reason] : null);
      if (linked?.ok) {
        setChallenge(linked.challenge);
        dispatch({ type: "start", order: linked.challenge.ids });
        return;
      }
      setChallenge(null);
      dropChallengeParam();
      const seed = Math.floor((random ?? Math.random)() * 2 ** 32);
      dispatch({ type: "start", order: dealTrust(ids, seed) });
    },
    [daily, ids, now, random],
  );

  // The game is dealt in the browser after hydration, never at build time.
  useEffect(() => {
    const id = requestAnimationFrame(() => start(true));
    return () => cancelAnimationFrame(id);
  }, [start]);

  const load = useCallback(
    (wanted: string[]) => (loadRecords ? loadRecords(wanted) : fetchRecords(deck, wanted)),
    [deck, loadRecords],
  );

  const playing = state.phase === "calling" || state.phase === "answered" ? state : null;
  const index = playing ? playing.results.length - (playing.phase === "answered" ? 1 : 0) : 0;
  // The summary names every photo played, so it needs them all. A challenge needs every record
  // from the start, to judge the friend's calls and say the calls to beat.
  const over = state.phase === "done" ? state.results : null;
  const wanted = useMemo(
    () =>
      playing
        ? challenge
          ? [...playing.order]
          : playing.order.slice(index, index + 2)
        : over
          ? over.map((r) => r.id)
          : [],
    [playing, index, over, challenge],
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
  const pick = atlasPick(record?.atlas);

  // Warm the cache with the next photo while the player reads the answer.
  useEffect(() => {
    if (upcoming) new Image().src = sources(upcoming.photo).src;
  }, [upcoming]);

  const ready = state.phase === "calling" && record !== undefined && pick !== null;

  const call = useCallback(
    (which: TrustCall) => {
      if (!ready) return;
      const result = trustResult(record!, which);
      if (!result) return;
      const after = trustReducer(state, { type: "called", result });
      if (day) {
        // Kept after every photo, so a reload can't take a call back. Today's game is played
        // once for the day, apart from the free game's best.
        if (after.phase === "answered") rememberTrustDay(day, after.results);
      } else if (
        !challenge &&
        after.phase === "answered" &&
        after.results.length === after.order.length
      ) {
        // Only a whole game counts as a best, and never a challenge: its photos were picked by
        // the friend, not dealt.
        setBest(rememberTrust(trustTotals(after.results).correct));
      }
      dispatch({ type: "called", result });
    },
    [ready, record, state, day, challenge],
  );

  // Y trusts and N doubts, wherever focus is but a text field.
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e)) return;
      const which = CALL_KEYS[e.key.toLowerCase()];
      if (!which) return;
      e.preventDefault();
      call(which);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, call]);

  if (state.phase === "done" && day && state.results.length > 0) {
    return (
      <TrustDayResult
        day={day}
        results={settleTrust(state.results, records)}
        records={records}
        now={now}
      />
    );
  }

  if (state.phase === "done") {
    return (
      <TrustSummary
        results={state.results}
        records={records}
        best={best}
        newBest={!challenge && trustTotals(state.results).correct > bestBeforeGame}
        challenge={challenge}
        onAgain={() => start()}
      />
    );
  }

  const results = playing?.results ?? [];
  const totals = trustTotals(results);
  const answered = state.phase === "answered" ? results[results.length - 1] : null;
  const last = playing !== null && results.length === playing.order.length;
  const total = playing?.order.length ?? TRUST_PHOTOS;
  const toBeat = challenge ? trustChallengeScore(challenge, records) : null;
  const friendSoFar = challenge ? trustChallengeScore(challenge, records, results.length) : null;
  const friendHere = challenge && answered ? trustFriendResult(challenge, index, records) : null;

  return (
    <main
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-ocean-deep"
      data-phase={answered ? "revealed" : "calling"}
      data-photo={record?.photo.id}
    >
      <h1 className="sr-only">{`Whereabout: Trust Atlas?${daily ? ", today" : ""}, photo ${index + 1} of ${total}`}</h1>

      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-2 pt-4 md:px-6">
        <div className="min-w-0">
          <Link
            href="/"
            className="font-sign text-3xl font-extrabold leading-none tracking-tight md:text-4xl"
          >
            Whereabout
          </Link>
          <p className="mt-1 text-sm text-chalk-dim">
            {`Trust Atlas?${daily ? " Today:" : ""} Is its answer right?`}
          </p>
          <p className="text-sm text-chalk-dim" aria-live="polite">
            {`Photo ${index + 1} of ${total}`}
          </p>
          <Link
            href={daily ? "/trust-atlas" : "/trust-atlas/daily"}
            className="text-sm text-gold underline underline-offset-2 hover:brightness-110"
          >
            {daily ? "Free games" : "Today's game"}
          </Link>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          <GamesMenu screen="trust-atlas" streakHref="/streak" />
          <ControlsHelp screen="trust-atlas" />
          <dl className="text-right">
            <dt className="text-sm text-chalk-dim">Called right</dt>
            <dd className="font-sign tabular text-3xl font-bold leading-none">{totals.correct}</dd>
            {challenge && (
              <div className="mt-1 flex justify-end gap-1.5 text-sm text-chalk-dim">
                <dt>Friend</dt>
                <dd className="tabular text-flare" data-testid="trust-friend-score">
                  {friendSoFar ?? "…"}
                </dd>
              </div>
            )}
            {challenge && (
              <div className="flex justify-end gap-1.5 text-sm text-chalk-dim">
                <dt>
                  <span className="sr-only">A friend&apos;s challenge: calls right </span>To beat
                </dt>
                <dd className="tabular" data-testid="trust-challenge">
                  {toBeat ?? "…"}
                </dd>
              </div>
            )}
            {!daily && !challenge && (
              <div className="mt-1 flex justify-end gap-1.5 text-sm text-chalk-dim">
                <dt>Best</dt>
                <dd className="tabular">{best}</dd>
              </div>
            )}
          </dl>
        </div>
      </header>

      <AtlasSays pick={pick} />

      <TrustPhoto record={record} answered={answered} />

      {!answered && (
        <div className="grid grid-cols-2 gap-2 px-2 pb-3 md:mx-auto md:w-full md:max-w-xl md:gap-3 md:pb-6">
          <CallButton which="trust" ready={ready} onCall={call} />
          <CallButton which="doubt" ready={ready} onCall={call} />
        </div>
      )}

      {notice && !answered && results.length === 0 && (
        <p role="status" className="px-4 pb-3 text-center text-sm text-chalk-dim">
          {notice}
        </p>
      )}

      {error && (
        <p role="alert" className="absolute inset-x-4 bottom-4 text-center text-sm text-flare">
          {error}
        </p>
      )}

      {answered && record && pick && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-3 md:p-6">
          <TrustCard
            key={results.length}
            result={answered}
            record={record}
            p={pick.p}
            tally={[totals.correct, totals.atlasCorrect, results.length]}
            friend={friendHere}
            onNext={() => dispatch({ type: "next" })}
            nextLabel={last ? "See the results" : "Next photo"}
          />
        </div>
      )}
    </main>
  );
}

/** Atlas's answer and how sure it was, as words and a meter, so the number isn't colour alone. */
function AtlasSays({ pick }: { pick: { country: string; p: number } | null }) {
  return (
    <div
      className="px-4 pb-2 md:mx-auto md:w-full md:max-w-xl md:px-0"
      data-testid="trust-question"
    >
      <p className="text-chalk">
        {pick ? (
          <>
            Atlas says <strong className="font-semibold">{countryName(pick.country)}</strong>
            {`, ${percent(pick.p)} sure. Is it right?`}
          </>
        ) : (
          "Loading Atlas's answer"
        )}
      </p>
      <div
        role="meter"
        aria-label="How sure Atlas is"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pick ? Math.round(pick.p * 100) : 0}
        aria-valuetext={pick ? `${percent(pick.p)} sure` : "Not yet known"}
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-graticule/60"
      >
        <div
          className="h-full rounded-full bg-gold transition-[width]"
          style={{ width: `${pick ? Math.round(pick.p * 100) : 0}%` }}
        />
      </div>
    </div>
  );
}

function CallButton({
  which,
  ready,
  onCall,
}: {
  which: TrustCall;
  ready: boolean;
  onCall: (which: TrustCall) => void;
}) {
  const trust = which === "trust";
  return (
    <button
      type="button"
      onClick={() => onCall(which)}
      disabled={!ready}
      data-testid={`trust-${which}`}
      aria-label={trust ? "Trust it: Atlas is right" : "Doubt it: Atlas is wrong"}
      aria-keyshortcuts={trust ? "y" : "n"}
      className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-4 font-sign text-2xl font-extrabold transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60 ${trust ? "bg-gold text-ocean-deep" : "border-2 border-gold text-gold"}`}
    >
      {trust ? "Trust it" : "Doubt it"}
    </button>
  );
}

function TrustPhoto({
  record,
  answered,
}: {
  record: GameRecord | undefined;
  answered: TrustResult | null;
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
        data-testid="trust-photo"
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
            alt="The photo Atlas answered"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {answered && photo && (
          <span className="absolute left-2 top-2 rounded-full bg-gold px-3 py-1 text-sm font-semibold text-ocean-deep">
            {countryName(photo.country)}
          </span>
        )}
      </div>
    </div>
  );
}

function TrustCard({
  result,
  record,
  p,
  tally,
  friend,
  onNext,
  nextLabel,
}: {
  result: TrustResult;
  record: GameRecord;
  p: number;
  /** Your correct calls, Atlas's own correct calls, and photos called so far. */
  tally: readonly [number, number, number];
  /** On a friend's challenge: their call on this photo, judged on the same country. */
  friend: TrustResult | null;
  onNext: () => void;
  nextLabel: string;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);
  const { photo, atlas } = record;
  const truth = countryName(photo.country);
  const rank = truthRank(atlas, photo.country);
  const [yours, atlasOwn, n] = tally;
  const truthLine = result.atlasRight
    ? `Atlas was right: it is ${truth}.`
    : `Atlas was wrong: it is ${truth}. ` +
      (rank
        ? `${truth} was Atlas's ${ordinal(rank.rank)} pick, at ${percent(rank.p)}.`
        : `${truth} wasn't on Atlas's shortlist.`);
  return (
    <section
      aria-labelledby="trust-verdict"
      className="pointer-events-auto w-full max-w-md rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-4 shadow-2xl md:p-5"
    >
      <h2
        id="trust-verdict"
        className={`font-sign text-3xl font-extrabold leading-tight ${result.correct ? "text-sonar" : "text-flare"}`}
      >
        {result.correct ? "Called it" : "Missed it"}
      </h2>
      <p className="mt-1 text-chalk" data-testid="trust-truth">
        {truthLine}
      </p>
      <p className="text-sm text-chalk-dim">{photo.place}</p>
      {friend && (
        <p
          className={`mt-1 text-sm ${friend.correct ? "text-chalk" : "text-chalk-dim"}`}
          data-testid="trust-friend-line"
        >
          <span className="text-flare">Friend: </span>
          {trustFriendLine(result, friend)}
        </p>
      )}
      <p className="mt-2 text-sm text-chalk-dim" data-testid="trust-atlas">
        {`${atlasCallLine(result, p)} So far: you ${yours} of ${n}, Atlas's own calls ${atlasOwn} of ${n}.`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          ref={nextRef}
          type="button"
          onClick={onNext}
          className="rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          {nextLabel}
        </button>
        <a
          href={photo.credit.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 max-w-full truncate text-xs text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk"
        >
          Photo: {photo.credit.author}, {photo.credit.license}
        </a>
      </div>
    </section>
  );
}

/** Each photo called, by place, with Atlas's answer and your call. */
function CallList({
  results,
  records,
  friend,
}: {
  results: readonly TrustResult[];
  records: ReadonlyMap<string, GameRecord>;
  /** On a friend's challenge: their calls, judged, listed under yours. */
  friend?: readonly TrustResult[] | null;
}) {
  return (
    <ol className="mt-6 space-y-2" aria-label="Your calls">
      {results.map((r, i) => {
        const rec = records.get(r.id);
        const pick = atlasPick(rec?.atlas);
        return (
          <li
            key={r.id}
            className="rounded-xl border border-graticule/70 px-3 py-2 text-sm"
            data-testid="trust-row"
          >
            <span className="block text-chalk">{rec?.photo.place ?? `Photo ${i + 1}`}</span>
            <span className="block text-chalk-dim">
              {(pick
                ? `Atlas said ${countryName(pick.country)}, ${percent(pick.p)} sure, ${r.atlasRight ? "right" : "wrong"}. `
                : "") +
                `You ${r.call === "trust" ? "trusted" : "doubted"} it: ${r.correct ? "called it" : "missed it"}.`}
            </span>
            {friend?.[i] && (
              <span className="block text-chalk-dim">
                <span className="text-flare">Friend</span>
                {`: ${friend[i]!.call === "trust" ? "trusted" : "doubted"} it, ${friend[i]!.correct ? "called it" : "missed it"}.`}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Today's Trust Atlas? once its last photo is called, on this visit or an earlier one. */
function TrustDayResult({
  day,
  results,
  records,
  now,
}: {
  day: string;
  results: readonly TrustResult[];
  records: ReadonlyMap<string, GameRecord>;
  now?: () => Date;
}) {
  const { correct, atlasRight } = trustTotals(results);
  return (
    <DailyRunResult
      game="Trust Atlas?"
      day={day}
      unit="game"
      headline={`${correct} of ${results.length} called right`}
      summary={`Atlas was right on ${atlasRight} of ${results.length}. ${trustEndLine(results)}`}
      shareText={(href) => trustDailyShare(day, results, href)}
      freeHref="/trust-atlas"
      now={now}
    >
      <CallList results={results} records={records} />
    </DailyRunResult>
  );
}

function TrustSummary({
  results,
  records,
  best,
  newBest,
  challenge,
  onAgain,
}: {
  results: readonly TrustResult[];
  records: ReadonlyMap<string, GameRecord>;
  best: number;
  newBest: boolean;
  /** The friend's challenge this game answered, if it was one. */
  challenge: TrustChallenge | null;
  onAgain: () => void;
}) {
  const none = results.length === 0;
  const { correct, atlasRight } = trustTotals(results);
  // The friend's calls, judged once every photo's record is in.
  const theirs = challenge ? trustFriendResults(challenge, records) : null;
  const againRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    againRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-sm text-gold">Trust Atlas?</p>
      <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
        {none ? "No photos to play yet" : `${correct} of ${results.length} called right`}
      </h1>
      {none ? (
        <p className="mt-4 text-lg text-chalk-dim">
          Trust Atlas? needs photos Atlas has named a country for.
        </p>
      ) : (
        <>
          <p className="mt-4 text-lg text-chalk" data-testid="trust-end">
            {`Atlas was right on ${atlasRight} of ${results.length}. ${trustEndLine(results)}`}
          </p>
          {challenge ? (
            <p className="mt-2 text-chalk" data-testid="trust-challenge-line">
              {theirs ? trustChallengeLine(results, theirs) : "Judging your friend's calls…"}
            </p>
          ) : (
            <p className="mt-1 text-chalk-dim">
              {newBest ? "That's your new best!" : `Your best is ${best} of ${TRUST_PHOTOS}.`}
            </p>
          )}
          <CallList results={results} records={records} friend={theirs} />
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
        {results.length === TRUST_PHOTOS && (!challenge || theirs) && (
          <ChallengeButton results={results} answering={challenge ? theirs : null} />
        )}
        <Link href="/" className="text-chalk-dim underline underline-offset-2 hover:text-chalk">
          Back to the main game
        </Link>
      </div>
    </main>
  );
}

/**
 * Challenge a friend from a whole free game (src/lib/game/trustChallenge.ts): a link to the same
 * ten photos with your call on each. Answering a challenge, it sends one back, with the
 * head-to-head picture beside it.
 */
function ChallengeButton({
  results,
  answering,
}: {
  results: readonly TrustResult[];
  /** The friend's calls, judged, when this game answered their challenge. */
  answering: readonly TrustResult[] | null;
}) {
  const [sent, setSent] = useState("");
  const text = () => trustChallengeText(results, window.location.href, answering ?? undefined);
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
            headToHead={trustHeadToHead(results, answering, window.location.href)}
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
