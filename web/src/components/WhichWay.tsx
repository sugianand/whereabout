"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { isShortcut } from "@/lib/controls";
import { seededShuffle } from "@/lib/game/daily";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import {
  POINTS,
  POINT_KEYS,
  POINT_NAMES,
  flatBearing,
  formatBearing,
  initialWay,
  loadBestWay,
  pointHeading,
  pointOf,
  rememberWay,
  unfitPair,
  wayOver,
  wayReducer,
  type Point,
  type WayVerdict,
} from "@/lib/game/whichWay";
import { formatDistance, type LngLat } from "@/lib/geo";
import { placeholderUrl, sources } from "@/lib/photoSources";
import type { RevealView } from "@/lib/reveal";
import type { Units } from "@/lib/units";
import { useUnits } from "@/lib/useUnits";

import ControlsHelp from "./ControlsHelp";
import GamesMenu from "./GamesMenu";
import Globe from "./Globe";
import UnitsSwitch from "./UnitsSwitch";

type WhichWayProps = {
  deck: Deck;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that shuffles each run. */
  random?: () => number;
};

/** The compass's buttons on a three-by-three grid, north at the top; the middle is where you stand. */
const ROSE: readonly (Point | null)[] = ["NW", "N", "NE", "W", null, "E", "SW", "S", "SE"];

const ignorePin = () => {};

/** "1 stop", "4 stops". */
function stops(n: number): string {
  return `${n} stop${n === 1 ? "" : "s"}`;
}

const at = (r: GameRecord): LngLat => ({ lng: r.photo.lng, lat: r.photo.lat });
const atlasAt = (r: GameRecord): LngLat | null =>
  r.atlas ? { lng: r.atlas.lng, lat: r.atlas.lat } : null;

/**
 * Which way? (src/lib/game/whichWay.ts): photo 1 is where you stand, photo 2 where you're
 * headed; pick the compass point you'd set off in. The reveal draws the route on the globe. A
 * right pick travels on, photo 2 becoming where you stand; the first wrong pick ends the run.
 */
