"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import { ApiBackend, LocalBackend } from "@/lib/game/backends";
import { dayKey, pickDaily } from "@/lib/game/daily";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import { loadRecent, pickFresh, rememberPlayed, saveRecent } from "@/lib/game/fresh";
import { ROUNDS_PER_GAME, gameReducer, initialState, totals } from "@/lib/game/state";
import { TIERS, TIER_NAMES, isTier, tierBlurb, type Tier, type Tiers } from "@/lib/game/tiers";
import type { CatalogPhoto, GameBackend } from "@/lib/game/types";
import { formatPoints, maxPoints, type LngLat } from "@/lib/geo";
import { hasSeenIntro, INTRO_TEXT, markIntroSeen } from "@/lib/intro";
import { recordGame, resetRecord, type PlayerRecord } from "@/lib/playerRecord";
import type { RevealView } from "@/lib/reveal";

import Globe from "./Globe";
import PhotoViewer from "./PhotoViewer";
import RevealCard from "./RevealCard";
import Summary from "./Summary";

/**
 * A fresh game is five photos the player hasn't seen lately; the Daily Five is shared by all; a
 * tier game is a fresh game drawn from one difficulty third (src/lib/game/tiers.ts).
 */
export type GameMode =
  | { kind: "daily"; day: string }
  | { kind: "fresh"; game: number }
  | { kind: "tier"; tier: Tier; game: number };

export function modeTitle(mode: GameMode): string {
  if (mode.kind === "fresh") return "Fresh game";
  if (mode.kind === "tier") return `${TIER_NAMES[mode.tier]} game`;
  const label = new Date(`${mode.day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return `Daily Five, ${label}`;
}

type GameProps = {
  /**
   * The photos this site can deal (only those Atlas has guessed, src/lib/game/playable.ts).
   * Their records are fetched five at a time as games are dealt.
   */
  deck: Deck;
  /** Base URL of the FastAPI backend. Without one, rounds are played from the bundled catalog. */
  apiUrl?: string;
  /** Which game a visit opens on. Defaults to `?daily` in the URL, otherwise a fresh game. */
  start?: GameMode["kind"];
  /** For tests: the date that decides the Daily Five. Defaults to now, read in the browser. */
  today?: Date;
  /** For tests: supply the backend directly. */
  backendFor?: (photos: CatalogPhoto[]) => GameBackend;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
};

/** True when the page URL asks for the Daily Five (`?daily`). */
function urlWantsDaily(): boolean {
  return new URLSearchParams(window.location.search).has("daily");
}

/** The tier the page URL asks for (`?tier=hard`), if it names one. */
function urlTier(): Tier | null {
  const tier = new URLSearchParams(window.location.search).get("tier");
  return isTier(tier) ? tier : null;
}

/** Keep the address bar in step with the mode, so a shared link opens the same kind of game. */
function syncUrl(mode: GameMode) {
  const url = new URL(window.location.href);
  if (mode.kind === "daily") url.searchParams.set("daily", "");
  else url.searchParams.delete("daily");
  if (mode.kind === "tier") url.searchParams.set("tier", mode.tier);
  else url.searchParams.delete("tier");
  const next = `${url.pathname}${url.search.replace(/daily=(?=&|$)/, "daily")}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, "", next);
  }
}

/** "Any level" or one tier; picking one deals a new game from it. */
function TierPicker({
  tiers,
  value,
  onPick,
}: {
  tiers: Tiers;
  value: Tier | null;
  onPick: (tier: Tier | null) => void;
}) {
  return (
    <select
      aria-label="Difficulty: how hard it was for Atlas"
      title="Difficulty: how hard each photo was for Atlas"
      value={value ?? "any"}
      onChange={(e) => onPick(isTier(e.target.value) ? e.target.value : null)}
      className="pointer-events-auto rounded-full border border-chalk/30 bg-ocean-deep/60 py-1 pl-3 pr-1 text-xs font-semibold text-chalk backdrop-blur transition hover:border-chalk"
    >
      <option value="any">Any level</option>
      {TIERS.map((tier) => (
        <option key={tier} value={tier} title={tierBlurb(tier, tiers)}>
          {TIER_NAMES[tier]}
        </option>
      ))}
    </select>
  );
}

