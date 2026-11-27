"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { isShortcut } from "@/lib/controls";
import { countryName } from "@/lib/countries";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import {
  CHIPS,
  HEDGE_MAX,
  HEDGE_PHOTOS,
  chipWord,
  chipsLeft,
  dealHedge,
  hedgeEndLine,
  hedgeLine,
  hedgeOptions,
  hedgeReducer,
  hedgeResult,
  hedgeTotals,
  initialHedge,
  loadBestHedge,
  rememberHedge,
  type HedgeResult,
} from "@/lib/game/hedge";
import { formatPoints } from "@/lib/geo";
import { placeholderUrl, sources } from "@/lib/photoSources";

import ControlsHelp from "./ControlsHelp";
import GamesMenu from "./GamesMenu";

type HedgeProps = {
  deck: Deck;
  /** The photos Atlas weighed another country for (`bundledHedgeIds`). */
  ids: readonly string[];
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that picks each game's seed. */
  random?: () => number;
};

const ADD_KEYS: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3 };

/**
 * Hedge your bets (src/lib/game/hedge.ts): a photo and four countries, with ten chips to spread
 * over them; 1 to 4 (or +) put a chip on a country, Backspace (or −) takes one back, G bets.
 * The answer shows both sides' chips on every country and what the scoring rule paid. Five
 * photos, the best kept in this browser.
 */
