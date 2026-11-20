"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { ROUND_KEYS, isShortcut } from "@/lib/controls";
import {
  BULLSEYE_PHOTOS,
  PHOTO_POINTS,
  RINGS,
  atlasBullseyeTotal,
  betLine,
  bullseyeAtlasLine,
  bullseyeReducer,
  bullseyeTotal,
  initialBullseye,
  loadBestBullseye,
  rememberBullseye,
  ringName,
  ringsHeld,
  type BullseyeRound,
} from "@/lib/game/bullseye";
import { seededShuffle } from "@/lib/game/daily";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import { formatDistance, formatPoints, type LngLat } from "@/lib/geo";
import type { RevealView, RingMark } from "@/lib/reveal";
import type { Units } from "@/lib/units";
import { useUnits } from "@/lib/useUnits";

import ControlsHelp from "./ControlsHelp";
import GamesMenu from "./GamesMenu";
import Globe from "./Globe";
import PhotoViewer from "./PhotoViewer";
import UnitsSwitch from "./UnitsSwitch";

type BullseyeProps = {
  deck: Deck;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that shuffles each game. */
  random?: () => number;
};

/** The ring keys, 1 for the tightest. */
const RING_KEYS = RINGS.map((_, i) => String(i + 1));

/**
 * The bet: one button per ring, tightest first, each with what it pays. A radio group, so the
 * arrow keys move along it once it has focus, and 1 to 4 pick a ring from anywhere.
 */
