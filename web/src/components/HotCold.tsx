"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { ROUND_KEYS, isShortcut } from "@/lib/controls";
import { countryAt } from "@/lib/countryHit";
import { countryName } from "@/lib/countries";
import { seededShuffle } from "@/lib/game/daily";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import {
  HOT_PHOTOS,
  MAX_PINS,
  PIN_BONUS,
  atlasTotal,
  hotAtlas,
  hotAtlasLine,
  hotClue,
  hotReducer,
  hotTotal,
  initialHot,
  loadBestHot,
  rememberHot,
  type HotClue,
  type HotRound,
} from "@/lib/game/hotCold";
import { formatDistance, formatPoints, haversineKm, type LngLat } from "@/lib/geo";
import type { RevealView } from "@/lib/reveal";
import type { Units } from "@/lib/units";
import { useUnits } from "@/lib/useUnits";

import ControlsHelp from "./ControlsHelp";
import GamesMenu from "./GamesMenu";
import Globe from "./Globe";
import PhotoViewer from "./PhotoViewer";
import UnitsSwitch from "./UnitsSwitch";

type HotColdProps = {
  deck: Deck;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that shuffles each game. */
  random?: () => number;
};

/** "1 pin", "3 pins". */
function pinCount(n: number): string {
  return `${n} pin${n === 1 ? "" : "s"}`;
}

/**
 * What the last miss said: how far off, and an arrow the way to head from that pin. Globe north
 * is up on every screen that can pin (the map doesn't rotate), so the arrow reads straight on it.
 */
function Clue({ clue, units }: { clue: HotClue; units: Units }) {
  const tone = clue.trend === "colder" ? "text-sonar" : "text-flare";
  return (
    <p role="status" className="mb-2 flex items-center gap-2 text-sm text-chalk md:text-base">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        data-testid="hot-cold-arrow"
        data-bearing={Math.round(clue.bearing)}
        className={`h-7 w-7 shrink-0 ${tone}`}
        style={{ transform: `rotate(${clue.bearing}deg)` }}
        fill="currentColor"
      >
        <path d="M12 2 20 21l-8-4-8 4z" />
      </svg>
      <span data-testid="hot-cold-clue">
        {clue.trend && (
          <strong className={`font-semibold ${tone}`}>
            {clue.trend === "warmer" ? "Warmer. " : "Colder. "}
          </strong>
        )}
        {`${formatDistance(clue.km, units)} off. Head ${clue.heading}.`}
      </span>
    </p>
  );
}

/**
 * Hot and cold (src/lib/game/hotCold.ts): up to three pins to find a photo's country, each miss
 * saying how far off it was and which way to head, five photos a game against Atlas's one pin.
 */
