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
import type { AtlasLooked } from "@/lib/game/types";
import { formatPoints } from "@/lib/geo";
import { sources } from "@/lib/photoSources";

import ControlsHelp from "./ControlsHelp";
import GamesMenu from "./GamesMenu";

type SpotClueProps = {
  deck: Deck;
  /** The photos with a playable "where Atlas looked" map (`bundledSpotIds`). */
  ids: readonly string[];
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that picks each game's seed. */
  random?: () => number;
};

const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
type Arrow = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

/**
 * Spot the clue (src/lib/game/spotClue.ts): the square of the photo Atlas saw and the country it
 * picked; tap the part of the photo you think told it most, or move there with the arrow keys
 * and press G. The answer lays Atlas's real "where it looked" map over the photo, with your
 * square and its hottest marked, and scores your square by how much it mattered. Five photos.
 */
export default function SpotClue({ deck, ids, loadRecords, random }: SpotClueProps) {
  const [state, dispatch] = useReducer(spotReducer, initialSpot);
  const [best, setBest] = useState(0);
  const [bestBeforeGame, setBestBeforeGame] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  // The square picked so far on the photo in play; null until the record says how big the grid is.
  const [cursor, setCursor] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const start = useCallback(() => {
    const stored = loadBestSpot();
    setBest(stored);
    setBestBeforeGame(stored);
    const seed = Math.floor((random ?? Math.random)() * 2 ** 32);
    setCursor(null);
    dispatch({ type: "start", order: dealSpot(ids, seed) });
  }, [ids, random]);

  // The game is dealt in the browser after hydration, never at build time.
  useEffect(() => {
    const id = requestAnimationFrame(() => start());
    return () => cancelAnimationFrame(id);
  }, [start]);

  const load = useCallback(
    (wanted: string[]) => (loadRecords ? loadRecords(wanted) : fetchRecords(deck, wanted)),
    [deck, loadRecords],
  );

  const playing = state.phase === "picking" || state.phase === "answered" ? state : null;
  const index = playing ? playing.results.length - (playing.phase === "answered" ? 1 : 0) : 0;
  // The summary names every photo played, so it needs them all.
  const over = state.phase === "done" ? state.results : null;
  const wanted = useMemo(
    () => (playing ? playing.order.slice(index, index + 2) : over ? over.map((r) => r.id) : []),
    [playing, index, over],
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
    // Only a whole game counts as a best.
    if (after.phase === "answered" && after.results.length === after.order.length) {
      setBest(rememberSpot(spotTotals(after.results).points));
    }
    dispatch({ type: "picked", result });
  }, [ready, square, record, looked, state]);

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

  if (state.phase === "done") {
    return (
      <SpotSummary
        results={state.results}
        records={records}
        best={best}
        newBest={spotTotals(state.results).points > bestBeforeGame}
        onAgain={start}
      />
    );
  }

  const results = playing?.results ?? [];
  const totals = spotTotals(results);
  const answered = state.phase === "answered" ? results[results.length - 1] : null;
  const last = playing !== null && results.length === playing.order.length;
  const atlas = record?.atlas ?? null;
  const pick = atlas?.topCountries[0]?.country ?? null;

  return (
    <main
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-ocean-deep"
      data-phase={answered ? "revealed" : "picking"}
      data-photo={record?.photo.id}
    >
      <h1 className="sr-only">{`Whereabout: Spot the clue, photo ${index + 1} of ${playing?.order.length ?? SPOT_PHOTOS}`}</h1>

      <header className="flex items-start justify-between gap-4 px-4 pb-2 pt-4 md:px-6">
        <div className="min-w-0">
          <Link
            href="/"
            className="font-sign text-3xl font-extrabold leading-none tracking-tight md:text-4xl"
          >
            Whereabout
          </Link>
          <p className="mt-1 text-sm text-chalk-dim">Spot the clue: what told Atlas?</p>
          <p className="text-sm text-chalk-dim" aria-live="polite">
            {`Photo ${index + 1} of ${playing?.order.length ?? SPOT_PHOTOS}`}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          <GamesMenu screen="spot-the-clue" streakHref="/streak" />
          <ControlsHelp screen="spot-the-clue" />
          <dl className="text-right">
            <dt className="text-sm text-chalk-dim">Score</dt>
            <dd className="font-sign tabular text-3xl font-bold leading-none">
              {formatPoints(totals.points)}
            </dd>
            <div className="mt-1 flex justify-end gap-1.5 text-sm text-chalk-dim">
              <dt>Best</dt>
              <dd className="tabular">{formatPoints(best)}</dd>
            </div>
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
  onPick,
  gridRef,
}: {
  record: GameRecord | undefined;
  looked: AtlasLooked | null;
  square: number | null;
  answered: SpotResult | null;
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
  onNext,
  nextLabel,
}: {
  result: SpotResult;
  looked: AtlasLooked;
  record: GameRecord;
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
      <p className="text-sm text-chalk-dim">{hottestLine(looked)}</p>
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

function SpotSummary({
  results,
  records,
  best,
  newBest,
  onAgain,
}: {
  results: readonly SpotResult[];
  records: ReadonlyMap<string, GameRecord>;
  best: number;
  newBest: boolean;
  onAgain: () => void;
}) {
  const none = results.length === 0;
  const { points, hottest } = spotTotals(results);
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
          <p className="mt-1 text-chalk-dim">
            {newBest ? "That's your new best!" : `Your best is ${formatPoints(best)} points.`}
          </p>
          <ol className="mt-6 space-y-2" aria-label="Your squares">
            {results.map((r, i) => (
              <li
                key={r.id}
                className="rounded-xl border border-graticule/70 px-3 py-2 text-sm"
                data-testid="spot-row"
              >
                <span className="block text-chalk">
                  {records.get(r.id)?.photo.place ?? `Photo ${i + 1}`}
                </span>
                <span className="block text-chalk-dim">
                  {`${spotVerdict(r)}: ${formatPoints(r.points)} points`}
                </span>
              </li>
            ))}
          </ol>
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
            Play again
          </button>
        )}
        <Link href="/" className="text-chalk-dim underline underline-offset-2 hover:text-chalk">
          Back to the main game
        </Link>
      </div>
    </main>
  );
}
