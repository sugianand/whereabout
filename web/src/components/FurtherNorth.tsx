"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { isShortcut } from "@/lib/controls";
import { seededShuffle } from "@/lib/game/daily";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import {
  TIE_DEGREES,
  formatLatitude,
  initialNorth,
  loadBestNorth,
  northOver,
  northReducer,
  rememberNorth,
  type NorthVerdict,
  type Side,
} from "@/lib/game/furtherNorth";
import { formatDistance } from "@/lib/geo";
import { placeholderUrl, sources } from "@/lib/photoSources";
import type { Units } from "@/lib/units";
import { useUnits } from "@/lib/useUnits";

import ControlsHelp from "./ControlsHelp";
import UnitsSwitch from "./UnitsSwitch";

type FurtherNorthProps = {
  deck: Deck;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that shuffles each run. */
  random?: () => number;
};

const SIDES: readonly Side[] = ["a", "b"];
const number = (side: Side) => (side === "a" ? 1 : 2);

/** "1 pair", "4 pairs". */
function pairs(n: number): string {
  return `${n} pair${n === 1 ? "" : "s"}`;
}

/**
 * Further North (src/lib/game/furtherNorth.ts): two photos, pick the one taken further north.
 * A right pick keeps the second photo and deals a new one beside it; the first wrong pick ends
 * the run.
 */