export default function Hedge({ deck, ids, loadRecords, random }: HedgeProps) {
  const [state, dispatch] = useReducer(hedgeReducer, initialHedge);
  const [best, setBest] = useState(0);
  const [bestBeforeGame, setBestBeforeGame] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  // The chips on the photo being bet, and the order they went on, so Backspace takes back the
  // last one placed.
  const [placed, setPlaced] = useState<readonly number[]>([]);

  const start = useCallback(() => {
    const stored = loadBestHedge();
    setBest(stored);
    setBestBeforeGame(stored);
    setPlaced([]);
    const seed = Math.floor((random ?? Math.random)() * 2 ** 32);
    dispatch({ type: "start", order: dealHedge(ids, seed), seed });
  }, [ids, random]);

  // The game is dealt in the browser after hydration, never at build time.
  useEffect(() => {
    const id = requestAnimationFrame(() => start());
    return () => cancelAnimationFrame(id);
  }, [start]);

  const load = useCallback(
    (wanted: string[]) => (loadRecords ? loadRecords(wanted) : fetchRecords(deck, wanted)),
    [deck, loadRecords],
  );

  const playing = state.phase === "betting" || state.phase === "answered" ? state : null;
  const index = playing ? playing.results.length - (playing.phase === "answered" ? 1 : 0) : 0;
  const over = state.phase === "done" ? state.results : null;
  const wanted = useMemo(
    () => (playing ? playing.order.slice(index, index + 2) : over ? over.map((r) => r.id) : []),
    [playing, index, over],
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
  const options = useMemo(
    () => (record && playing ? hedgeOptions(record, playing.seed) : []),
    [record, playing],
  );
  const chips = options.map((_, i) => placed.filter((p) => p === i).length);
  const left = chipsLeft(chips);

  // Warm the cache with the next photo while the player reads the answer.
  useEffect(() => {
    if (upcoming) new Image().src = sources(upcoming.photo).src;
  }, [upcoming]);

  const betting = state.phase === "betting" && record !== undefined && options.length > 0;

  const add = useCallback(
    (i: number) => {
      if (!betting || i >= options.length) return;
      setPlaced((p) => (p.length >= CHIPS ? p : [...p, i]));
    },
    [betting, options.length],
  );

  /** Take a chip off option `i`, or the last one placed when `i` is undefined. */
  const take = useCallback(
    (i?: number) => {
      if (!betting) return;
      setPlaced((p) => {
        const at = i === undefined ? p.length - 1 : p.lastIndexOf(i);
        return at < 0 ? p : [...p.slice(0, at), ...p.slice(at + 1)];
      });
    },
    [betting],
  );

  const bet = useCallback(() => {
    if (!betting || left !== 0) return;
    const result = hedgeResult(record!, options, chips);
    if (!result) return;
    const after = hedgeReducer(state, { type: "bet", result });
    // Only a whole game counts as a best.
    if (after.phase === "answered" && after.results.length === after.order.length) {
      setBest(rememberHedge(hedgeTotals(after.results).total));
    }
    dispatch({ type: "bet", result });
  }, [betting, left, record, options, chips, state]);

  const next = useCallback(() => {
    setPlaced([]);
    dispatch({ type: "next" });
  }, []);

  // 1 to 4 put a chip on, Backspace takes the last back, G bets: wherever focus is but a
  // text field.
  useEffect(() => {
    if (!betting) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e)) return;
      const key = e.key.toLowerCase();
      if (key in ADD_KEYS) {
        e.preventDefault();
        add(ADD_KEYS[key]!);
      } else if (key === "backspace") {
        e.preventDefault();
        take();
      } else if (key === "g") {
        e.preventDefault();
        bet();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [betting, add, take, bet]);

  if (state.phase === "done") {
    return (
      <HedgeSummary
        results={state.results}
        records={records}
        best={best}
        newBest={hedgeTotals(state.results).total > bestBeforeGame}
        onAgain={start}
      />
    );
  }

  const results = playing?.results ?? [];
  const totals = hedgeTotals(results);
  const answered = state.phase === "answered" ? results[results.length - 1] : null;
  const last = playing !== null && results.length === playing.order.length;
  const total = playing?.order.length ?? HEDGE_PHOTOS;

  return (
    <main
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-ocean-deep"
      data-phase={answered ? "revealed" : "betting"}
      data-photo={record?.photo.id}
    >
      <h1 className="sr-only">{`Whereabout: Hedge your bets, photo ${index + 1} of ${total}`}</h1>

      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-2 pt-4 md:px-6">
        <div className="min-w-0">
          <Link
            href="/"
            className="font-sign text-3xl font-extrabold leading-none tracking-tight md:text-4xl"
          >
            Whereabout
          </Link>
          <p className="mt-1 text-sm text-chalk-dim">Hedge your bets: spread ten chips</p>
          <p className="text-sm text-chalk-dim" aria-live="polite">
            {`Photo ${index + 1} of ${total}`}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-3">
          <GamesMenu screen="hedge" streakHref="/streak" />
          <ControlsHelp screen="hedge" />
          <dl className="text-right">
            <dt className="text-sm text-chalk-dim">Points</dt>
            <dd className="font-sign tabular text-3xl font-bold leading-none">
              {formatPoints(totals.total)}
            </dd>
            <div className="mt-1 flex justify-end gap-1.5 text-sm text-chalk-dim">
              <dt>Atlas</dt>
              <dd className="tabular" data-testid="hedge-atlas-total">
                {formatPoints(totals.atlas)}
              </dd>
            </div>
            <div className="flex justify-end gap-1.5 text-sm text-chalk-dim">
              <dt>Best</dt>
              <dd className="tabular">{formatPoints(best)}</dd>
            </div>
          </dl>
        </div>
      </header>

      <HedgePhoto record={record} answered={answered} />

      {!answered && (
        <BetPanel
          options={options}
          chips={chips}
          left={left}
          ready={betting}
          onAdd={add}
          onTake={take}
          onBet={bet}
        />
      )}

      {error && (
        <p role="alert" className="absolute inset-x-4 bottom-4 text-center text-sm text-flare">
          {error}
        </p>
      )}

      {answered && record && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-3 md:p-6">
          <HedgeCard
            key={results.length}
            result={answered}
            record={record}
            onNext={next}
            nextLabel={last ? "See the results" : "Next photo"}
          />
        </div>
      )}
    </main>
  );
}

/** A row of ten pips, `n` of them filled: the chips on one country, seen at a glance. */
function Pips({
  n,
  atlas = false,
  className = "flex",
}: {
  n: number;
  atlas?: boolean;
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={`${className} gap-0.5`}>
      {Array.from({ length: CHIPS }, (_, i) => (
        <span
          key={i}
          className={`h-2.5 w-2.5 rounded-full ${
            i < n
              ? atlas
                ? "bg-flare"
                : "bg-gold"
              : atlas
                ? "border border-flare/50"
                : "border border-gold/40"
          }`}
        />
      ))}
    </span>
  );
}

