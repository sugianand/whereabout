"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

import { isShortcut } from "@/lib/controls";
import { countryName } from "@/lib/countries";
import { runToday } from "@/lib/game/dailyRuns";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import {
  SPOT_MAX,
  SPOT_PHOTOS,
  cellName,
  dealSpot,
  hottestCells,
  hottestLine,
  initialSpot,
  loadBestSpot,
  middleCell,
  playableLooked,
  rememberSpot,
  spotReducer,
  spotResult,
  spotTotals,
  spotVerdict,
  stepCell,
  type SpotResult,
} from "@/lib/game/spotClue";
import {
  SPOT_CHALLENGE_PARAM,
  parseSpotChallenge,
  spotChallengeLine,
  spotChallengeScore,
  spotChallengeText,
  spotFriendResult,
  spotFriendResults,
  spotHeadToHead,
  type SpotChallenge,
} from "@/lib/game/spotChallenge";
import {
  dailySpotOrder,
  loadSpotDay,
  rememberSpotDay,
  settleSpot,
  spotDailyShare,
} from "@/lib/game/spotDaily";
import type { AtlasLooked } from "@/lib/game/types";
import { formatPoints } from "@/lib/geo";
import { sources } from "@/lib/photoSources";
import { sendShare, type ShareOutcome } from "@/lib/share";

import ControlsHelp from "./ControlsHelp";
import { DailyRunResult } from "./DailyRunShare";
import GamesMenu from "./GamesMenu";
import { HeadToHeadButton } from "./HeadToHeadButton";

type SpotClueProps = {
  deck: Deck;
  /** The photos with a playable "where Atlas looked" map (`bundledSpotIds`). */
  ids: readonly string[];
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that picks each game's seed. */
  random?: () => number;
  /**
   * Today's game (src/lib/game/spotDaily.ts): the day's five photos, one try a day, picked back
   * up after a reload at the first photo not yet answered.
   */
  daily?: boolean;
  /** For tests: the clock that picks today's game. */
  now?: () => Date;
};

const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
type Arrow = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/** Why a challenge link was set aside for a fresh game. */
export const SPOT_CHALLENGE_NOTICE = {
  malformed: "That challenge link was cut short, so here's a fresh game instead.",
  missing: "That challenge's photos aren't in the game any more, so here's a fresh game instead.",
} as const;

