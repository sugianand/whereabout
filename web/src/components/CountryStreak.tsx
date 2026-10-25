"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { countryAt } from "@/lib/countryHit";
import { countryName, shortlist } from "@/lib/countries";
import { seededShuffle } from "@/lib/game/daily";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import {
  initialStreak,
  loadBestStreak,
  rememberStreak,
  runOver,
  streakReducer,
} from "@/lib/game/streak";
import type { LngLat } from "@/lib/geo";
import type { RevealView } from "@/lib/reveal";

import Globe from "./Globe";
import PhotoViewer from "./PhotoViewer";

type CountryStreakProps = {
  deck: Deck;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that shuffles each run. */
  random?: () => number;
};

/** "1 photo", "3 photos". */
function photos(n: number): string {
  return `${n} photo${n === 1 ? "" : "s"}`;
}

/**
 * Country Streak (src/lib/game/streak.ts): a photo, a globe, and one question, which country?
 * The player taps a country to pick it, confirms, and plays on until the first miss.
 */
export default function CountryStreak({ deck, loadRecords, random }: CountryStreakProps) {
  const [state, dispatch] = useReducer(streakReducer, initialStreak);
  const [best, setBest] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  // The best streak before this run, so the end card can say when it was beaten.
  const [bestBeforeRun, setBestBeforeRun] = useState(0);

  const start = useCallback(() => {
    const seed = Math.floor((random ?? Math.random)() * 2 ** 32);
    const stored = loadBestStreak();
    setBestBeforeRun(stored);
    setBest(stored);
    dispatch({ type: "start", order: seededShuffle(deck.streakIds, seed) });
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

  // This photo and the next one, so the next round opens without waiting.
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

  const current =
    state.phase === "guessing" || state.phase === "answered"
      ? records.get(state.order[state.index])
      : undefined;
  const next =
    state.phase === "answered" ? records.get(state.order[state.index + 1] ?? "") : undefined;

  // Warm the cache with the next photo while the player reads the answer.
  useEffect(() => {
    if (next) new Image().src = next.photo.imageUrl;
  }, [next]);

  const onPinChange = useCallback(
    (at: LngLat) => dispatch({ type: "picked", pick: { at, country: countryAt(at) } }),
    [],
  );

  function confirm() {
    if (state.phase !== "guessing" || !current || !state.pick?.country) return;
    const correct = state.pick.country === current.photo.country;
    dispatch({ type: "answered", truth: current.photo.country });
    if (correct) setBest((b) => Math.max(b, rememberStreak(state.streak + 1)));
  }

  const pick = state.phase === "guessing" || state.phase === "answered" ? state.pick : null;
  const answered = state.phase === "answered" ? state : null;
  const streak = state.phase === "idle" ? 0 : state.streak;
  const over = runOver(state);

  const reveal = useMemo<RevealView | null>(() => {
    if (!answered || !current) return null;
    return { truth: current.photo, guesses: [{ actor: "player", at: answered.pick.at }] };
  }, [answered, current]);

  const marks = useMemo(
    () => ({ picked: pick?.country ?? null, answer: answered?.answer.truth ?? null }),
    [pick, answered],
  );

  if (state.phase === "cleared") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
        <p className="text-sm text-gold">Country Streak</p>
        <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
          {state.order.length === 0 ? "No photos to play yet" : "Every photo, no misses"}
        </h1>
        <p className="mt-4 text-lg text-chalk-dim">
          {state.order.length === 0
            ? "Country Streak needs photos taken in countries the globe draws."
            : `You named the country of all ${photos(state.streak)} in the game.`}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          {state.order.length > 0 && (
            <button
              type="button"
              onClick={start}
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

  // Atlas's first choice of country for this photo, from its precomputed guess.
  const atlasCountry = current?.atlas
    ? shortlist(current.atlas.topCountries ?? [])[0]?.country
    : undefined;
  const newBest = over && streak > bestBeforeRun;

  return (
    <main
      className="wb-stage relative h-dvh w-full overflow-hidden bg-ocean-deep"
      data-phase={answered ? "revealed" : "guessing"}
      data-photo={current?.photo.id}
    >
      <h1 className="sr-only">{`Whereabout: Country Streak, ${streak} in a row`}</h1>

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
          <p className="mt-1 text-sm text-chalk-dim">Country Streak: name the country</p>
        </div>
        <dl className="pointer-events-auto text-right">
          <div>
            <dt className="text-sm text-chalk-dim">Streak</dt>
            <dd className="font-sign tabular text-3xl font-bold leading-none" aria-live="polite">
              {streak}
            </dd>
          </div>
          <div className="mt-1 flex justify-end gap-1.5 text-sm text-chalk-dim">
            <dt>Best</dt>
            <dd className="tabular">{best}</dd>
          </div>
        </dl>
      </header>

      <div className="wb-globe-panel z-10" data-pinned={pick ? "true" : "false"}>
        <div className="wb-globe-frame">
          <Globe
            pin={pick?.at ?? null}
            onPinChange={onPinChange}
            disabled={state.phase !== "guessing" || !current}
            reveal={reveal}
            countries={marks}
            className="h-full"
          />
        </div>
        {!answered && (
          <div className="wb-guess-bar">
            <button
              type="button"
              onClick={confirm}
              disabled={state.phase !== "guessing" || !current || !pick?.country}
              className="w-full rounded-full bg-flare px-4 py-3 font-semibold text-ocean-deep transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-chalk/15 disabled:text-chalk-dim"
            >
              {!pick
                ? "Tap the country on the globe"
                : pick.country
                  ? `It's ${countryName(pick.country)}`
                  : "That's the sea. Tap a country"}
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
          <StreakCard
            key={`${state.phase}-${answered.index}`}
            correct={answered.answer.correct}
            truth={answered.answer.truth}
            guess={answered.answer.guess}
            record={current}
            atlasCountry={atlasCountry}
            streak={streak}
            best={best}
            newBest={newBest}
            onNext={over ? start : () => dispatch({ type: "next" })}
          />
        </div>
      )}
    </main>
  );
}

function StreakCard({
  correct,
  truth,
  guess,
  record,
  atlasCountry,
  streak,
  best,
  newBest,
  onNext,
}: {
  correct: boolean;
  truth: string;
  guess: string;
  record: GameRecord;
  atlasCountry: string | undefined;
  streak: number;
  best: number;
  newBest: boolean;
  onNext: () => void;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  const { credit } = record.photo;
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      aria-labelledby="streak-answer"
      className="wb-card pointer-events-auto w-full max-w-md rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-4 shadow-2xl md:p-6"
    >
      <p className={`text-sm ${correct ? "text-sonar" : "text-flare"}`}>
        {correct ? "Right!" : `Not ${countryName(guess)}.`}
      </p>
      <h2
        id="streak-answer"
        className="font-sign text-3xl font-extrabold leading-tight text-chalk md:text-5xl"
      >
        {correct ? `It's ${countryName(truth)}` : `It was ${countryName(truth)}`}
      </h2>
      <p className="mt-1 text-chalk-dim">{record.photo.place}</p>
      {atlasCountry && (
        <p className="mt-3 text-sm text-chalk-dim">
          Atlas said <span className="text-sonar">{countryName(atlasCountry)}</span>
          {atlasCountry === truth ? ", and it was right." : "."}
        </p>
      )}
      {correct ? (
        <p className="mt-3 text-chalk">{streak} in a row. Keep going until you miss.</p>
      ) : (
        <p className="mt-3 text-chalk">
          {`Your streak ends at ${photos(streak)}. `}
          {newBest ? "That's your new best!" : `Your best is ${best}.`}
        </p>
      )}
      <div className="mt-4 flex items-center gap-4 md:mt-5">
        <button
          ref={nextRef}
          type="button"
          onClick={onNext}
          className="shrink-0 rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          {correct ? "Next photo" : "Start a new streak"}
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