function BetPanel({
  options,
  chips,
  left,
  ready,
  onAdd,
  onTake,
  onBet,
}: {
  options: readonly string[];
  chips: readonly number[];
  left: number;
  ready: boolean;
  onAdd: (i: number) => void;
  onTake: (i: number) => void;
  onBet: () => void;
}) {
  return (
    <div className="px-2 pb-3 md:mx-auto md:w-full md:max-w-xl md:pb-6">
      {/* Two by two on a phone, so the photo keeps its room; one per line from md up. */}
      <ol aria-label="The countries" className="grid grid-cols-2 gap-1 md:grid-cols-1">
        {options.map((country, i) => {
          const name = countryName(country);
          return (
            <li
              key={country}
              className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-graticule/70 px-2 py-1 md:flex-nowrap"
              data-testid="hedge-option"
              data-country={country}
            >
              <span className="flex w-full min-w-0 items-baseline gap-2 md:w-auto md:flex-1">
                <span className="w-3 shrink-0 text-xs text-chalk-dim" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-chalk">{name}</span>
                  <Pips n={chips[i] ?? 0} className="hidden md:flex" />
                </span>
              </span>
              <span
                className="sr-only"
                data-testid="hedge-chips"
              >{`${chipWord(chips[i] ?? 0)} on ${name}`}</span>
              <button
                type="button"
                onClick={() => onTake(i)}
                disabled={!ready || (chips[i] ?? 0) === 0}
                aria-label={`Take a chip off ${name}`}
                className="ml-auto h-10 w-10 shrink-0 rounded-full border-2 border-gold text-xl font-bold text-gold md:ml-0 transition hover:bg-gold/10 disabled:opacity-40"
              >
                −
              </button>
              <span
                className="tabular w-5 text-center font-sign text-xl font-bold"
                aria-hidden="true"
              >
                {chips[i] ?? 0}
              </span>
              <button
                type="button"
                onClick={() => onAdd(i)}
                disabled={!ready || left === 0}
                aria-label={`Put a chip on ${name}`}
                aria-keyshortcuts={String(i + 1)}
                className="h-10 w-10 shrink-0 rounded-full bg-gold text-xl font-bold text-ocean-deep transition hover:brightness-110 disabled:opacity-40"
              >
                +
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-sm text-chalk-dim" aria-live="polite" data-testid="hedge-left">
          {ready
            ? left === 0
              ? "All ten on. Bet when you're happy."
              : `${chipWord(left)} to place`
            : "Loading the photo"}
        </p>
        <button
          type="button"
          onClick={onBet}
          disabled={!ready || left !== 0}
          aria-keyshortcuts="g"
          className="rounded-full bg-gold px-6 py-2.5 font-sign text-xl font-extrabold text-ocean-deep transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Bet
        </button>
      </div>
    </div>
  );
}

function HedgePhoto({
  record,
  answered,
}: {
  record: GameRecord | undefined;
  answered: HedgeResult | null;
}) {
  const photo = record?.photo;
  const src = photo ? sources(photo) : null;
  const blur = photo ? placeholderUrl(photo.imageUrl) : null;
  const ring =
    answered === null
      ? "border-graticule"
      : answered.score >= answered.atlasScore
        ? "border-sonar"
        : "border-flare";
  return (
    <div className="relative min-h-0 flex-1 px-2 pb-2 md:px-6">
      <div
        className={`wb-night relative h-full w-full overflow-hidden rounded-2xl border-2 bg-graticule/40 ${ring}`}
        data-testid="hedge-photo"
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
            alt="The photo to bet on"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {answered && photo && (
          <span className="absolute left-2 top-2 rounded-full bg-gold px-3 py-1 text-sm font-semibold text-ocean-deep">
            {countryName(photo.country)}
          </span>
        )}
      </div>
    </div>
  );
}

function HedgeCard({
  result,
  record,
  onNext,
  nextLabel,
}: {
  result: HedgeResult;
  record: GameRecord;
  onNext: () => void;
  nextLabel: string;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);
  const { photo } = record;
  const verdict =
    result.score > result.atlasScore
      ? "You read it better"
      : result.score < result.atlasScore
        ? "Atlas read it better"
        : "Level";
  return (
    <section
      aria-labelledby="hedge-verdict"
      className="pointer-events-auto max-h-[70dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-4 shadow-2xl md:p-5"
    >
      <h2
        id="hedge-verdict"
        className={`font-sign text-3xl font-extrabold leading-tight ${result.score >= result.atlasScore ? "text-sonar" : "text-flare"}`}
      >
        {verdict}
      </h2>
      <p className="mt-1 text-chalk" data-testid="hedge-points">
        {`You scored ${formatPoints(result.score)} of ${formatPoints(HEDGE_MAX)}, Atlas ${formatPoints(result.atlasScore)}.`}
      </p>
      <p className="text-sm text-chalk-dim" data-testid="hedge-line">
        {`It is ${countryName(photo.country)}: ${photo.place}. ${hedgeLine(result, countryName)}`}
      </p>
      {/* One line a country on a phone, the chips as numbers; pips from md up. */}
      <ol aria-label="Both bets" className="mt-2 space-y-0.5 text-sm">
        {result.options.map((country, i) => (
          <li
            key={country}
            className={`flex flex-wrap items-center gap-x-3 rounded-lg px-2 py-0.5 md:py-1 ${i === result.right ? "bg-sonar/15" : ""}`}
            data-testid="hedge-both"
          >
            <span
              className={`min-w-0 flex-1 truncate md:basis-full ${i === result.right ? "font-semibold text-chalk" : "text-chalk-dim"}`}
            >
              {countryName(country)}
              {i === result.right && <span className="sr-only">, the right country</span>}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-chalk-dim md:w-9">You</span>
              <Pips n={result.chips[i]!} className="hidden md:flex" />
              <span className="tabular font-semibold text-gold md:hidden" aria-hidden="true">
                {result.chips[i]}
              </span>
              <span className="sr-only">{chipWord(result.chips[i]!)}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-flare md:w-9">Atlas</span>
              <Pips n={result.atlasChips[i]!} atlas className="hidden md:flex" />
              <span className="tabular font-semibold text-flare md:hidden" aria-hidden="true">
                {result.atlasChips[i]}
              </span>
              <span className="sr-only">{chipWord(result.atlasChips[i]!)}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          ref={nextRef}
          type="button"
          onClick={onNext}
          className="rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          {nextLabel}
        </button>
        <a
          href={photo.credit.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 max-w-full truncate text-xs text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk"
        >
          Photo: {photo.credit.author}, {photo.credit.license}
        </a>
      </div>
    </section>
  );
}

function HedgeSummary({
  results,
  records,
  best,
  newBest,
  onAgain,
}: {
  results: readonly HedgeResult[];
  records: ReadonlyMap<string, GameRecord>;
  best: number;
  newBest: boolean;
  onAgain: () => void;
}) {
  const none = results.length === 0;
  const { total, atlas } = hedgeTotals(results);
  const againRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    againRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-sm text-gold">Hedge your bets</p>
      <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
        {none ? "No photos to play yet" : `${formatPoints(total)} points`}
      </h1>
      {none ? (
        <p className="mt-4 text-lg text-chalk-dim">
          Hedge your bets needs photos Atlas has weighed countries for.
        </p>
      ) : (
        <>
          <p className="mt-4 text-lg text-chalk" data-testid="hedge-end">
            {`Atlas scored ${formatPoints(atlas)}. ${hedgeEndLine(results)}`}
          </p>
          <p className="mt-1 text-chalk-dim">
            {newBest
              ? "That's your new best!"
              : `Your best is ${formatPoints(best)} of ${formatPoints(HEDGE_PHOTOS * HEDGE_MAX)}.`}
          </p>
          <p className="mt-3 text-sm text-chalk-dim">
            Every chip on the right country pays 1,000, an even spread about 625, all in on a wrong
            one nothing. The rule is proper: on average it pays most to bet each country as likely
            as you really think it is.
          </p>
          <ol className="mt-6 space-y-2" aria-label="Your bets">
            {results.map((r, i) => {
              const rec = records.get(r.id);
              return (
                <li
                  key={r.id}
                  className="rounded-xl border border-graticule/70 px-3 py-2 text-sm"
                  data-testid="hedge-row"
                >
                  <span className="block text-chalk">{rec?.photo.place ?? `Photo ${i + 1}`}</span>
                  <span className="block text-chalk-dim">
                    {`${hedgeLine(r, countryName)} You ${formatPoints(r.score)}, Atlas ${formatPoints(r.atlasScore)}.`}
                  </span>
                </li>
              );
            })}
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