export default function HotCold({ deck, loadRecords, random }: HotColdProps) {
  const [state, dispatch] = useReducer(hotReducer, initialHot);
  const [best, setBest] = useState(0);
  // The best before this game, so the end screen can say when it was beaten.
  const [bestBefore, setBestBefore] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const units = useUnits();

  const start = useCallback(() => {
    const seed = Math.floor((random ?? Math.random)() * 2 ** 32);
    const stored = loadBestHot();
    setBest(stored);
    setBestBefore(stored);
    dispatch({
      type: "start",
      order: seededShuffle(deck.streakIds, seed).slice(0, HOT_PHOTOS),
    });
  }, [deck.streakIds, random]);

  // The order is shuffled in the browser after hydration, never at build time.
  useEffect(() => {
    const id = requestAnimationFrame(start);
    return () => cancelAnimationFrame(id);
  }, [start]);

  const load = useCallback(
    (ids: string[]) => (loadRecords ? loadRecords(ids) : fetchRecords(deck, ids)),
    [deck, loadRecords],
  );

  // This photo and the next one, so the next photo opens without waiting.
  const wanted = useMemo(() => {
    if (state.phase !== "guessing" && state.phase !== "answered") return [];
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

  const playing = state.phase === "guessing" || state.phase === "answered" ? state : null;
  const guessing = state.phase === "guessing" ? state : null;
  const answered = state.phase === "answered" ? state : null;
  const current = playing ? records.get(playing.order[playing.index]!) : undefined;
  const upcoming = answered ? records.get(answered.order[answered.index + 1] ?? "") : undefined;

  // Warm the cache with the next photo while the player reads the answer.
  useEffect(() => {
    if (upcoming) new Image().src = upcoming.photo.imageUrl;
  }, [upcoming]);

  const onPinChange = useCallback((pin: LngLat) => dispatch({ type: "pinned", pin }), []);

  const guess = useCallback(() => {
    if (!guessing?.pin || !current) return;
    const { photo, atlas } = current;
    dispatch({
      type: "dropped",
      truth: photo,
      found: countryAt(guessing.pin) === photo.country,
      atlas: atlas ? hotAtlas(haversineKm(atlas, photo), countryAt(atlas) === photo.country) : null,
    });
    // The button goes dead until the next pin, so focus moves on to the globe for it. A photo
    // that's over moves focus to its card's button instead.
    panelRef.current?.querySelector<HTMLElement>('[role="application"]')?.focus({
      preventScroll: true,
    });
  }, [current, guessing]);

  const next = useCallback(() => {
    const after = hotReducer(state, { type: "next" });
    if (after.phase === "finished") setBest(rememberHot(hotTotal(after.results)));
    dispatch({ type: "next" });
  }, [state]);

  // G guesses from anywhere on the screen, like a round's; the card's button takes Enter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== ROUND_KEYS.guess || !isShortcut(e)) return;
      e.preventDefault();
      guess();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guess]);

  const trail = useMemo(() => guessing?.pins.map((p) => p.at) ?? [], [guessing?.pins]);

  const reveal = useMemo<RevealView | null>(() => {
    if (!answered || !current) return null;
    const guesses: RevealView["guesses"] = answered.round.pins.map((p, i) => ({
      actor: "player",
      at: p.at,
      label: String(i + 1),
    }));
    if (current.atlas) guesses.push({ actor: "atlas", at: current.atlas });
    return { truth: current.photo, guesses };
  }, [answered, current]);

  if (state.phase === "finished") {
    const total = hotTotal(state.results);
    return (
      <Finished
        results={state.results}
        best={best}
        newBest={total > bestBefore}
        units={units}
        onAgain={start}
      />
    );
  }

  const results = playing?.results ?? [];
  const clue = guessing ? hotClue(guessing.pins) : null;
  const pinNumber = (guessing?.pins.length ?? 0) + 1;
  const of = playing?.order.length ?? HOT_PHOTOS;
  const atlas = atlasTotal(results);

  return (
    <main
      className="wb-stage relative h-dvh w-full overflow-hidden bg-ocean-deep"
      data-phase={answered ? "revealed" : "guessing"}
      data-photo={current?.photo.id}
    >
      <h1 className="sr-only">{`Whereabout: Hot and cold, photo ${(playing?.index ?? 0) + 1} of ${of}`}</h1>

      <div className="wb-photo">
        {current ? (
          <PhotoViewer
            src={current.photo.imageUrl}
            roundKey={current.photo.id}
            width={current.photo.width}
            height={current.photo.height}
          />
        ) : (
          <div
            className="wb-photo-placeholder h-full w-full"
            data-photo-placeholder="showing"
            aria-hidden="true"
          />
        )}
      </div>

      <header className="wb-header pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 px-4 pt-4 md:px-6">
        <div className="min-w-0">
          <Link
            href="/"
            className="pointer-events-auto font-sign text-3xl font-extrabold leading-none tracking-tight md:text-4xl"
          >
            Whereabout
          </Link>
          <p className="mt-1 text-sm text-chalk-dim">
            {`Hot and cold: photo ${(playing?.index ?? 0) + 1} of ${of}`}
          </p>
          <div className="pointer-events-auto mt-2 flex items-center gap-2">
            <GamesMenu screen="hot-cold" streakHref="/streak" />
            <ControlsHelp screen="hot-cold" />
          </div>
        </div>
        <div className="pointer-events-auto text-right">
          <dl>
            <dt className="text-sm text-chalk-dim">Score</dt>
            <dd
              className="font-sign tabular text-3xl font-bold leading-none"
              aria-live="polite"
              data-testid="hot-cold-score"
            >
              {formatPoints(hotTotal(results))}
            </dd>
          </dl>
          <dl className="mt-1 text-sm text-chalk-dim">
            {atlas.played > 0 && (
              <div className="flex justify-end gap-1.5">
                <dt>Atlas</dt>
                <dd className="tabular text-sonar">{formatPoints(atlas.total)}</dd>
              </div>
            )}
            <div className="flex justify-end gap-1.5">
              <dt>Best</dt>
              <dd className="tabular">{formatPoints(best)}</dd>
            </div>
          </dl>
        </div>
      </header>

      <div
        ref={panelRef}
        className="wb-globe-panel z-10"
        data-pinned={guessing?.pin || trail.length > 0 ? "true" : "false"}
      >
        <div className="wb-globe-frame">
          <Globe
            pin={guessing?.pin ?? null}
            trail={trail}
            onPinChange={onPinChange}
            disabled={!guessing || !current}
            reveal={reveal}
            className="h-full"
          />
        </div>
        {!answered && (
          <div className="wb-guess-bar">
            {clue && <Clue clue={clue} units={units} />}
            <button
              type="button"
              onClick={guess}
              disabled={!guessing?.pin || !current}
              className="w-full rounded-full bg-flare px-4 py-3 font-semibold text-ocean-deep transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-chalk/15 disabled:text-chalk-dim"
            >
              {guessing?.pin
                ? `Drop pin ${pinNumber} of ${MAX_PINS}`
                : `Tap the globe: pin ${pinNumber} of ${MAX_PINS}`}
            </button>
            {error && (
              <p role="alert" className="mt-2 text-center text-sm text-flare">
                {error}
              </p>
            )}
          </div>
        )}
      </div>

      {answered && current && (
        <div className="wb-reveal pointer-events-none absolute z-30">
          <HotCard
            key={answered.index}
            round={answered.round}
            record={current}
            units={units}
            last={answered.index + 1 >= answered.order.length}
            onNext={next}
          />
        </div>
      )}
    </main>
  );
}

