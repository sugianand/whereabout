"use client";

import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import atlasData from "@/data/atlas.json";
import catalog from "@/data/photos.json";
import { ApiBackend, LocalBackend } from "@/lib/game/backends";
import { dayKey, pickDaily, pickRandom } from "@/lib/game/daily";
import { ROUNDS_PER_GAME, gameReducer, initialState, totals } from "@/lib/game/state";
import type { AtlasData, CatalogPhoto, GameBackend } from "@/lib/game/types";
import { formatPoints, type LngLat } from "@/lib/geo";
import type { RevealView } from "@/lib/reveal";

import Globe from "./Globe";
import PhotoViewer from "./PhotoViewer";
import RevealCard from "./RevealCard";
import Summary from "./Summary";

const photos = catalog as CatalogPhoto[];
const atlas = atlasData as AtlasData;

export type GameMode = { kind: "daily"; day: string } | { kind: "practice"; game: number };

export function modeTitle(mode: GameMode): string {
  if (mode.kind === "practice") return "Practice game";
  const label = new Date(`${mode.day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return `Daily Five, ${label}`;
}

type GameProps = {
  /** Base URL of the FastAPI backend. Without one, rounds are played from the bundled catalog. */
  apiUrl?: string;
  /** For tests: the date that decides the Daily Five. Defaults to now, read in the browser. */
  today?: Date;
  /** For tests: supply the backend directly. */
  backendFor?: (photos: CatalogPhoto[]) => GameBackend;
};

export default function Game({ apiUrl, today, backendFor }: GameProps) {
  // The day is read in the browser after hydration, so a static page built yesterday still
  // serves today's Daily Five.
  const [mode, setMode] = useState<GameMode | null>(
    today ? { kind: "daily", day: dayKey(today) } : null,
  );
  const [state, dispatch] = useReducer(gameReducer, initialState);

  useEffect(() => {
    if (mode) return;
    const id = requestAnimationFrame(() => setMode({ kind: "daily", day: dayKey(new Date()) }));
    return () => cancelAnimationFrame(id);
  }, [mode]);

  const gamePhotos = useMemo(() => {
    if (!mode) return [];
    return mode.kind === "daily"
      ? pickDaily(photos, mode.day, ROUNDS_PER_GAME)
      : pickRandom(photos, ROUNDS_PER_GAME);
  }, [mode]);

  const backend = useMemo<GameBackend | null>(() => {
    if (!mode) return null;
    if (backendFor) return backendFor(gamePhotos);
    return apiUrl ? new ApiBackend(apiUrl) : new LocalBackend(gamePhotos);
  }, [mode, gamePhotos, apiUrl, backendFor]);

  // Start each round as soon as the game enters the loading phase.
  useEffect(() => {
    if (!backend || state.phase !== "loading" || state.error) return;
    let cancelled = false;
    backend
      .startRound()
      .then((round) => !cancelled && dispatch({ type: "started", round }))
      .catch((err: Error) => !cancelled && dispatch({ type: "failed", message: err.message }));
    return () => {
      cancelled = true;
    };
  }, [backend, state]);

  // Warm the cache with the next photo while the player reads the reveal.
  useEffect(() => {
    if (state.phase !== "revealed" || backend?.kind !== "local") return;
    const next = gamePhotos[state.index + 1];
    if (next) new Image().src = next.imageUrl;
  }, [state, backend, gamePhotos]);

  const onPinChange = useCallback((pin: LngLat) => dispatch({ type: "pinned", pin }), []);

  async function submit() {
    if (state.phase !== "guessing" || !state.pin || state.submitting || !backend) return;
    dispatch({ type: "submitted" });
    try {
      const reveal = await backend.guess(state.round.roundId, state.pin);
      // The server's word on Atlas wins; otherwise use the guesses bundled with the site.
      const atlasGuess =
        reveal.atlas !== undefined ? reveal.atlas : (atlas.guesses[state.round.photo.id] ?? null);
      dispatch({ type: "revealed", reveal, atlas: atlasGuess });
    } catch (err) {
      dispatch({ type: "failed", message: (err as Error).message });
    }
  }

  function playAgain() {
    setMode((m) => ({ kind: "practice", game: m?.kind === "practice" ? m.game + 1 : 1 }));
    dispatch({ type: "restart" });
  }

  const title = mode ? modeTitle(mode) : "";

  const revealView = useMemo<RevealView | null>(() => {
    if (state.phase !== "revealed") return null;
    const { current } = state;
    const guesses: RevealView["guesses"] = [{ actor: "player", at: current.pin }];
    if (current.atlas) guesses.push({ actor: "atlas", at: current.atlas });
    return { truth: current.reveal.answer, guesses };
  }, [state]);

  if (state.phase === "finished") {
    return <Summary results={state.results} title={title} onPlayAgain={playAgain} />;
  }

  const round =
    state.phase === "guessing"
      ? state.round
      : state.phase === "revealed"
        ? state.current.round
        : null;
  const pin =
    state.phase === "guessing" ? state.pin : state.phase === "revealed" ? state.current.pin : null;
  const score = totals(state.results).player;
  const error = state.phase === "guessing" || state.phase === "loading" ? state.error : null;
  const roundNumber = state.index + 1;

  return (
    <main
      className="wb-stage relative h-dvh w-full overflow-hidden bg-ocean-deep"
      data-phase={state.phase}
    >
      <h1 className="sr-only">{`Whereabout: ${title}, round ${roundNumber} of ${ROUNDS_PER_GAME}`}</h1>

      <div className="wb-photo">
        {round ? (
          <PhotoViewer src={round.photo.imageUrl} roundKey={round.roundId} />
        ) : (
          <div className="wb-shimmer h-full w-full" aria-hidden="true" />
        )}
      </div>

      <header className="wb-header pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 px-4 pt-4 md:px-6">
        <div className="pointer-events-auto">
          <p className="font-sign text-3xl font-extrabold leading-none tracking-tight md:text-4xl">
            Whereabout
          </p>
          <p className="mt-1 text-sm text-chalk-dim">{title}</p>
        </div>
        <div className="pointer-events-auto text-right">
          <ol className="flex justify-end gap-1.5" aria-hidden="true">
            {Array.from({ length: ROUNDS_PER_GAME }, (_, i) => (
              <li
                key={i}
                className={`h-1.5 w-6 rounded-full ${
                  i < state.results.length
                    ? "bg-flare"
                    : i === state.index
                      ? "bg-chalk"
                      : "bg-chalk/25"
                }`}
              />
            ))}
          </ol>
          <p className="mt-2 text-sm text-chalk-dim">
            Round {roundNumber} of {ROUNDS_PER_GAME}
          </p>
          <p className="font-sign tabular text-2xl font-bold">
            {formatPoints(score)}{" "}
            <span className="text-base font-normal text-chalk-dim">points</span>
          </p>
        </div>
      </header>

      <div className="wb-globe-panel z-10" data-pinned={pin ? "true" : "false"}>
        <div className="wb-globe-frame">
          <Globe
            pin={pin}
            onPinChange={onPinChange}
            disabled={state.phase !== "guessing" || state.submitting}
            reveal={revealView}
            className="h-full"
          />
        </div>
        {state.phase !== "revealed" && (
          <div className="wb-guess-bar">
            <button
              type="button"
              onClick={submit}
              disabled={state.phase !== "guessing" || !state.pin || state.submitting}
              className="w-full rounded-full bg-flare px-6 py-3 font-semibold text-ocean-deep transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-chalk/15 disabled:text-chalk-dim"
            >
              {state.phase === "guessing" && state.submitting
                ? "Checking…"
                : state.phase === "guessing" && state.pin
                  ? "Guess here"
                  : "Place your pin on the globe"}
            </button>
            {error && (
              <p role="alert" className="mt-2 text-center text-sm text-flare">
                {error}
              </p>
            )}
          </div>
        )}
      </div>

      {state.phase === "revealed" && (
        <div className="wb-reveal pointer-events-none absolute z-30">
          <RevealCard
            result={state.current}
            isLast={state.index + 1 >= ROUNDS_PER_GAME}
            onNext={() => dispatch({ type: "next" })}
          />
        </div>
      )}
    </main>
  );
}