export default function FurtherNorth({ deck, loadRecords, random }: FurtherNorthProps) {
  const [state, dispatch] = useReducer(northReducer, initialNorth);
  const [best, setBest] = useState(0);
  // The best before this run, so the end card can say when it was beaten.
  const [bestBeforeRun, setBestBeforeRun] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const units = useUnits();

  const start = useCallback(() => {
    const seed = Math.floor((random ?? Math.random)() * 2 ** 32);
    const stored = loadBestNorth();
    setBest(stored);
    setBestBeforeRun(stored);
    dispatch({ type: "start", order: seededShuffle(deck.ids, seed) });
  }, [deck.ids, random]);

  // The order is shuffled in the browser after hydration, never at build time.
  useEffect(() => {
    const id = requestAnimationFrame(start);
    return () => cancelAnimationFrame(id);
  }, [start]);

  const load = useCallback(
    (ids: string[]) => (loadRecords ? loadRecords(ids) : fetchRecords(deck, ids)),
    [deck, loadRecords],
  );

  // The pair on screen and the photo dealt after it, so the next pair opens without waiting.
  const wanted = useMemo(() => {
    if (state.phase !== "picking" && state.phase !== "answered") return [];
    return state.order.slice(state.index, state.index + 3);
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

  const playing = state.phase === "picking" || state.phase === "answered" ? state : null;
  const pair = playing
    ? ([
        records.get(playing.order[playing.index]),
        records.get(playing.order[playing.index + 1]),
      ] as const)
    : ([undefined, undefined] as const);
  const [recA, recB] = pair;
  const upcoming = playing ? records.get(playing.order[playing.index + 2] ?? "") : undefined;

  // Warm the cache with the photo dealt next while the player reads the answer.
  useEffect(() => {
    if (upcoming) new Image().src = sources(upcoming.photo).src;
  }, [upcoming]);

  const answered = state.phase === "answered" ? state : null;
  const over = northOver(state);
  const ready = state.phase === "picking" && recA !== undefined && recB !== undefined;

  const choose = useCallback(
    (side: Side) => {
      if (state.phase !== "picking" || !recA || !recB) return;
      const action = {
        type: "picked",
        side,
        latA: recA.photo.lat,
        latB: recB.photo.lat,
        atlasA: recA.atlas?.lat ?? null,
        atlasB: recB.atlas?.lat ?? null,
      } as const;
      // Keep the streak as the best after every right pick, so leaving mid-run keeps it.
      const after = northReducer(state, action);
      if (after.phase === "answered" && after.verdict.correct) setBest(rememberNorth(after.streak));
      dispatch(action);
    },
    [state, recA, recB],
  );

  // 1 and 2 pick a photo from the keyboard.
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e)) return;
      if (e.key === "1") choose("a");
      else if (e.key === "2") choose("b");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, choose]);

  const streak = state.phase === "idle" ? 0 : state.streak;

  if (state.phase === "cleared") {
    const none = state.order.length < 2;
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
        <p className="text-sm text-gold">Further North</p>
        <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
          {none ? "No photos to play yet" : "You called every pair"}
        </h1>
        <p className="mt-4 text-lg text-chalk-dim">
          {none
            ? "Further North needs at least two photos to deal."
            : `${pairs(state.streak)} in a row, every photo the game has.`}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          {!none && (
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

  return (
    <main
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-ocean-deep"
      data-phase={answered ? "revealed" : "picking"}
    >
      <h1 className="sr-only">{`Whereabout: Further North, streak ${streak}`}</h1>

      <header className="flex items-start justify-between gap-4 px-4 pb-2 pt-4 md:px-6">
        <div className="min-w-0">
          <Link
            href="/"
            className="font-sign text-3xl font-extrabold leading-none tracking-tight md:text-4xl"
          >
            Whereabout
          </Link>
          <p className="mt-1 text-sm text-chalk-dim">
            Further North: which photo was taken further north?
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          <ControlsHelp screen="further-north" />
          <dl className="text-right">
            <dt className="text-sm text-chalk-dim">Streak</dt>
            <dd className="font-sign tabular text-3xl font-bold leading-none" aria-live="polite">
              {streak}
            </dd>
            <div className="mt-1 flex justify-end gap-1.5 text-sm text-chalk-dim">
              <dt>Best</dt>
              <dd className="tabular">{best}</dd>
            </div>
          </dl>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-2 gap-2 px-2 pb-2 md:grid-cols-2 md:grid-rows-1 md:gap-3 md:px-6 md:pb-6">
        {SIDES.map((side) => (
          <PhotoChoice
            key={side}
            side={side}
            record={side === "a" ? recA : recB}
            ready={ready}
            verdict={answered?.verdict ?? null}
            onPick={choose}
          />
        ))}
      </div>

      {error && (
        <p role="alert" className="absolute inset-x-4 bottom-4 text-center text-sm text-flare">
          {error}
        </p>
      )}

      {answered && recA && recB && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-3 md:p-6">
          <NorthCard
            key={answered.index}
            verdict={answered.verdict}
            atlas={answered.atlas}
            places={[recA.photo.place, recB.photo.place]}
            lats={[recA.photo.lat, recB.photo.lat]}
            streak={answered.streak}
            atlasTally={[answered.atlasRight, answered.atlasPlayed]}
            units={units}
            over={over}
            best={best}
            newBest={over && answered.streak > bestBeforeRun}
            onNext={over ? start : () => dispatch({ type: "next" })}
          />
        </div>
      )}
    </main>
  );
}

function PhotoChoice({
  side,
  record,
  ready,
  verdict,
  onPick,
}: {
  side: Side;
  record: GameRecord | undefined;
  ready: boolean;
  verdict: NorthVerdict | null;
  onPick: (side: Side) => void;
}) {
  const n = number(side);
  const photo = record?.photo;
  const src = photo ? sources(photo) : null;
  const blur = photo ? placeholderUrl(photo.imageUrl) : null;
  const north = verdict !== null && verdict.north === side;
  const picked = verdict !== null && verdict.picked === side;
  const ring = !verdict
    ? "border-graticule hover:border-gold focus-visible:border-gold"
    : picked
      ? verdict.correct
        ? "border-sonar"
        : "border-flare"
      : "border-graticule";

  return (
    <div
      className={`relative min-h-0 overflow-hidden rounded-2xl border-2 bg-graticule/40 transition-colors ${ring}`}
      data-testid={`north-photo-${n}`}
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
          sizes="(min-width: 768px) 50vw, 100vw"
          alt={`Photo ${n}`}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <span className="absolute left-2 top-2 rounded-full bg-ocean-deep/85 px-2.5 py-0.5 font-sign text-lg font-extrabold">
        {n}
      </span>
      {verdict && photo ? (
        <div className="absolute inset-x-2 top-2 ml-9 flex flex-wrap items-center justify-end gap-1.5 text-right">
          {north && (
            <span className="rounded-full bg-gold px-2.5 py-0.5 text-sm font-semibold text-ocean-deep">
              {verdict.tie ? "North by a hair" : "Further north"}
            </span>
          )}
          <span className="max-w-full truncate rounded-full bg-ocean-deep/85 px-2.5 py-0.5 text-sm">
            {photo.place} · <span className="tabular">{formatLatitude(photo.lat)}</span>
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onPick(side)}
          disabled={!ready}
          aria-label={`Photo ${n} was taken further north`}
          aria-keyshortcuts={String(n)}
          className="absolute inset-0 flex items-end justify-center p-3 outline-none disabled:cursor-wait"
        >
          <span className="rounded-full bg-gold px-5 py-2.5 font-semibold text-ocean-deep shadow-lg">
            {`Photo ${n} is further north`}
          </span>
        </button>
      )}
      {photo && (
        <a
          href={photo.credit.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className={`absolute bottom-1 right-2 max-w-[60%] truncate text-[11px] text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk ${verdict ? "" : "hidden md:block"}`}
        >
          Photo: {photo.credit.author}, {photo.credit.license}
        </a>
      )}
    </div>
  );
}

/** Where the two photos sit between the poles: south on the left, north on the right. */
function LatitudeScale({ lats }: { lats: readonly [number, number] }) {
  const x = (lat: number) => ((lat + 90) / 180) * 100;
  return (
    <div className="mt-3" aria-hidden="true">
      <div className="relative h-7">
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-chalk/20" />
        <div className="absolute top-1 h-5 w-px bg-chalk/40" style={{ left: "50%" }} />
        {lats.map((lat, i) => (
          <span
            key={i}
            className={`absolute top-1/2 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full font-sign text-sm font-extrabold text-ocean-deep ${i === 0 ? "bg-gold" : "bg-sonar"}`}
            style={{ left: `${x(lat)}%` }}
          >
            {i + 1}
          </span>
        ))}
      </div>
      <div className="flex justify-between text-xs text-chalk-dim">
        <span>South Pole</span>
        <span>Equator</span>
        <span>North Pole</span>
      </div>
    </div>
  );
}

function NorthCard({
  verdict,
  atlas,
  places,
  lats,
  streak,
  atlasTally,
  units,
  over,
  best,
  newBest,
  onNext,
}: {
  verdict: NorthVerdict;
  atlas: NorthVerdict | null;
  places: readonly [string, string];
  lats: readonly [number, number];
  streak: number;
  atlasTally: readonly [number, number];
  units: Units;
  over: boolean;
  best: number;
  newBest: boolean;
  onNext: () => void;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);
  const northPlace = places[verdict.north === "a" ? 0 : 1];
  const southPlace = places[verdict.north === "a" ? 1 : 0];
  const apart = formatDistance(verdict.apartKm, units);
  const [atlasRight, atlasPlayed] = atlasTally;

  return (
    <section
      aria-labelledby="north-verdict"
      className="pointer-events-auto w-full max-w-md rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-4 shadow-2xl md:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="north-verdict"
          className={`font-sign text-3xl font-extrabold leading-tight ${verdict.correct ? "text-sonar" : "text-flare"}`}
        >
          {verdict.tie ? "Too close to call" : verdict.correct ? "Right" : "Wrong"}
        </h2>
        <UnitsSwitch />
      </div>
      <p className="mt-1 text-chalk">
        {verdict.tie
          ? `Only ${apart} apart north to south, under ${TIE_DEGREES}° of latitude, so either pick counts.`
          : `${northPlace} is ${apart} further north than ${southPlace}.`}
      </p>
      <LatitudeScale lats={lats} />
      {atlas && (
        <p className="mt-2 text-sm text-chalk-dim">
          {`Atlas picked photo ${number(atlas.picked)}${atlas.correct ? " and got it" : ", wrong"}. `}
          {`Atlas this run: ${atlasRight} of ${pairs(atlasPlayed)}.`}
        </p>
      )}
      {over && (
        <p className="mt-2 text-chalk">
          {`Run over: ${pairs(streak)} in a row. `}
          {newBest ? "That's your new best!" : best > 0 ? `Your best is ${pairs(best)}.` : ""}
        </p>
      )}
      <button
        ref={nextRef}
        type="button"
        onClick={onNext}
        className="mt-3 rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
      >
        {over ? "Start a new run" : "Next pair"}
      </button>
    </section>
  );
}
