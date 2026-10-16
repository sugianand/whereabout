"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import atlasData from "@/data/atlas.json";
import catalog from "@/data/photos.json";
import { ApiBackend, LocalBackend } from "@/lib/game/backends";
import { dayKey, pickDaily } from "@/lib/game/daily";
import { loadRecent, pickFresh, rememberPlayed, saveRecent } from "@/lib/game/fresh";
import { playablePhotos } from "@/lib/game/playable";
import { ROUNDS_PER_GAME, gameReducer, initialState, totals } from "@/lib/game/state";
import type { AtlasData, CatalogPhoto, GameBackend } from "@/lib/game/types";
import { formatPoints, type LngLat } from "@/lib/geo";
import type { RevealView } from "@/lib/reveal";

import Globe from "./Globe";
import PhotoViewer from "./PhotoViewer";
import RevealCard from "./RevealCard";
import Summary from "./Summary";

const atlas = atlasData as AtlasData;
// Only photos Atlas has guessed open a round (photos fresh from the harvest wait for its run).
const photos = playablePhotos(catalog as CatalogPhoto[], atlas);

/** A fresh game is five photos the player hasn't seen lately; the Daily Five is shared by all. */
export type GameMode = { kind: "daily"; day: string } | { kind: "fresh"; game: number };

export function modeTitle(mode: GameMode): string {
  if (mode.kind === "fresh") return "Fresh game";
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
  /** Which game a visit opens on. Defaults to `?daily` in the URL, otherwise a fresh game. */
  start?: GameMode["kind"];
  /** For tests: the date that decides the Daily Five. Defaults to now, read in the browser. */
  today?: Date;
  /** For tests: supply the backend directly. */
  backendFor?: (photos: CatalogPhoto[]) => GameBackend;
};

/** True when the page URL asks for the Daily Five (`?daily`). */
function urlWantsDaily(): boolean {
  return new URLSearchParams(window.location.search).has("daily");
}

/** Keep the address bar in step with the mode, so a shared link opens the same kind of game. */
function syncUrl(kind: GameMode["kind"]) {
  const url = new URL(window.location.href);
  if (kind === "daily") url.searchParams.set("daily", "");
  else url.searchParams.delete("daily");
  const next = `${url.pathname}${url.search.replace(/daily=(?=&|$)/, "daily")}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, "", next);
  }
}

export default function Game({ apiUrl, start, today, backendFor }: GameProps) {
  // The mode is decided in the browser after hydration: the URL, today's date and the photos
  // this browser played recently are all unknown when the static page is built.
  const [mode, setMode] = useState<GameMode | null>(null);
  const [state, dispatch] = useReducer(gameReducer, initialState);

  useEffect(() => {
    if (mode) return;
    const id = requestAnimationFrame(() => {
      const kind = start ?? (urlWantsDaily() ? "daily" : "fresh");
      setMode(
        kind === "daily"
          ? { kind: "daily", day: dayKey(today ?? new Date()) }
          : { kind: "fresh", game: 1 },
      );
    });
    return () => cancelAnimationFrame(id);
  }, [mode, start, today]);

  // Each fresh game is drawn once per mode change and avoids the photos played lately.
  const gamePhotos = useMemo(() => {
    if (!mode) return [];
    return mode.kind === "daily"
      ? pickDaily(photos, mode.day, ROUNDS_PER_GAME)
      : pickFresh(photos, loadRecent(), ROUNDS_PER_GAME);
  }, [mode]);

  // Remember what was dealt, so the next visit or fresh game opens on other photos.
  useEffect(() => {
    if (gamePhotos.length === 0) return;
    const limit = Math.max(0, photos.length - ROUNDS_PER_GAME);
    saveRecent(
      rememberPlayed(
        loadRecent(),
        gamePhotos.map((p) => p.id),
        limit,
      ),
    );
  }, [gamePhotos]);

  useEffect(() => {
    if (mode) syncUrl(mode.kind);
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

  function playFresh() {
    setMode((m) => ({ kind: "fresh", game: m?.kind === "fresh" ? m.game + 1 : 1 }));
    dispatch({ type: "restart" });
  }

  function playDaily() {
    setMode({ kind: "daily", day: dayKey(today ?? new Date()) });
    dispatch({ type: "restart" });
  }

  const title = mode ? modeTitle(mode) : "";

  const revealView = useMemo<RevealView | null>(() => {
    if (state.phase !== "revealed") return null;
    const { current } = state;
    const guesses: RevealView["guesses"] = [{ actor: "player", at: current.pin }];
    if (current.atlas) guesses.push({ actor: "atlas", at: current.atlas });
    return {
      truth: current.reveal.answer,
      guesses,
      ...(current.atlas?.belief ? { belief: current.atlas.belief } : {}),
    };
  }, [state]);

  if (state.phase === "finished") {
    return (
      <Summary
        results={state.results}
        title={title}
        onPlayAgain={playFresh}
        onPlayDaily={mode?.kind === "daily" ? undefined : playDaily}
      />
    );
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
  const roundSize = round ? photos.find((p) => p.id === round.photo.id) : undefined;

  return (
    <main
      className="wb-stage relative h-dvh w-full overflow-hidden bg-ocean-deep"
      data-phase={state.phase}
    >
      <h1 className="sr-only">{`Whereabout: ${title}, round ${roundNumber} of ${ROUNDS_PER_GAME}`}</h1>

      <div className="wb-photo">
        {round ? (
          <PhotoViewer
            src={round.photo.imageUrl}
            roundKey={round.roundId}
            width={roundSize?.width}
            height={roundSize?.height}
          />
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
          {mode && (
            <button
              type="button"
              onClick={mode.kind === "daily" ? playFresh : playDaily}
              className="mt-2 rounded-full border border-chalk/30 bg-ocean-deep/60 px-3 py-1 text-xs font-semibold backdrop-blur transition hover:border-chalk"
            >
              {mode.kind === "daily" ? "New random game" : "Play the Daily Five"}
            </button>
          )}
          {state.phase !== "revealed" && (
            <Link
              href="/you"
              className="wb-try-atlas mt-2 flex max-w-60 items-center gap-2 rounded-full md:mt-3 md:gap-2.5 md:rounded-2xl border border-sonar/40 bg-ocean-deep/70 py-1 pl-1 pr-3 backdrop-blur transition hover:border-sonar md:px-3 md:py-2"
            >
              <span
                aria-hidden="true"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sonar/15 md:h-7 md:w-7 text-sonar"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
              </span>
              <span className="text-left leading-tight">
                <span className="block text-xs font-semibold text-sonar">
                  Try Atlas on your photo
                </span>
                <span className="hidden text-[11px] text-chalk-dim md:block">
                  Runs in your browser, stays private
                </span>
              </span>
            </Link>
          )}
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