export default function WhichWay({ deck, loadRecords, random }: WhichWayProps) {
  const [state, dispatch] = useReducer(wayReducer, initialWay);
  const [best, setBest] = useState(0);
  const [bestBeforeRun, setBestBeforeRun] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const units = useUnits();

  const start = useCallback(() => {
    const seed = Math.floor((random ?? Math.random)() * 2 ** 32);
    const stored = loadBestWay();
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

  // The two photos on screen and the next stop, so the next question opens without waiting.
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
  const from = playing ? records.get(playing.order[playing.index]) : undefined;
  const to = playing ? records.get(playing.order[playing.index + 1]) : undefined;
  const upcoming = playing ? records.get(playing.order[playing.index + 2] ?? "") : undefined;

  // A stop in the same city, or nearly opposite on the planet, makes no fair heading: deal again.
  const unfit = state.phase === "picking" && !!from && !!to && unfitPair(at(from), at(to));
  useEffect(() => {
    if (unfit && to) dispatch({ type: "redeal", id: to.photo.id });
  }, [unfit, to]);

  useEffect(() => {
    if (upcoming) new Image().src = sources(upcoming.photo).src;
  }, [upcoming]);

  const answered = state.phase === "answered" ? state : null;
  const over = wayOver(state);
  const ready = state.phase === "picking" && !!from && !!to && !unfit;

  const choose = useCallback(
    (point: Point) => {
      if (state.phase !== "picking" || !from || !to || unfit) return;
      const action = {
        type: "picked",
        point,
        from: at(from),
        to: at(to),
        atlasFrom: atlasAt(from),
        atlasTo: atlasAt(to),
      } as const;
      // Keep the run as the best after every right pick, so leaving mid-run keeps it.
      const after = wayReducer(state, action);
      if (after.phase === "answered" && after.verdict.correct) setBest(rememberWay(after.streak));
      dispatch(action);
    },
    [state, from, to, unfit],
  );

  // The number pad's layout picks a point: 8 is north, 9 north-east, 2 south.
  useEffect(() => {
    if (!ready) return;
    const byKey = new Map(POINTS.map((p) => [POINT_KEYS[p], p]));
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e)) return;
      const point = byKey.get(e.key);
      if (point) choose(point);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, choose]);

  // The route: an arc from where you stand (pin 1) to where you were headed (the gold pin).
  const reveal = useMemo<RevealView | null>(
    () =>
      answered && from && to
        ? { truth: at(to), guesses: [{ actor: "player", at: at(from), label: "1" }] }
        : null,
    [answered, from, to],
  );

  const streak = state.phase === "idle" ? 0 : state.streak;

  if (state.phase === "cleared") {
    const none = state.order.length < 2;
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
        <p className="text-sm text-gold">Which way?</p>
        <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
          {none ? "No photos to play yet" : "You travelled the whole world"}
        </h1>
        <p className="mt-4 text-lg text-chalk-dim">
          {none
            ? "Which way? needs at least two photos to deal."
            : `${stops(state.streak)} in a row, every photo the game has.`}
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
      <h1 className="sr-only">{`Whereabout: Which way?, streak ${streak}`}</h1>

      {/* The globe waits under the photos and shows the route at each reveal. */}
      <div
        className="absolute inset-0 z-0 [&_#globe-pin-status]:sr-only"
        data-testid="way-globe"
        aria-hidden={answered ? undefined : true}
        inert={!answered}
      >
        <Globe pin={null} onPinChange={ignorePin} disabled reveal={reveal} className="h-full" />
      </div>

      <header
        className={`relative z-20 flex items-start justify-between gap-4 px-4 pb-2 pt-4 md:px-6 ${answered ? "bg-gradient-to-b from-ocean-deep via-ocean-deep/80 to-transparent" : ""}`}
      >
        <div className="min-w-0">
          <Link
            href="/"
            className="font-sign text-3xl font-extrabold leading-none tracking-tight md:text-4xl"
          >
            Whereabout
          </Link>
          <p className="mt-1 text-sm text-chalk-dim">
            Which way?: set off from photo 1 toward photo 2
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          <GamesMenu screen="which-way" streakHref="/streak" />
          <ControlsHelp screen="which-way" />
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

      {!answered && (
        <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-2 bg-ocean-deep px-2 pb-2 md:px-6 md:pb-6">
          <div className="grid min-h-0 flex-1 grid-rows-2 gap-2 md:grid-cols-2 md:grid-rows-1 md:gap-3">
            <WayPhoto n={1} record={from} caption="You are here" />
            <WayPhoto n={2} record={unfit ? undefined : to} caption="You're headed here" />
          </div>
          <Compass ready={ready} onPick={choose} />
        </div>
      )}

      {error && (
        <p role="alert" className="absolute inset-x-4 bottom-4 z-40 text-center text-sm text-flare">
          {error}
        </p>
      )}

      {answered && from && to && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-3 md:inset-x-auto md:bottom-6 md:left-6 md:p-0">
          <WayCard
            key={answered.index}
            verdict={answered.verdict}
            atlas={answered.atlas}
            km={answered.km}
            from={from}
            to={to}
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

function WayPhoto({
  n,
  record,
  caption,
}: {
  n: 1 | 2;
  record: GameRecord | undefined;
  caption: string;
}) {
  const photo = record?.photo;
  const src = photo ? sources(photo) : null;
  const blur = photo ? placeholderUrl(photo.imageUrl) : null;
  return (
    <figure
      className="relative m-0 min-h-0 overflow-hidden rounded-2xl border-2 border-graticule bg-graticule/40"
      data-testid={`way-photo-${n}`}
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
          alt={`Photo ${n}: ${caption.toLowerCase()}`}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <figcaption className="absolute left-2 top-2 flex items-center gap-1.5">
        <span
          className={`rounded-full px-2.5 py-0.5 font-sign text-lg font-extrabold ${n === 1 ? "bg-ocean-deep/85" : "bg-gold text-ocean-deep"}`}
        >
          {n}
        </span>
        <span className="rounded-full bg-ocean-deep/85 px-2.5 py-0.5 text-sm">{caption}</span>
      </figcaption>
      {photo && (
        <a
          href={photo.credit.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="absolute bottom-1 right-2 hidden max-w-[60%] truncate text-[11px] text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk md:block"
        >
          Photo: {photo.credit.author}, {photo.credit.license}
        </a>
      )}
    </figure>
  );
}

/** The eight points around where you stand; the number pad's keys pick them too. */
function Compass({ ready, onPick }: { ready: boolean; onPick: (point: Point) => void }) {
  return (
    <div
      role="group"
      aria-label="Which way from photo 1 to photo 2?"
      className="mx-auto grid shrink-0 grid-cols-3 gap-1.5"
      data-testid="way-compass"
    >
      {ROSE.map((point, i) =>
        point === null ? (
          <span
            key="here"
            aria-hidden="true"
            className="flex h-11 w-16 items-center justify-center rounded-full border border-graticule text-xs text-chalk-dim md:h-12 md:w-20"
          >
            from 1
          </span>
        ) : (
          <button
            key={point}
            type="button"
            onClick={() => onPick(point)}
            disabled={!ready}
            aria-label={`Headed ${POINT_NAMES[point]}`}
            aria-keyshortcuts={POINT_KEYS[point]}
            data-point={point}
            className={`h-11 w-16 rounded-full font-sign text-lg font-extrabold transition disabled:cursor-wait disabled:opacity-50 md:h-12 md:w-20 ${i % 2 === 1 ? "bg-gold text-ocean-deep enabled:hover:brightness-110" : "border-2 border-gold/70 text-gold enabled:hover:bg-gold/10"}`}
          >
            {point}
          </button>
        ),
      )}
    </div>
  );
}

/** A compass dial: the true heading as a gold needle, your pick's wedge, and Atlas's pick as a dot. */
function Dial({ verdict, atlas }: { verdict: WayVerdict; atlas: WayVerdict | null }) {
  const R = 30;
  const polar = (deg: number, r: number) => {
    const rad = (deg * Math.PI) / 180;
    return [36 + r * Math.sin(rad), 36 - r * Math.cos(rad)] as const;
  };
  const pick = pointHeading(verdict.picked);
  const [x1, y1] = polar(pick - 22.5, R);
  const [x2, y2] = polar(pick + 22.5, R);
  const [nx, ny] = polar(verdict.bearing, R - 3);
  return (
    <svg
      viewBox="0 0 72 72"
      className="h-16 w-16 shrink-0 md:h-[72px] md:w-[72px]"
      aria-hidden="true"
      data-testid="way-dial"
    >
      <circle cx="36" cy="36" r={R} fill="none" strokeWidth="2" className="stroke-chalk/25" />
      <path
        d={`M36 36 L${x1} ${y1} A${R} ${R} 0 0 1 ${x2} ${y2} Z`}
        className={verdict.correct ? "fill-sonar/35" : "fill-flare/40"}
      />
      {POINTS.map((p) => {
        const [tx, ty] = polar(pointHeading(p), R + 0.5);
        const [ix, iy] = polar(pointHeading(p), R - 4);
        return (
          <line
            key={p}
            x1={ix}
            y1={iy}
            x2={tx}
            y2={ty}
            strokeWidth="1.5"
            className="stroke-chalk/50"
          />
        );
      })}
      <text x="36" y="13" textAnchor="middle" fontSize="8" className="fill-chalk-dim">
        N
      </text>
      <line
        x1="36"
        y1="36"
        x2={nx}
        y2={ny}
        strokeWidth="3"
        strokeLinecap="round"
        className="stroke-gold"
      />
      <circle cx="36" cy="36" r="3" className="fill-gold" />
      {atlas && (
        <circle
          cx={polar(pointHeading(atlas.picked), R)[0]}
          cy={polar(pointHeading(atlas.picked), R)[1]}
          r="3.5"
          className="fill-sonar stroke-ocean-deep"
          strokeWidth="1"
        />
      )}
    </svg>
  );
}

function WayCard({
  verdict,
  atlas,
  km,
  from,
  to,
  streak,
  atlasTally,
  units,
  over,
  best,
  newBest,
  onNext,
}: {
  verdict: WayVerdict;
  atlas: WayVerdict | null;
  km: number;
  from: GameRecord;
  to: GameRecord;
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
  const truthName = POINT_NAMES[verdict.truth];
  const pickName = POINT_NAMES[verdict.picked];
  const route = `${to.photo.place} is ${truthName} of ${from.photo.place}: the shortest route sets off at ${formatBearing(verdict.bearing)}, ${formatDistance(km, units)} away.`;
  const flat = pointOf(flatBearing(at(from), at(to)));
  const [atlasRight, atlasPlayed] = atlasTally;

  return (
    <section
      aria-labelledby="way-verdict"
      className="pointer-events-auto max-h-[45dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-4 shadow-2xl md:max-h-[calc(100dvh-9rem)] md:w-[min(28rem,34vw)] md:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="way-verdict"
          className={`font-sign text-3xl font-extrabold leading-tight ${verdict.correct ? "text-sonar" : "text-flare"}`}
        >
          {verdict.edge ? "Close enough" : verdict.correct ? "Right" : "Wrong"}
        </h2>
        <UnitsSwitch />
      </div>
      <div className="mt-1 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-chalk">{route}</p>
          {verdict.edge && (
            <p className="mt-1 text-sm text-chalk-dim">
              {`That's on the line between ${truthName} and ${pickName}, so ${pickName} counts.`}
            </p>
          )}
          {!verdict.correct && (
            <p className="mt-1 text-sm text-chalk-dim">{`You picked ${pickName}.`}</p>
          )}
          {flat !== verdict.truth && (
            <p className="mt-1 text-sm text-chalk-dim">
              {`On a flat map it looks ${POINT_NAMES[flat]}, but the globe's shortest route heads ${truthName}.`}
            </p>
          )}
        </div>
        <Dial verdict={verdict} atlas={atlas} />
      </div>
      {atlas && (
        <p className="mt-2 text-sm text-chalk-dim">
          {`Atlas picked ${POINT_NAMES[atlas.picked]}${atlas.correct ? " and got it" : ", wrong"}. `}
          {`Atlas this run: ${atlasRight} of ${stops(atlasPlayed)}.`}
        </p>
      )}
      {over && (
        <p className="mt-2 text-chalk">
          {`Run over: ${stops(streak)} in a row. `}
          {newBest ? "That's your new best!" : best > 0 ? `Your best is ${stops(best)}.` : ""}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <button
          ref={nextRef}
          type="button"
          onClick={onNext}
          className="rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          {over ? "Start a new run" : "Travel on"}
        </button>
        <p className="min-w-0 text-[11px] text-chalk-dim">
          {[from, to].map((r, i) => (
            <a
              key={r.photo.id}
              href={r.photo.credit.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="block truncate underline decoration-graticule underline-offset-2 hover:text-chalk"
            >
              {`Photo ${i + 1}: ${r.photo.credit.author}, ${r.photo.credit.license}`}
            </a>
          ))}
        </p>
      </div>
    </section>
  );
}
