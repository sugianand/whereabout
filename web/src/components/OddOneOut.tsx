"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { isShortcut } from "@/lib/controls";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import {
  QUAD,
  dealQuad,
  initialOdd,
  loadBestOdd,
  oddOver,
  oddReducer,
  rememberOdd,
  type AtlasOdd,
  type Quad,
} from "@/lib/game/oddOneOut";
import { placeholderUrl, sources } from "@/lib/photoSources";

import ControlsHelp from "./ControlsHelp";

type OddOneOutProps = {
  deck: Deck;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that deals each quad. */
  random?: () => number;
};

const SLOTS = Array.from({ length: QUAD }, (_, i) => i);

/** "1 quad", "4 quads". */
function quads(n: number): string {
  return `${n} quad${n === 1 ? "" : "s"}`;
}

/**
 * Odd one out (src/lib/game/oddOneOut.ts): four photos, three from one continent; tap the one
 * from somewhere else. Endless until the first wrong tap.
 */
export default function OddOneOut({ deck, loadRecords, random }: OddOneOutProps) {
  const [state, dispatch] = useReducer(oddReducer, initialOdd);
  const [best, setBest] = useState(0);
  const [bestBeforeRun, setBestBeforeRun] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  // Photos dealt this run, kept back from the next quads while fresh ones remain.
  const seen = useRef(new Set<string>());

  const deal = useCallback((): Quad | null => {
    const quad = dealQuad(deck.regions, random ?? Math.random, seen.current);
    quad?.ids.forEach((id) => seen.current.add(id));
    return quad;
  }, [deck.regions, random]);

  const start = useCallback(() => {
    const stored = loadBestOdd();
    setBest(stored);
    setBestBeforeRun(stored);
    seen.current = new Set();
    const quad = deal();
    dispatch({ type: "start", quad, upcoming: quad ? deal() : null });
  }, [deal]);

  // Quads are dealt in the browser after hydration, never at build time.
  useEffect(() => {
    const id = requestAnimationFrame(start);
    return () => cancelAnimationFrame(id);
  }, [start]);

  const load = useCallback(
    (ids: string[]) => (loadRecords ? loadRecords(ids) : fetchRecords(deck, ids)),
    [deck, loadRecords],
  );

  const playing = state.phase === "picking" || state.phase === "answered" ? state : null;
  // The quad on screen first, then the one after it, so the next quad opens without waiting.
  const wanted = useMemo(
    () => (playing ? [...playing.quad.ids, ...(playing.upcoming?.ids ?? [])] : []),
    [playing],
  );
  const missing = [...new Set(wanted.filter((id) => !records.has(id)))].join(",");

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

  const shown = playing ? playing.quad.ids.map((id) => records.get(id)) : [];
  const ready = state.phase === "picking" && shown.every((r) => r !== undefined);
  const answered = state.phase === "answered" ? state : null;
  const over = oddOver(state);

  // Warm the cache with the next quad's photos while the player reads the answer.
  useEffect(() => {
    if (!answered?.upcoming) return;
    for (const id of answered.upcoming.ids) {
      const r = records.get(id);
      if (r) new Image().src = sources(r.photo).src;
    }
  }, [answered, records]);

  const choose = useCallback(
    (index: number) => {
      if (state.phase !== "picking" || !ready) return;
      const action = {
        type: "picked",
        index,
        atlas: state.quad.ids.map((id) => records.get(id)?.atlas ?? null),
      } as const;
      // Keep the run as the best after every right tap, so leaving mid-run keeps it.
      const after = oddReducer(state, action);
      if (after.phase === "answered" && after.correct) setBest(rememberOdd(after.streak));
      dispatch(action);
    },
    [state, ready, records],
  );

  // 1 to 4 pick a photo from the keyboard.
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e)) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= QUAD) choose(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, choose]);

  const next = useCallback(() => dispatch({ type: "next", upcoming: deal() }), [deal]);

  if (state.phase === "none") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
        <p className="text-sm text-gold">Odd one out</p>
        <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
          No photos to play yet
        </h1>
        <p className="mt-4 text-lg text-chalk-dim">
          Odd one out needs photos from at least two continents to deal.
        </p>
        <Link
          href="/"
          className="mt-8 text-chalk-dim underline underline-offset-2 hover:text-chalk"
        >
          Back to the main game
        </Link>
      </main>
    );
  }

  const streak = playing?.streak ?? 0;

  return (
    <main
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-ocean-deep"
      data-phase={answered ? "revealed" : "picking"}
    >
      <h1 className="sr-only">{`Whereabout: Odd one out, streak ${streak}`}</h1>

      <header className="flex items-start justify-between gap-4 px-4 pb-2 pt-4 md:px-6">
        <div className="min-w-0">
          <Link
            href="/"
            className="font-sign text-3xl font-extrabold leading-none tracking-tight md:text-4xl"
          >
            Whereabout
          </Link>
          <p className="mt-1 text-sm text-chalk-dim">
            Odd one out: three photos share a continent. Which one doesn&apos;t?
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          <ControlsHelp screen="odd-one-out" />
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

      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2 px-2 pb-2 md:gap-3 md:px-6 md:pb-6">
        {SLOTS.map((i) => (
          <PhotoTile
            key={i}
            index={i}
            record={shown[i]}
            ready={ready}
            quad={playing?.quad ?? null}
            picked={answered?.picked ?? null}
            atlas={answered?.atlas ?? null}
            onPick={choose}
          />
        ))}
      </div>

      {error && (
        <p role="alert" className="absolute inset-x-4 bottom-4 text-center text-sm text-flare">
          {error}
        </p>
      )}

      {answered && (
        // On phones the card takes its own place under the grid, which shrinks to make room, so
        // every photo's continent and place stay readable; wider screens lay it over the photos.
        <div className="z-30 flex shrink-0 justify-center px-2 pb-2 md:pointer-events-none md:absolute md:inset-x-0 md:bottom-0 md:p-6">
          <OddCard
            key={answered.quad.ids.join()}
            quad={answered.quad}
            correct={answered.correct}
            atlas={answered.atlas}
            streak={answered.streak}
            atlasTally={[answered.atlasRight, answered.atlasPlayed]}
            over={over}
            best={best}
            newBest={over && answered.streak > bestBeforeRun}
            onNext={over ? start : next}
          />
        </div>
      )}
    </main>
  );
}