function RingPicker({
  ring,
  units,
  disabled,
  onPick,
}: {
  ring: number;
  units: Units;
  disabled: boolean;
  onPick: (ring: number) => void;
}) {
  return (
    <fieldset className="mb-2" disabled={disabled}>
      <legend className="mb-1 text-sm text-chalk-dim">Your ring: the tighter, the more it pays</legend>
      <div className="grid grid-cols-4 gap-1.5">
        {RINGS.map((r, i) => {
          const picked = i === ring;
          return (
            <label
              key={r.km}
              className={`flex cursor-pointer flex-col items-center rounded-xl border px-1 py-1.5 text-center transition has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-gold ${
                picked
                  ? "border-flare bg-flare/15 text-chalk"
                  : "border-chalk/25 text-chalk-dim hover:border-chalk/60"
              }`}
            >
              <input
                type="radio"
                name="bullseye-ring"
                value={i}
                checked={picked}
                onChange={() => onPick(i)}
                className="sr-only"
              />
              <span className="tabular text-sm font-semibold leading-tight">
                {formatDistance(r.km, units)}
              </span>
              <span className="tabular text-xs leading-tight">{formatPoints(r.points)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Bullseye (src/lib/game/bullseye.ts): pin each photo and bet a ring around the pin; a photo
 * inside the ring scores the ring's points, the tightest paying most. Five photos against
 * Atlas's own bets, its ring picked from its own confidence.
 */
export default function Bullseye({ deck, loadRecords, random }: BullseyeProps) {
  const [state, dispatch] = useReducer(bullseyeReducer, initialBullseye);
  const [best, setBest] = useState(0);
  // The best before this game, so the end screen can say when it was beaten.
  const [bestBefore, setBestBefore] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const units = useUnits();

  const start = useCallback(() => {
    const stored = loadBestBullseye();
    setBest(stored);
    setBestBefore(stored);
    const seed = Math.floor((random ?? Math.random)() * 2 ** 32);
    dispatch({ type: "start", order: seededShuffle(deck.ids, seed).slice(0, BULLSEYE_PHOTOS) });
  }, [deck.ids, random]);

  // The order is shuffled in the browser after hydration, never at build time.
  useEffect(() => {
    const id = requestAnimationFrame(() => start());
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
  const pickRing = useCallback((ring: number) => dispatch({ type: "ring", ring }), []);

  const placeBet = useCallback(() => {
    if (!guessing?.pin || !current) return;
    const { photo, atlas } = current;
    dispatch({
      type: "bet",
      truth: photo,
      atlas: atlas ? { lng: atlas.lng, lat: atlas.lat, confidence: atlas.confidence } : null,
    });
  }, [current, guessing]);

  const next = useCallback(() => {
    const after = bullseyeReducer(state, { type: "next" });
    if (after.phase === "finished") setBest(rememberBullseye(bullseyeTotal(after.results)));
    dispatch({ type: "next" });
  }, [state]);

  // G bets from anywhere on the screen, like a round's guess; 1 to 4 pick a ring.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e)) return;
      const key = e.key.toLowerCase();
      if (key === ROUND_KEYS.guess) {
        e.preventDefault();
        placeBet();
        return;
      }
      const ring = RING_KEYS.indexOf(key);
      if (ring >= 0 && guessing) {
        e.preventDefault();
        pickRing(ring);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guessing, pickRing, placeBet]);

  const reveal = useMemo<RevealView | null>(() => {
    if (!answered || !current) return null;
    const guesses: RevealView["guesses"] = [{ actor: "player", at: answered.round.you.at }];
    if (answered.round.atlas) guesses.push({ actor: "atlas", at: answered.round.atlas.at });
    return { truth: current.photo, guesses };
  }, [answered, current]);

  // The bet as a ring on the globe: the player's around the pin while guessing, and both at the
  // answer, so it shows at a glance whose ring the photo fell in.
  const pin = guessing?.pin ?? answered?.round.you.at ?? null;
  const ringKm = RINGS[guessing?.ring ?? answered?.round.you.ring ?? 0]!.km;
  const atlasBet = answered?.round.atlas ?? null;
  const rings = useMemo<RingMark[]>(() => {
    const marks: RingMark[] = [];
    if (pin) marks.push({ actor: "player", center: pin, km: ringKm });
    if (atlasBet) marks.push({ actor: "atlas", center: atlasBet.at, km: RINGS[atlasBet.ring]!.km });
    return marks;
  }, [pin, ringKm, atlasBet]);

  if (state.phase === "finished") {
    const total = bullseyeTotal(state.results);
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
  const of = playing?.order.length ?? BULLSEYE_PHOTOS;
  const atlas = atlasBullseyeTotal(results);
  const ring = guessing?.ring ?? answered?.ring ?? 0;

  return (
    <main
      className="wb-stage relative h-dvh w-full overflow-hidden bg-ocean-deep"
      data-phase={answered ? "revealed" : "guessing"}
      data-photo={current?.photo.id}
    >
      <h1 className="sr-only">{`Whereabout: Bullseye, photo ${(playing?.index ?? 0) + 1} of ${of}`}</h1>

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
            {`Bullseye: photo ${(playing?.index ?? 0) + 1} of ${of}`}
          </p>
          <div className="pointer-events-auto mt-2 flex items-center gap-2">
            <GamesMenu screen="bullseye" streakHref="/streak" />
            <ControlsHelp screen="bullseye" />
          </div>
        </div>
        <div className="pointer-events-auto text-right">
          <dl>
            <dt className="text-sm text-chalk-dim">Score</dt>
            <dd
              className="font-sign tabular text-3xl font-bold leading-none"
              aria-live="polite"
              data-testid="bullseye-score"
            >
              {formatPoints(bullseyeTotal(results))}
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

      <div ref={panelRef} className="wb-globe-panel z-10" data-pinned={guessing?.pin ? "true" : "false"}>
        <div className="wb-globe-frame">
          <Globe
            pin={pin}
            rings={rings}
            onPinChange={onPinChange}
            disabled={!guessing || !current}
            reveal={reveal}
            className="h-full"
          />
        </div>
        {!answered && (
          <div className="wb-guess-bar">
            <RingPicker ring={ring} units={units} disabled={!guessing} onPick={pickRing} />
            <button
              type="button"
              onClick={placeBet}
              disabled={!guessing?.pin || !current}
              className="w-full rounded-full bg-flare px-4 py-3 font-semibold text-ocean-deep transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-chalk/15 disabled:text-chalk-dim"
            >
              {guessing?.pin
                ? `Bet ${ringName(ring, units)} for ${formatPoints(RINGS[ring]!.points)}`
                : "Tap the globe to pin the photo"}
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
          <BullseyeCard
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

function BullseyeCard({
  round,
  record,
  units,
  last,
  onNext,
}: {
  round: BullseyeRound;
  record: GameRecord;
  units: Units;
  last: boolean;
  onNext: () => void;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  const { credit, place } = record.photo;
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);
  const { you, atlas } = round;

  return (
    <section
      aria-labelledby="bullseye-answer"
      className="wb-card pointer-events-auto w-full max-w-md rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-4 shadow-2xl md:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <p className={`text-sm ${you.inside ? "text-sonar" : "text-flare"}`}>
          {you.inside ? "Inside your ring" : "Outside your ring"}
        </p>
        <UnitsSwitch />
      </div>
      <h2
        id="bullseye-answer"
        className="font-sign text-3xl font-extrabold leading-tight text-chalk md:text-5xl"
      >
        {formatPoints(you.score)} points
      </h2>
      <p className="mt-1 text-chalk-dim">{place}</p>
      <p className="mt-2 text-sm text-chalk" data-testid="bullseye-you">
        {`You: ${betLine(you, units)}`}
      </p>
      {atlas && (
        <p className="mt-1 text-sm text-chalk-dim" data-testid="bullseye-atlas">
          <span className="text-sonar">Atlas</span>
          {` (dashed ring): ${betLine(atlas, units)}`}
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
          className="min-w-0 truncate text-xs leading-6 text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk"
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
  results: readonly BullseyeRound[];
  best: number;
  newBest: boolean;
  units: Units;
  onAgain: () => void;
}) {
  const none = results.length === 0;
  const atlas = bullseyeAtlasLine(results);
  const held = ringsHeld(results);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-sm text-gold">Bullseye</p>
      <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
        {none ? "No photos to play yet" : `${formatPoints(bullseyeTotal(results))} points`}
      </h1>
      {!none && (
        <>
          <p className="mt-4 text-lg text-chalk-dim">
            {`Out of ${formatPoints(results.length * PHOTO_POINTS)}. Your rings held ${held} of ${results.length} photos. `}
            {newBest ? "That's your new best!" : best > 0 ? `Your best is ${formatPoints(best)}.` : ""}
          </p>
          {atlas && (
            <p className="mt-2 text-chalk" data-testid="bullseye-atlas-total">
              {atlas}
            </p>
          )}
          <ol className="mt-6 space-y-2" aria-label="Your photos">
            {results.map((r, i) => (
              <li key={r.id} className="flex items-baseline justify-between gap-4 text-sm">
                <span className="text-chalk-dim">
                  {`Photo ${i + 1}: ${r.you.inside ? "inside" : "outside"} ${ringName(r.you.ring, units)}, ${formatDistance(r.you.km, units)} off`}
                </span>
                <span className="tabular shrink-0 font-semibold">{formatPoints(r.you.score)}</span>
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