function HotCard({
  round,
  record,
  units,
  last,
  onNext,
}: {
  round: HotRound;
  record: GameRecord;
  units: Units;
  last: boolean;
  onNext: () => void;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  const { credit, place, country } = record.photo;
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);
  const found = round.foundOn !== null;

  return (
    <section
      aria-labelledby="hot-cold-answer"
      className="wb-card pointer-events-auto w-full max-w-md rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-4 shadow-2xl md:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <p className={`text-sm ${found ? "text-sonar" : "text-flare"}`}>
          {found
            ? `${countryName(country)}, on pin ${round.foundOn}`
            : `Three pins, and it was ${countryName(country)}`}
        </p>
        <UnitsSwitch />
      </div>
      <h2
        id="hot-cold-answer"
        className="font-sign text-3xl font-extrabold leading-tight text-chalk md:text-5xl"
      >
        {formatPoints(round.score)} points
      </h2>
      <p className="mt-1 text-chalk-dim">{place}</p>
      <p className="mt-2 text-sm text-chalk">
        {`Closest pin ${formatDistance(round.bestKm, units)} away: ${formatPoints(round.closest)}`}
        {round.bonus > 0 ? ` + ${formatPoints(round.bonus)} for ${pinCount(round.foundOn!)}` : ""}
      </p>
      {round.atlas && (
        <p className="mt-1 text-sm text-chalk-dim">
          Atlas&apos;s one pin was{" "}
          <span className="text-sonar">{formatDistance(round.atlas.km, units)}</span> away
          {round.atlas.found ? ", in the country" : ""}: {formatPoints(round.atlas.score)} points.
        </p>
      )}
      <div className="mt-4 flex items-center gap-4 md:mt-5">
        <button
          ref={nextRef}
          type="button"
          onClick={onNext}
          className="shrink-0 rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          {last ? "See your score" : "Next photo"}
        </button>
        <a
          href={credit.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate text-xs text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk"
        >
          Photo: {credit.author}, {credit.license}
        </a>
      </div>
    </section>
  );
}

function Finished({
  results,
  best,
  newBest,
  units,
  onAgain,
}: {
  results: readonly HotRound[];
  best: number;
  newBest: boolean;
  units: Units;
  onAgain: () => void;
}) {
  const none = results.length === 0;
  const atlas = hotAtlasLine(results);
  const most = results.length * (5000 + PIN_BONUS[0]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-sm text-gold">Hot and cold</p>
      <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
        {none ? "No photos to play yet" : `${formatPoints(hotTotal(results))} points`}
      </h1>
      {none ? (
        <p className="mt-4 text-lg text-chalk-dim">
          Hot and cold needs photos taken in countries the globe draws.
        </p>
      ) : (
        <>
          <p className="mt-4 text-lg text-chalk-dim">
            {`Out of ${formatPoints(most)}. `}
            {newBest
              ? "That's your new best!"
              : best > 0
                ? `Your best is ${formatPoints(best)}.`
                : ""}
          </p>
          {atlas && (
            <p className="mt-2 text-chalk" data-testid="hot-cold-atlas-total">
              {atlas}
            </p>
          )}
          <ol className="mt-6 space-y-2" aria-label="Your photos">
            {results.map((r, i) => (
              <li key={r.id} className="flex items-baseline justify-between gap-4 text-sm">
                <span className="text-chalk-dim">
                  {`Photo ${i + 1}: ${
                    r.foundOn ? `found on pin ${r.foundOn}` : "not found"
                  }, ${formatDistance(r.bestKm, units)} at closest`}
                </span>
                <span className="tabular font-semibold">{formatPoints(r.score)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      <div className="mt-8 flex flex-wrap items-center gap-4">
        {!none && (
          <button
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