function PhotoTile({
  index,
  record,
  ready,
  quad,
  picked,
  atlas,
  onPick,
}: {
  index: number;
  record: GameRecord | undefined;
  ready: boolean;
  quad: Quad | null;
  picked: number | null;
  atlas: AtlasOdd | null;
  onPick: (index: number) => void;
}) {
  const n = index + 1;
  const photo = record?.photo;
  const src = photo ? sources(photo) : null;
  const blur = photo ? placeholderUrl(photo.imageUrl) : null;
  const revealed = picked !== null && quad !== null;
  const isOdd = quad?.odd === index;
  const ring = !revealed
    ? "border-graticule hover:border-gold focus-visible:border-gold"
    : isOdd
      ? "border-sonar"
      : picked === index
        ? "border-flare"
        : "border-graticule";
  const continent = quad ? (isOdd ? quad.oddContinent : quad.common) : null;

  return (
    <div
      className={`relative min-h-0 overflow-hidden rounded-2xl border-2 bg-graticule/40 transition-colors ${ring}`}
      data-testid={`odd-photo-${n}`}
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
          sizes="50vw"
          alt={`Photo ${n}`}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <span className="absolute left-2 top-2 rounded-full bg-ocean-deep/85 px-2.5 py-0.5 font-sign text-lg font-extrabold">
        {n}
      </span>
      {revealed && photo ? (
        <div className="absolute inset-x-2 top-2 ml-9 flex flex-col items-end gap-1 text-right">
          {/* Atlas's pick shares the first line, so the card never hides it on a phone. */}
          <span className="flex flex-wrap items-center justify-end gap-1">
            {atlas?.picked === index && (
              <span className="rounded-full border border-gold bg-ocean-deep/85 px-2 py-0.5 text-xs font-semibold text-gold">
                Atlas&apos;s pick
              </span>
            )}
            <span
              className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${isOdd ? "bg-gold text-ocean-deep" : "bg-ocean-deep/85"}`}
            >
              {continent}
            </span>
          </span>
          <span className="max-w-full truncate rounded-full bg-ocean-deep/85 px-2.5 py-0.5 text-xs">
            {photo.place}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onPick(index)}
          disabled={!ready}
          aria-label={`Photo ${n} is the odd one out`}
          aria-keyshortcuts={String(n)}
          className="absolute inset-0 outline-none disabled:cursor-wait"
        />
      )}
      {photo && (
        <a
          href={photo.credit.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className={`absolute bottom-1 right-2 max-w-[80%] truncate text-[11px] text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk ${revealed ? "" : "hidden md:block"}`}
        >
          Photo: {photo.credit.author}, {photo.credit.license}
        </a>
      )}
    </div>
  );
}

/** Atlas's line: what it read and what it picked, from its own guesses. */
function atlasSentence(atlas: AtlasOdd, quad: Quad): string {
  const n = atlas.picked + 1;
  const result = atlas.correct ? "and got it" : "wrong";
  if (atlas.byContinent) {
    const read = atlas.continents[atlas.picked] ?? "somewhere else";
    const rest = atlas.continents.find((c, i) => i !== atlas.picked) ?? quad.common;
    return `Atlas read photo ${n} as ${read} and the rest as ${rest}, so it picked photo ${n}, ${result}.`;
  }
  return `Atlas couldn't split them by continent, so it picked photo ${n}, the pin furthest from its other three, ${result}.`;
}

function OddCard({
  quad,
  correct,
  atlas,
  streak,
  atlasTally,
  over,
  best,
  newBest,
  onNext,
}: {
  quad: Quad;
  correct: boolean;
  atlas: AtlasOdd | null;
  streak: number;
  atlasTally: readonly [number, number];
  over: boolean;
  best: number;
  newBest: boolean;
  onNext: () => void;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);
  const [atlasRight, atlasPlayed] = atlasTally;

  return (
    <section
      aria-labelledby="odd-verdict"
      className="pointer-events-auto w-full max-w-md rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-3 shadow-2xl md:p-5"
    >
      <h2
        id="odd-verdict"
        className={`font-sign text-3xl font-extrabold leading-tight ${correct ? "text-sonar" : "text-flare"}`}
      >
        {correct ? "Right" : "Wrong"}
      </h2>
      <p className="mt-1 text-chalk">
        {`Photo ${quad.odd + 1} was taken in ${quad.oddContinent}; the other three in ${quad.common}.`}
      </p>
      {atlas && (
        <p className="mt-2 text-sm text-chalk-dim">
          {`${atlasSentence(atlas, quad)} Atlas this run: ${atlasRight} of ${quads(atlasPlayed)}.`}
        </p>
      )}
      {over && (
        <p className="mt-2 text-chalk">
          {`Run over: ${quads(streak)} in a row. `}
          {newBest ? "That's your new best!" : best > 0 ? `Your best is ${quads(best)}.` : ""}
        </p>
      )}
      <button
        ref={nextRef}
        type="button"
        onClick={onNext}
        className="mt-3 rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
      >
        {over ? "Start a new run" : "Next four"}
      </button>
    </section>
  );
}