export default function Game({ apiUrl, deck, start, today, backendFor, loadRecords }: GameProps) {
  // Tiers choose which photos a game deals, so they only exist when the browser deals them.
  const tiers = apiUrl ? null : deck.tiers;
  // The mode is decided in the browser after hydration: the URL, today's date and the photos
  // this browser played recently are all unknown when the static page is built.
  const [mode, setMode] = useState<GameMode | null>(null);
  const [state, dispatch] = useReducer(gameReducer, initialState);
  // The first-visit card. Browser storage is only readable after hydration, so it starts closed.
  const [introOpen, setIntroOpen] = useState(false);
  // The player's record against Atlas, updated once as each game ends (see `next` below).
  const [record, setRecord] = useState<PlayerRecord | null>(null);

  useEffect(() => {
    if (mode) return;
    const id = requestAnimationFrame(() => {
      const kind = start ?? (urlWantsDaily() ? "daily" : "fresh");
      const tier = kind === "fresh" && tiers ? urlTier() : null;
      setIntroOpen(!hasSeenIntro());
      setMode(
        kind === "daily"
          ? { kind: "daily", day: dayKey(today ?? new Date()) }
          : tier
            ? { kind: "tier", tier, game: 1 }
            : { kind: "fresh", game: 1 },
      );
    });
    return () => cancelAnimationFrame(id);
  }, [mode, start, today, tiers]);

  const pool = useMemo(() => deck.ids.map((id) => ({ id })), [deck.ids]);

  // Each fresh game is drawn once per mode change and avoids the photos played lately; a tier
  // game does the same within its third of the catalog.
  const dealt = useMemo(() => {
    if (!mode) return [];
    const picked =
      mode.kind === "daily"
        ? pickDaily(pool, mode.day, ROUNDS_PER_GAME)
        : mode.kind === "tier" && tiers
          ? pickFresh(
              tiers[mode.tier].ids.map((id) => ({ id })),
              loadRecent(),
              ROUNDS_PER_GAME,
            )
          : pickFresh(pool, loadRecent(), ROUNDS_PER_GAME);
    return picked.map((p) => p.id);
  }, [mode, pool, tiers]);

  // Remember what was dealt, so the next visit or fresh game opens on other photos.
  useEffect(() => {
    if (dealt.length === 0) return;
    const limit = Math.max(0, pool.length - ROUNDS_PER_GAME);
    saveRecent(rememberPlayed(loadRecent(), dealt, limit));
  }, [dealt, pool]);

  // Records fetched so far, by photo id: the photo, its size and Atlas's guess.
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const load = useCallback(
    (ids: string[]) => (loadRecords ? loadRecords(ids) : fetchRecords(deck, ids)),
    [deck, loadRecords],
  );
  const remember = useCallback((loaded: GameRecord[]) => {
    setRecords((known) => {
      const next = new Map(known);
      for (const r of loaded) next.set(r.photo.id, r);
      return next;
    });
  }, []);

  // A local game needs its five records before the first round; fetch them as soon as dealt.
  useEffect(() => {
    if (apiUrl || dealt.length === 0) return;
    let cancelled = false;
    load(dealt)
      .then((loaded) => !cancelled && remember(loaded))
      .catch((err: Error) => !cancelled && dispatch({ type: "failed", message: err.message }));
    return () => {
      cancelled = true;
    };
  }, [apiUrl, dealt, load, remember]);

  const gamePhotos = useMemo<CatalogPhoto[] | null>(() => {
    if (dealt.length === 0 || dealt.some((id) => !records.has(id))) return null;
    return dealt.map((id) => records.get(id)!.photo);
  }, [dealt, records]);

  useEffect(() => {
    if (mode) syncUrl(mode);
  }, [mode]);

  const backend = useMemo<GameBackend | null>(() => {
    if (!mode) return null;
    if (apiUrl && !backendFor) return new ApiBackend(apiUrl);
    if (!gamePhotos) return null;
    return backendFor ? backendFor(gamePhotos) : new LocalBackend(gamePhotos);
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
    const next = gamePhotos?.[state.index + 1];
    if (next) new Image().src = next.imageUrl;
  }, [state, backend, gamePhotos]);

  // The API deals its own photos: fetch each round's record for its size and, from an older
  // server that leaves Atlas to the client, Atlas's guess. Best effort; the round plays without.
  const roundId = state.phase === "guessing" ? state.round.photo.id : null;
  useEffect(() => {
    if (!apiUrl || !roundId || records.has(roundId) || !deck.ids.includes(roundId)) return;
    load([roundId])
      .then(remember)
      .catch(() => {});
  }, [apiUrl, roundId, records, deck.ids, load, remember]);

  // The player's first tap (or key press) on the photo or the globe dismisses the card for good.
  // It listens in the capture phase and never stops the event, so that tap still zooms or pins.
  // Only attached while the card is open.
  const dismissIntro = useCallback(() => {
    markIntroSeen();
    setIntroOpen(false);
  }, []);

  const onPinChange = useCallback((pin: LngLat) => dispatch({ type: "pinned", pin }), []);

  async function submit() {
    if (state.phase !== "guessing" || !state.pin || state.submitting || !backend) return;
    dispatch({ type: "submitted" });
    try {
      const reveal = await backend.guess(state.round.roundId, state.pin);
      // The server's word on Atlas wins; otherwise use the guesses bundled with the site.
      const atlasGuess =
        reveal.atlas !== undefined
          ? reveal.atlas
          : (records.get(state.round.photo.id)?.atlas ?? null);
      dispatch({ type: "revealed", reveal, atlas: atlasGuess });
    } catch (err) {
      dispatch({ type: "failed", message: (err as Error).message });
    }
  }

  async function takeHint() {
    if (state.phase !== "guessing" || state.hinting || state.submitting || !backend) return;
    if (state.clues.length >= state.round.hintsAvailable) return;
    dispatch({ type: "hintRequested" });
    try {
      dispatch({ type: "hinted", clues: await backend.hint(state.round.roundId) });
    } catch (err) {
      dispatch({ type: "failed", message: (err as Error).message });
    }
  }

  /** Next photo, or the summary after the last round: that is when the game joins the record. */
  function next() {
    if (state.phase === "revealed" && state.index + 1 >= ROUNDS_PER_GAME && mode) {
      const t = totals(state.results);
      setRecord(
        recordGame({
          score: t.player,
          roundsVsAtlas: t.atlasRounds,
          roundsWon: t.playerWins,
          daily: mode.kind === "daily" ? mode.day : null,
        }),
      );
    }
    dispatch({ type: "next" });
  }

  /** Another game of the same kind: a tier game stays in its tier, the Daily Five goes fresh. */
  function playFresh() {
    setMode((m) =>
      m?.kind === "tier"
        ? { ...m, game: m.game + 1 }
        : { kind: "fresh", game: m?.kind === "fresh" ? m.game + 1 : 1 },
    );
    dispatch({ type: "restart" });
  }

  /** A new game from one tier, or from the whole catalog for "Any level". */
  function playTier(tier: Tier | null) {
    setMode((m) => {
      const game = m && m.kind !== "daily" ? m.game + 1 : 1;
      return tier ? { kind: "tier", tier, game } : { kind: "fresh", game };
    });
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
        playAgainLabel={
          mode?.kind === "tier" ? `Play another ${TIER_NAMES[mode.tier]} game` : undefined
        }
        onPlayDaily={mode?.kind === "daily" ? undefined : playDaily}
        record={record}
        today={today ?? new Date()}
        onResetRecord={() => setRecord(resetRecord())}
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
  const roundSize = round ? records.get(round.photo.id)?.photo : undefined;
  const clues = state.phase === "guessing" ? state.clues : [];
  const hintsLeft = state.phase === "guessing" ? state.round.hintsAvailable - clues.length : 0;

  return (
    <main
      className="wb-stage relative h-dvh w-full overflow-hidden bg-ocean-deep"
      data-phase={state.phase}
    >
      <h1 className="sr-only">{`Whereabout: ${title}, round ${roundNumber} of ${ROUNDS_PER_GAME}`}</h1>

      <div
        className="wb-photo"
        onPointerDownCapture={introOpen ? dismissIntro : undefined}
        onKeyDownCapture={introOpen ? dismissIntro : undefined}
      >
        {round ? (
          <PhotoViewer
            src={round.photo.imageUrl}
            roundKey={round.roundId}
            width={roundSize?.width}
            height={roundSize?.height}
          />
        ) : (
          <div
            className="wb-photo-placeholder h-full w-full"
            data-photo-placeholder="showing"
            aria-hidden="true"
          />
        )}
        {introOpen && state.phase !== "revealed" && (
          // Taps pass straight through the card to the photo underneath.
          <div className="wb-intro pointer-events-none absolute inset-x-4 top-1/2 z-10 mx-auto max-w-xs -translate-y-1/2 rounded-2xl border border-chalk/20 bg-ocean-deep/80 px-4 py-3 text-center shadow-lg backdrop-blur md:top-[55%]">
            <p className="font-sign text-xl font-bold leading-tight">{INTRO_TEXT.title}</p>
            <p className="mt-1 text-sm text-chalk-dim">{INTRO_TEXT.body}</p>
          </div>
        )}
      </div>

      <header className="wb-header pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 px-4 pt-4 md:px-6">
        {/* Only the controls take taps: on a phone this column spans the photo, and its empty
            space must not swallow taps meant for the photo's own buttons underneath. */}
        <div className="min-w-0">
          <p className="font-sign text-3xl font-extrabold leading-none tracking-tight md:text-4xl">
            Whereabout
          </p>
          <p className="mt-1 text-sm text-chalk-dim">{title}</p>
          {mode?.kind === "tier" && tiers && (
            <p className="mt-1 inline-block rounded-full bg-ocean-deep/60 px-2 py-0.5 text-[11px] text-chalk-dim backdrop-blur">
              {tierBlurb(mode.tier, tiers)}
            </p>
          )}
          {mode && (
            <div className="mt-2 flex items-center gap-1.5">
              <button
                type="button"
                onClick={mode.kind === "daily" ? playFresh : playDaily}
                className="pointer-events-auto shrink-0 rounded-full border border-chalk/30 bg-ocean-deep/60 px-3 py-1 text-xs font-semibold backdrop-blur transition hover:border-chalk"
              >
                {mode.kind === "daily" ? "New random game" : "Play the Daily Five"}
              </button>
              {tiers && (
                <TierPicker
                  tiers={tiers}
                  value={mode.kind === "tier" ? mode.tier : null}
                  onPick={playTier}
                />
              )}
            </div>
          )}
          {state.phase !== "revealed" && (
            <Link
              href="/you"
              className="wb-try-atlas pointer-events-auto mt-2 flex max-w-60 items-center gap-2 rounded-full md:mt-3 md:gap-2.5 md:rounded-2xl border border-sonar/40 bg-ocean-deep/70 py-1 pl-1 pr-3 backdrop-blur transition hover:border-sonar md:px-3 md:py-2"
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

      <div
        className="wb-globe-panel z-10"
        data-pinned={pin ? "true" : "false"}
        onPointerDownCapture={introOpen ? dismissIntro : undefined}
        onKeyDownCapture={introOpen ? dismissIntro : undefined}
      >
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
            {clues.length > 0 && (
              <div className="mb-2" aria-live="polite">
                <ol aria-label="Hints" className="flex flex-wrap gap-1.5">
                  {clues.map((clue) => (
                    <li
                      key={clue.kind}
                      className="rounded-full border border-gold/50 bg-ocean-deep/70 px-3 py-1 text-xs text-gold backdrop-blur"
                    >
                      {clue.text}
                    </li>
                  ))}
                </ol>
                <p className="mt-1 inline-block rounded-full bg-ocean-deep/70 px-2 py-0.5 text-[11px] text-chalk-dim backdrop-blur">
                  This round is now worth up to {formatPoints(maxPoints(clues.length))} points.
                </p>
              </div>
            )}
            <div className="flex gap-2">
              {hintsLeft > 0 && state.phase === "guessing" && (
                <button
                  type="button"
                  onClick={takeHint}
                  disabled={state.hinting || state.submitting}
                  aria-label={`Take a hint: the round will be worth up to ${formatPoints(maxPoints(clues.length + 1))} points`}
                  className="shrink-0 rounded-full border border-gold/60 bg-ocean-deep/60 px-4 py-3 text-sm font-semibold text-gold backdrop-blur transition enabled:hover:border-gold disabled:cursor-wait disabled:opacity-60"
                >
                  Hint{" "}
                  <span className="tabular font-normal text-chalk-dim">
                    −{formatPoints(maxPoints(clues.length) - maxPoints(clues.length + 1))}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={submit}
                disabled={
                  state.phase !== "guessing" || !state.pin || state.submitting || state.hinting
                }
                className="min-w-0 flex-1 rounded-full bg-flare px-4 py-3 font-semibold text-ocean-deep transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-chalk/15 disabled:text-chalk-dim"
              >
                {state.phase === "guessing" && state.submitting
                  ? "Checking…"
                  : state.phase === "guessing" && state.pin
                    ? "Guess here"
                    : "Place your pin on the globe"}
              </button>
            </div>
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
            onNext={next}
          />
        </div>
      )}
    </main>
  );
}