/** Take the challenge out of the address, so a reload deals a fresh game, not the old link. */
function dropChallengeParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(SPOT_CHALLENGE_PARAM)) return;
  url.searchParams.delete(SPOT_CHALLENGE_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

const CHALLENGE_NOTE: Record<ShareOutcome, string> = {
  shared: "Challenge sent.",
  copied: "Challenge link copied. Whoever opens it plays these five photos, in the same order.",
  cancelled: "",
  failed: "Couldn't copy the link. Your browser blocked the clipboard.",
};

/**
 * Spot the clue (src/lib/game/spotClue.ts): the square of the photo Atlas saw and the country it
 * picked; tap the part of the photo you think told it most, or move there with the arrow keys
 * and press G. The answer lays Atlas's real "where it looked" map over the photo, with your
 * square and its hottest marked, and scores your square by how much it mattered. Five photos.
 */
export default function SpotClue({
  deck,
  ids,
  loadRecords,
  random,
  daily = false,
  now,
}: SpotClueProps) {
  const [state, dispatch] = useReducer(spotReducer, initialSpot);
  const [best, setBest] = useState(0);
  const [bestBeforeGame, setBestBeforeGame] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  // The square picked so far on the photo in play; null until the record says how big the grid is.
  const [cursor, setCursor] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // The day today's game was dealt for, kept when the clock passes midnight mid-game.
  const [day, setDay] = useState<string | null>(null);
  // A friend's challenge this game answers (src/lib/game/spotChallenge.ts): their five photos and
  // the square they picked on each, shown on Atlas's map once you have locked in yours.
  const [challenge, setChallenge] = useState<SpotChallenge | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Deal a game; `fromLink` takes up a challenge the address carries, as the page opens. */
  const start = useCallback(
    (fromLink = false) => {
      setCursor(null);
      if (daily) {
        const today = runToday(now?.());
        setDay(today);
        dispatch({
          type: "start",
          order: dailySpotOrder(ids, today),
          from: loadSpotDay(today)?.results,
        });
        return;
      }
      const stored = loadBestSpot();
      setBest(stored);
      setBestBeforeGame(stored);
      const value = fromLink
        ? new URLSearchParams(window.location.search).get(SPOT_CHALLENGE_PARAM)
        : null;
      const linked = value === null ? null : parseSpotChallenge(value, ids);
      setNotice(linked && !linked.ok ? SPOT_CHALLENGE_NOTICE[linked.reason] : null);
      if (linked?.ok) {
        setChallenge(linked.challenge);
        dispatch({ type: "start", order: linked.challenge.ids });
        return;
      }
      setChallenge(null);
      dropChallengeParam();
      const seed = Math.floor((random ?? Math.random)() * 2 ** 32);
      dispatch({ type: "start", order: dealSpot(ids, seed) });
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

  const playing = state.phase === "picking" || state.phase === "answered" ? state : null;
  const index = playing ? playing.results.length - (playing.phase === "answered" ? 1 : 0) : 0;
  // The summary names every photo played, so it needs them all. A challenge needs every map from
  // the start, to score the friend's squares and say the points to beat.
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
  const looked = playableLooked(record?.atlas?.looked) ? record!.atlas!.looked! : null;

  // Warm the cache with the next photo while the player reads the answer.
  useEffect(() => {
    if (upcoming) new Image().src = sources(upcoming.photo).src;
  }, [upcoming]);

  const ready = state.phase === "picking" && record !== undefined && looked !== null;
  const square = ready ? (cursor ?? middleCell(looked.grid)) : null;

  const lockIn = useCallback(() => {
    if (!ready || square === null) return;
    const result = spotResult(record!.photo.id, looked, square);
    const after = spotReducer(state, { type: "picked", result });
    if (day) {
      // Kept after every photo, so a reload can't take a square back. Today's game is played
      // once for the day, apart from the free game's best.
      if (after.phase === "answered") rememberSpotDay(day, after.results);
    } else if (
      !challenge &&
      after.phase === "answered" &&
      after.results.length === after.order.length
    ) {
      // Only a whole game counts as a best, and never a challenge: its photos were picked by
      // someone who had seen them.
      setBest(rememberSpot(spotTotals(after.results).points));
    }
    dispatch({ type: "picked", result });
  }, [ready, square, record, looked, state, day, challenge]);

  const next = useCallback(() => {
    setCursor(null);
    dispatch({ type: "next" });
  }, []);

  // The arrow keys move the square and G locks it in, wherever focus is but a text field.
  useEffect(() => {
    if (!ready || !looked) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e)) return;
      if (ARROW_KEYS.has(e.key)) {
        e.preventDefault();
        setCursor((c) => stepCell(looked.grid, c ?? middleCell(looked.grid), e.key as Arrow));
      } else if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        lockIn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, looked, lockIn]);

  // With focus on the grid, focus follows the square the arrows moved to.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || square === null || !grid.contains(document.activeElement)) return;
    grid.querySelector<HTMLButtonElement>(`[data-cell="${square}"]`)?.focus();
  }, [square]);

  if (state.phase === "done" && day && state.results.length > 0) {
    return (
      <SpotDayResult
        day={day}
        results={settleSpot(state.results, records)}
        records={records}
        now={now}
      />
    );
  }

  if (state.phase === "done") {
    return (
      <SpotSummary
        results={state.results}
        records={records}
        best={best}
        newBest={!challenge && spotTotals(state.results).points > bestBeforeGame}
        challenge={challenge}
        onAgain={() => start()}
      />
    );
  }

  const results = playing?.results ?? [];
  const totals = spotTotals(results);
  const answered = state.phase === "answered" ? results[results.length - 1] : null;
  const last = playing !== null && results.length === playing.order.length;
  const atlas = record?.atlas ?? null;
  const pick = atlas?.topCountries[0]?.country ?? null;
  const toBeat = challenge ? spotChallengeScore(challenge, records) : null;
  const friendSoFar = challenge ? spotChallengeScore(challenge, records, results.length) : null;
  const friendHere = challenge && answered ? spotFriendResult(challenge, index, records) : null;

  return (
    <main
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-ocean-deep"
      data-phase={answered ? "revealed" : "picking"}
      data-photo={record?.photo.id}
    >
      <h1 className="sr-only">{`Whereabout: Spot the clue${daily ? ", today" : ""}, photo ${index + 1} of ${playing?.order.length ?? SPOT_PHOTOS}`}</h1>

      <header className="flex items-start justify-between gap-4 px-4 pb-2 pt-4 md:px-6">
        <div className="min-w-0">
          <Link
            href="/"
            className="font-sign text-3xl font-extrabold leading-none tracking-tight md:text-4xl"
          >
            Whereabout
          </Link>
          <p className="mt-1 text-sm text-chalk-dim">
            {`Spot the clue${daily ? ", today" : ""}: what told Atlas?`}
          </p>
          <p className="text-sm text-chalk-dim" aria-live="polite">
            {`Photo ${index + 1} of ${playing?.order.length ?? SPOT_PHOTOS}`}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <GamesMenu screen="spot-the-clue" streakHref="/streak" />
            <ControlsHelp screen="spot-the-clue" />
            <Link
              href={daily ? "/spot-the-clue" : "/spot-the-clue/daily"}
              className="whitespace-nowrap text-sm text-gold underline underline-offset-2 hover:brightness-110"
            >
              {daily ? "Free games" : "Today's game"}
            </Link>
          </div>
        </div>
        <div className="shrink-0">
          <dl className="text-right">
            <dt className="text-sm text-chalk-dim">Score</dt>
            <dd className="font-sign tabular text-3xl font-bold leading-none">
              {formatPoints(totals.points)}
            </dd>
            {challenge && (
              <div className="mt-1 flex justify-end gap-1.5 text-sm text-chalk-dim">
                <dt>Friend</dt>
                <dd className="tabular text-flare" data-testid="spot-friend-score">
                  {friendSoFar === null ? "…" : formatPoints(friendSoFar)}
                </dd>
              </div>
            )}
            {challenge && (
              // In the score column, so a challenge's header is no taller than a free game's.
              <div className="flex justify-end gap-1.5 text-sm text-chalk-dim">
                <dt>
                  <span className="sr-only">A friend&apos;s challenge: points </span>To beat
                </dt>
                <dd className="tabular" data-testid="spot-challenge">
                  {toBeat === null ? "…" : formatPoints(toBeat)}
                </dd>
              </div>
            )}
            {!daily && !challenge && (
              <div className="mt-1 flex justify-end gap-1.5 text-sm text-chalk-dim">
                <dt>Best</dt>
                <dd className="tabular">{formatPoints(best)}</dd>
              </div>
            )}
          </dl>
        </div>
      </header>

      <p className="px-4 pb-2 text-chalk md:px-6 md:text-center" data-testid="spot-question">
        {pick
          ? `Atlas said ${countryName(pick)}. Which square of the photo told it most?`
          : "Which square of the photo told Atlas most?"}
      </p>

      <SpotPhoto
        record={record}
        looked={looked}
        square={square}
        answered={answered}
        friend={friendHere}
        onPick={setCursor}
        gridRef={gridRef}
      />

      {!answered && (
        <div className="flex justify-center px-4 pb-4 pt-1 md:pb-6">
          <button
            type="button"
            onClick={lockIn}
            disabled={!ready}
            aria-keyshortcuts="g"
            className="rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
          >
            {ready && square !== null
              ? `Lock in ${cellName(looked.grid, square).toLowerCase()}`
              : "Loading the photo"}
          </button>
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

      {answered && record && looked && (
        <div className="flex justify-center px-3 pb-3 md:pb-6">
          <SpotCard
            key={results.length}
            result={answered}
            looked={looked}
            record={record}
            friend={friendHere}
            onNext={next}
            nextLabel={last ? "See the results" : "Next photo"}
          />
        </div>
      )}
    </main>
  );
}

/** The square Atlas saw, sized to fit the space left, with the grid to pick from or the map. */
function SpotPhoto({
  record,
  looked,
  square,
  answered,
  friend,
  onPick,
  gridRef,
}: {
  record: GameRecord | undefined;
  looked: AtlasLooked | null;
  square: number | null;
  answered: SpotResult | null;
  /** On a friend's challenge: the square they picked, marked once you have locked in yours. */
  friend: SpotResult | null;
  onPick: (cell: number) => void;
  gridRef: RefObject<HTMLDivElement | null>;
}) {
  const photo = record?.photo;
  const src = photo ? sources(photo) : null;
  const hottest = answered && looked ? hottestCells(looked) : [];
  const ring =
    answered === null
      ? "border-graticule"
      : answered.points >= 500
        ? "border-sonar"
        : "border-flare";
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-2 pb-2 [container-type:size]">
      <div
        className={`wb-night relative overflow-hidden rounded-2xl border-2 bg-graticule/40 ${ring}`}
        style={{ width: "min(100cqw, 100cqh)", height: "min(100cqw, 100cqh)" }}
        data-testid="spot-photo"
      >
        {src && looked && (
          // Wikimedia thumbnails, already sized; next/image can't optimise a static export.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={photo!.id}
            src={src.src}
            srcSet={src.srcSet}
            sizes="100vw"
            alt="The square of the photo Atlas saw"
            decoding="async"
            className={`absolute max-w-none transition ${answered ? "brightness-[0.55] saturate-50" : ""}`}
            style={{
              width: `${100 / looked.crop[2]}%`,
              height: `${100 / looked.crop[3]}%`,
              left: `${(-looked.crop[0] / looked.crop[2]) * 100}%`,
              top: `${(-looked.crop[1] / looked.crop[3]) * 100}%`,
            }}
          />
        )}
        {looked && answered && (
          <>
            <div
              aria-hidden="true"
              data-testid="spot-heat"
              className="absolute inset-0 grid mix-blend-screen blur-[6px]"
              style={gridStyle(looked.grid)}
            >
              {looked.cells.map((v, i) => (
                <div key={i} className="bg-sonar" style={{ opacity: Math.min(1, v * 0.9) }} />
              ))}
            </div>
            <div
              aria-hidden="true"
              className="absolute inset-0 grid"
              style={gridStyle(looked.grid)}
            >
              {looked.cells.map((_, i) => {
                const yours = i === answered.cell;
                const top = hottest.includes(i);
                return (
                  <div
                    key={i}
                    data-testid={yours ? "spot-yours" : top ? "spot-hottest" : undefined}
                    data-cell={i}
                    className={
                      yours
                        ? "z-10 border-[3px] border-gold"
                        : top
                          ? "border-2 border-dashed border-chalk"
                          : ""
                    }
                  />
                );
              })}
            </div>
            {friend && friend.cell < looked.cells.length && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 grid"
                style={gridStyle(looked.grid)}
              >
                <div
                  data-testid="spot-friend"
                  data-cell={friend.cell}
                  className="z-20 m-[5px] rounded-sm border-[3px] border-flare"
                  style={{
                    gridColumn: (friend.cell % looked.grid) + 1,
                    gridRow: Math.floor(friend.cell / looked.grid) + 1,
                  }}
                />
              </div>
            )}
          </>
        )}
        {looked && !answered && (
          <div
            ref={gridRef}
            role="group"
            aria-label={`The photo as a grid of ${looked.grid} rows by ${looked.grid} columns`}
            className="absolute inset-0 grid"
            style={gridStyle(looked.grid)}
          >
            {looked.cells.map((_, i) => {
              const picked = i === square;
              return (
                <button
                  key={i}
                  type="button"
                  data-cell={i}
                  tabIndex={picked ? 0 : -1}
                  aria-pressed={picked}
                  aria-label={cellName(looked.grid, i)}
                  onClick={() => onPick(i)}
                  className={`min-h-0 min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-chalk focus-visible:ring-inset ${picked ? "border-[3px] border-gold bg-gold/15" : "border border-chalk/10 hover:bg-chalk/10"}`}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function gridStyle(grid: number): CSSProperties {
  return {
    gridTemplateColumns: `repeat(${grid}, 1fr)`,
    gridTemplateRows: `repeat(${grid}, 1fr)`,
  };
}

function SpotCard({
  result,
  looked,
  record,
  friend,
  onNext,
  nextLabel,
}: {
  result: SpotResult;
  looked: AtlasLooked;
  record: GameRecord;
  /** On a friend's challenge: their square on this photo, scored against the same map. */
  friend: SpotResult | null;
  onNext: () => void;
  nextLabel: string;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);
  const { photo, atlas } = record;
  const pick = atlas?.topCountries[0]?.country ?? null;
  const sure = atlas ? Math.round(atlas.confidence * 100) : null;
  return (
    <section
      aria-labelledby="spot-verdict"
      className="w-full max-w-md rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-4 shadow-2xl md:p-5"
    >
      <h2
        id="spot-verdict"
        className={`font-sign text-2xl font-extrabold leading-tight md:text-3xl ${result.points >= 500 ? "text-sonar" : "text-flare"}`}
      >
        {`${spotVerdict(result)}: ${formatPoints(result.points)} points`}
      </h2>
      <p className="mt-1 text-chalk" data-testid="spot-line">
        {result.hottest
          ? "You picked the square that mattered most to Atlas (white dashes mark it)."
          : `Your square (gold) mattered ${Math.round((result.points / SPOT_MAX) * 100)}% as much to Atlas as its most telling one (white dashes).`}
      </p>
      {/* Said by the dashed square too, so a short phone drops it to keep the photo in view. */}
      <p className="text-sm text-chalk-dim [@media(max-height:600px)]:hidden">
        {hottestLine(looked)}
      </p>
      {friend && (
        <p className="mt-1 text-sm text-chalk" data-testid="spot-friend-line">
          <span className="text-flare">Friend</span>
          {friend.cell === result.cell
            ? `: the same square, ${formatPoints(friend.points)} points.`
            : friend.cell < looked.cells.length
              ? ` (red): ${cellName(looked.grid, friend.cell).toLowerCase()}, ${formatPoints(friend.points)} points.`
              : ": a square off the grid, 0 points."}
        </p>
      )}
      {pick && (
        <p className="mt-1 text-sm text-chalk-dim" data-testid="spot-atlas">
          {`Atlas said ${countryName(pick)}, ${sure}% sure${pick === photo.country ? ", and it was right" : ": wrong"}. The photo: ${photo.place}.`}
        </p>
      )}
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

/** Each photo played, by place, with its verdict and points. */
function SquareList({
  results,
  records,
  friend = null,
}: {
  results: readonly SpotResult[];
  records: ReadonlyMap<string, GameRecord>;
  /** On a friend's challenge: their squares, scored, listed under yours. */
  friend?: readonly SpotResult[] | null;
}) {
  return (
    <ol className="mt-6 space-y-2" aria-label="Your squares">
      {results.map((r, i) => {
        const theirs = friend?.[i];
        return (
          <li
            key={r.id}
            className="rounded-xl border border-graticule/70 px-3 py-2 text-sm"
            data-testid="spot-row"
          >
            <span className="block text-chalk">
              {records.get(r.id)?.photo.place ?? `Photo ${i + 1}`}
            </span>
            <span className="block text-chalk-dim">
              {theirs
                ? `You: ${formatPoints(r.points)} points (${spotVerdict(r).toLowerCase()})`
                : `${spotVerdict(r)}: ${formatPoints(r.points)} points`}
            </span>
            {theirs && (
              <span className="block text-chalk-dim">
                <span className="text-flare">Friend</span>
                {`: ${formatPoints(theirs.points)} points (${spotVerdict(theirs).toLowerCase()})`}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Today's Spot the clue once its last photo is answered, on this visit or an earlier one. */
function SpotDayResult({
  day,
  results,
  records,
  now,
}: {
  day: string;
  results: readonly SpotResult[];
  records: ReadonlyMap<string, GameRecord>;
  now?: () => Date;
}) {
  const { points, hottest } = spotTotals(results);
  return (
    <DailyRunResult
      game="Spot the clue"
      day={day}
      unit="game"
      headline={`${formatPoints(points)} points`}
      summary={`Out of ${formatPoints(results.length * SPOT_MAX)}. You found Atlas's most telling square on ${hottest} of ${results.length} photos.`}
      shareText={(href) => spotDailyShare(day, results, href)}
      freeHref="/spot-the-clue"
      now={now}
    >
      <SquareList results={results} records={records} />
    </DailyRunResult>
  );
}

function SpotSummary({
  results,
  records,
  best,
  newBest,
  challenge,
  onAgain,
}: {
  results: readonly SpotResult[];
  records: ReadonlyMap<string, GameRecord>;
  best: number;
  newBest: boolean;
  /** The friend's challenge this game answered, if it was one. */
  challenge: SpotChallenge | null;
  onAgain: () => void;
}) {
  const none = results.length === 0;
  const { points, hottest } = spotTotals(results);
  // The friend's squares, scored once every photo's map is in.
  const theirs = challenge ? spotFriendResults(challenge, records) : null;
  const againRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    againRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-sm text-gold">Spot the clue</p>
      <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
        {none ? "No photos to play yet" : `${formatPoints(points)} points`}
      </h1>
      {none ? (
        <p className="mt-4 text-lg text-chalk-dim">
          Spot the clue needs photos with Atlas&apos;s map of where it looked.
        </p>
      ) : (
        <>
          <p className="mt-4 text-lg text-chalk">
            {`Out of ${formatPoints(results.length * SPOT_MAX)}. You found Atlas's most telling square on ${hottest} of ${results.length} photos.`}
          </p>
          {challenge ? (
            <p className="mt-2 text-chalk" data-testid="spot-challenge-line">
              {theirs ? spotChallengeLine(results, theirs) : "Scoring your friend's squares…"}
            </p>
          ) : (
            <p className="mt-1 text-chalk-dim">
              {newBest ? "That's your new best!" : `Your best is ${formatPoints(best)} points.`}
            </p>
          )}
          <SquareList results={results} records={records} friend={theirs} />
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
        {results.length === SPOT_PHOTOS && (!challenge || theirs) && (
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
 * Challenge a friend from a whole free game (src/lib/game/spotChallenge.ts): a link to the same
 * five photos with your square on each. Answering a challenge, it sends one back, with the
 * head-to-head picture beside it.
 */
function ChallengeButton({
  results,
  answering,
}: {
  results: readonly SpotResult[];
  /** The friend's squares, scored, when this game answered their challenge. */
  answering: readonly SpotResult[] | null;
}) {
  const [sent, setSent] = useState("");
  const text = () => spotChallengeText(results, window.location.href, answering ?? undefined);
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
            headToHead={spotHeadToHead(results, answering, window.location.href)}
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
