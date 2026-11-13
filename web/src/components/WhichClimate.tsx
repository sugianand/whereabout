"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { isShortcut } from "@/lib/controls";
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
import { CLIMATE_GROUPS, atlasClimateGroup, type ClimateGroup } from "@/lib/trueClues";

import ControlsHelp from "./ControlsHelp";
import GamesMenu from "./GamesMenu";

type WhichClimateProps = {
  deck: Deck;
  /** Each dealable photo's Köppen group (`bundledClimateGroups`). */
  groups: ClimateMap;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that picks each game's seed. */
  random?: () => number;
};

/** 1 to 5 name the groups in the order the buttons show them. */
const KEY_GROUP: Record<string, ClimateGroup> = Object.fromEntries(
  CLIMATE_GROUPS.map((group, i) => [String(i + 1), group]),
);

/**
 * Which climate? (src/lib/game/whichClimate.ts): one photo and the five Köppen groups. Name the
 * climate the place sits in by tapping a group or pressing 1 to 5; the answer shows the place on
 * the band of groups, with your call and Atlas's on it. Five photos a game, against Atlas.
 */
export default function WhichClimate({ deck, groups, loadRecords, random }: WhichClimateProps) {
  const [state, dispatch] = useReducer(climateReducer, initialClimate);
  const [best, setBest] = useState(0);
  const [bestBeforeGame, setBestBeforeGame] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(() => {
    const stored = loadBestClimate();
    setBest(stored);
    setBestBeforeGame(stored);
    const seed = Math.floor((random ?? Math.random)() * 2 ** 32);
    dispatch({ type: "start", order: dealClimate(groups, seed) });
  }, [groups, random]);

  // The game is dealt in the browser after hydration, never at build time.
  useEffect(() => {
    const id = requestAnimationFrame(() => start());
    return () => cancelAnimationFrame(id);
  }, [start]);

  const load = useCallback(
    (ids: string[]) => (loadRecords ? loadRecords(ids) : fetchRecords(deck, ids)),
    [deck, loadRecords],
  );

  // The photo being called (or just answered) and the one after it.
  const playing = state.phase === "picking" || state.phase === "answered" ? state : null;
  const index = playing ? playing.results.length - (playing.phase === "answered" ? 1 : 0) : 0;
  const wanted = useMemo(
    () => (playing ? playing.order.slice(index, index + 2) : []),
    [playing, index],
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
      if (after.phase === "answered") {
        // Count the call in your clue reading on Your map, as it is made, so leaving mid-game
        // still counts the photos called.
        const call = after.results[after.results.length - 1];
        recordFreeRound("which-climate", {
          first: after.results.length === 1,
          correct: call.correct,
          atlas: call.atlas === null ? null : call.atlas === call.truth,
        });
        // Only a whole game counts as a best.
        if (after.results.length === after.order.length) {
          setBest(rememberClimate(climateTotals(after.results).right));
        }
      }
      dispatch(action);
    },
    [state, record, groups],
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

  if (state.phase === "done") {
    return (
      <ClimateSummary
        results={state.results}
        records={records}
        best={best}
        newBest={climateTotals(state.results).right > bestBeforeGame}
        onAgain={start}
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
          <p className="mt-1 text-sm text-chalk-dim">Which climate? Name the Köppen group.</p>
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
            <div className="mt-1 flex justify-end gap-1.5 text-sm text-chalk-dim">
              <dt>Best</dt>
              <dd className="tabular">{best}</dd>
            </div>
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
            onNext={() => dispatch({ type: "next" })}
            nextLabel={last ? "See the results" : "Next photo"}
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
export function ClimateBand({ result }: { result: ClimateResult }) {
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
  onNext,
  nextLabel,
}: {
  result: ClimateResult;
  place: string;
  lat: number;
  atlasTally: readonly [number, number];
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
      <ClimateBand result={result} />
      <p className="mt-2 text-sm text-chalk-dim">
        {`${climateAtlasLine(result.atlas, result.truth)} Atlas this game: ${atlasRight} of ${played}.`}
      </p>
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
  onAgain,
}: {
  results: readonly ClimateResult[];
  records: ReadonlyMap<string, GameRecord>;
  best: number;
  newBest: boolean;
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
          <p className="mt-1 text-chalk-dim">
            {newBest ? "That's your new best!" : `Your best is ${best} of ${CLIMATE_PHOTOS}.`}
          </p>
          <ol className="mt-6 space-y-2" aria-label="Your calls">
            {results.map((r) => (
              <li
                key={r.id}
                className="rounded-xl border border-graticule/70 px-3 py-2 text-sm"
                data-testid="climate-row"
              >
                <span className="block text-chalk">{records.get(r.id)?.photo.place ?? r.id}</span>
                <span className="block text-chalk-dim">
                  {`${r.truth}. You: ${r.picked} ${r.correct ? "✓" : "✗"}. Atlas: ${r.atlas === null ? "no read" : `${r.atlas} ${r.atlas === r.truth ? "✓" : "✗"}`}`}
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
