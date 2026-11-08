"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { continentOf } from "@/lib/continents";
import { countryName } from "@/lib/countries";
import { isShortcut } from "@/lib/controls";
import {
  CLOSE_MAX,
  CLOSE_POINTS,
  closePoints,
  closeReducer,
  closeTotals,
  dealClose,
  initialClose,
  loadBestClose,
  rememberClose,
  type AtlasTries,
  type CloseResult,
} from "@/lib/game/closeUp";
import {
  CLOSE_ZOOMS,
  cropView,
  readFocus,
  seededFocus,
  type Focus,
  type Size,
} from "@/lib/game/closeUpCrop";
import {
  closeDailyShare,
  dailyCloseSeed,
  loadCloseDay,
  rememberCloseDay,
} from "@/lib/game/closeDaily";
import {
  CLOSE_CHALLENGE_PARAM,
  challengeTotal,
  closeChallengeLine,
  closeChallengeText,
  parseCloseChallenge,
  type CloseChallenge,
} from "@/lib/game/closeChallenge";
import { runToday } from "@/lib/game/dailyRuns";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import { nameIds, nameOptions, nameSeed } from "@/lib/game/nameCountry";
import { thumbUrl } from "@/lib/photoSources";
import { sendShare, type ShareOutcome } from "@/lib/share";

import ControlsHelp from "./ControlsHelp";
import { DailyRunResult } from "./DailyRunShare";
import GamesMenu from "./GamesMenu";

/** How long a photo waits for its busiest spot before opening on the fallback. */
const FOCUS_WAIT_MS = 1500;
/** The crop is enlarged a long way, so it asks for more than the usual 1280px photo. */
const CROP_WIDTH = 1920;

type CloseUpProps = {
  deck: Deck;
  /**
   * Today's game (src/lib/game/closeDaily.ts): the day's photos and names, one try a day, picked
   * back up after a reload at the very crop it was left on, kept apart from the free games' best.
   */
  daily?: boolean;
  /** For tests: the clock that says what today is. Defaults to the system clock. */
  now?: () => Date;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that deals each game. */
  random?: () => number;
  /** For tests: find a photo's busiest spot without the network. */
  loadFocus?: (imageUrl: string) => Promise<Focus | null>;
};

/** Why a challenge link was set aside for a fresh game. */
export const CLOSE_CHALLENGE_NOTICE = {
  malformed: "That challenge link was cut short, so here's a fresh game instead.",
  missing: "That challenge's photos aren't in the game any more, so here's a fresh game instead.",
} as const;

/** The challenge the address carries, read once as the page opens; null without one. */
function linkedChallenge(dealable: readonly string[]) {
  const value = new URLSearchParams(window.location.search).get(CLOSE_CHALLENGE_PARAM);
  return value === null ? null : parseCloseChallenge(value, dealable);
}

/** Take the challenge out of the address, so a reload deals a fresh game, not the old link. */
function dropChallengeParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(CLOSE_CHALLENGE_PARAM)) return;
  url.searchParams.delete(CLOSE_CHALLENGE_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function points(n: number): string {
  return `${n} point${n === 1 ? "" : "s"}`;
}

/** The size of `element`, kept current as it changes. */
function useSize(element: HTMLElement | null): Size | null {
  const [size, setSize] = useState<Size | null>(null);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize(width > 0 && height > 0 ? { width, height } : null);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

/**
 * Close-up (src/lib/game/closeUp.ts): a tight crop of a photo and four country names; each wrong
 * name zooms out and costs a point. Five photos a game against Atlas, which sees the whole photo.
 */
export default function CloseUp({
  deck,
  daily = false,
  now,
  loadRecords,
  random,
  loadFocus,
}: CloseUpProps) {
  const [state, dispatch] = useReducer(closeReducer, initialClose);
  const [best, setBest] = useState(0);
  // The best before this game, so its end can say when it was beaten.
  const [bestBefore, setBestBefore] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  // Each photo's opening spot, once it is settled: nothing shows before it, so a crop never jumps.
  const [focuses, setFocuses] = useState<ReadonlyMap<string, Focus>>(() => new Map());
  const [loaded, setLoaded] = useState<string | null>(null);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const size = useSize(frame);
  // The day today's game was dealt for, kept when the clock passes midnight mid-game.
  const [day, setDay] = useState<string | null>(null);
  // A friend's challenge this game answers: their photos, names and points to beat.
  const [challenge, setChallenge] = useState<CloseChallenge | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Deal a game; `fromLink` takes up a challenge the address carries, as the page opens. */
  const start = useCallback(
    (fromLink = false) => {
      const ids = nameIds(deck.streakIds, deck.regions);
      if (daily) {
        const today = runToday(now?.());
        const seed = dailyCloseSeed(today);
        const kept = loadCloseDay(today);
        setDay(today);
        dispatch({
          type: "start",
          order: dealClose(ids, seed),
          seed,
          results: kept?.results,
          wrong: kept?.wrong,
        });
        return;
      }
      const stored = loadBestClose();
      setBest(stored);
      setBestBefore(stored);
      const linked = fromLink ? linkedChallenge(ids) : null;
      setNotice(linked && !linked.ok ? CLOSE_CHALLENGE_NOTICE[linked.reason] : null);
      if (linked?.ok) {
        const { challenge: c } = linked;
        setChallenge(c);
        dispatch({ type: "start", order: c.ids, seed: c.seed });
        return;
      }
      setChallenge(null);
      dropChallengeParam();
      const seed = Math.floor((random ?? Math.random)() * 2 ** 32);
      dispatch({ type: "start", order: dealClose(ids, seed), seed });
    },
    [deck.regions, deck.streakIds, random, daily, now],
  );

  // The game is shuffled in the browser after hydration, never at build time.
  useEffect(() => {
    const id = requestAnimationFrame(() => start(true));
    return () => cancelAnimationFrame(id);
  }, [start]);

  const load = useCallback(
    (ids: string[]) => (loadRecords ? loadRecords(ids) : fetchRecords(deck, ids)),
    [deck, loadRecords],
  );

  const playing = state.phase === "guessing" || state.phase === "answered" ? state : null;
  const answered = state.phase === "answered" ? state : null;

  // This photo and the next one, so the next photo opens without waiting.
  const wanted = useMemo(
    () => (playing ? playing.order.slice(playing.index, playing.index + 2) : []),
    [playing],
  );
  const missing = wanted.filter((id) => !records.has(id)).join(",");

  useEffect(() => {
    if (!missing) return;
    let cancelled = false;
    load(missing.split(","))
      .then((got) => {
        if (cancelled) return;
        setRecords((known) => {
          const next = new Map(known);
          for (const r of got) next.set(r.photo.id, r);
          return next;
        });
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [missing, load]);

  const id = playing?.order[playing.index];
  const seed = playing?.seed;
  const current = id ? records.get(id) : undefined;
  const imageUrl = current?.photo.imageUrl;
  const focus = id ? focuses.get(id) : undefined;

  // Settle where this photo's crop opens: the busiest spot if it can be read in time.
  useEffect(() => {
    if (!id || !imageUrl || seed === undefined || focus) return;
    let done = false;
    const settle = (found: Focus | null) => {
      if (done) return;
      done = true;
      setFocuses((known) => new Map(known).set(id, found ?? seededFocus(seed)));
    };
    const timer = setTimeout(() => settle(null), FOCUS_WAIT_MS);
    (loadFocus ?? readFocus)(imageUrl).then(settle, () => settle(null));
    return () => {
      done = true;
      clearTimeout(timer);
    };
  }, [id, imageUrl, seed, focus, loadFocus]);

  const truth = current?.photo.country;
  const options = useMemo(
    () =>
      truth && id && seed !== undefined
        ? nameOptions(truth, deck.countryPool, nameSeed(seed, id))
        : [],
    [truth, id, seed, deck.countryPool],
  );
  const shown = useMemo(() => (focus ? options : []), [focus, options]);

  const choose = useCallback(
    (country: string) => {
      if (state.phase !== "guessing" || !current) return;
      const action = {
        type: "picked",
        country,
        options,
        truth: current.photo.country,
        atlas: current.atlas,
      } as const;
      const after = closeReducer(state, action);
      if (after.phase !== "guessing" && after.phase !== "answered") return;
      if (after === state) return;
      if (day) {
        // Today's game is kept as each name is tapped: a wider crop is a clue a reload can't undo.
        const wrong = after.phase === "guessing" ? after.wrong : [];
        rememberCloseDay(day, { results: after.results, wrong });
      } else if (after.phase === "answered" && !challenge) {
        // Keep the game as the best as it goes, so leaving at the last photo keeps it. A
        // challenge's photos may have been seen before, so it is played for the friend only.
        setBest(rememberClose(closeTotals(after.results).you));
      }
      dispatch(action);
    },
    [state, current, options, day, challenge],
  );

  // 1 to 4 pick a name from the keyboard. Attached before paint, so a key pressed the moment the
  // names appear is never lost to a listener that hasn't caught up.
  useLayoutEffect(() => {
    if (state.phase !== "guessing" || shown.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e)) return;
      const pick = shown[Number(e.key) - 1];
      if (pick) choose(pick);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.phase, shown, choose]);

  if (state.phase === "none") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
        <p className="text-sm text-gold">Close-up</p>
        <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
          No photos to play yet
        </h1>
        <p className="mt-4 text-lg text-chalk-dim">
          Close-up needs photos taken in countries the globe draws.
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

  if (state.phase === "over" && day) {
    return <CloseDayResult day={day} results={state.results} now={now} />;
  }

  if (state.phase === "over") {
    return (
      <CloseEnd
        results={state.results}
        seed={state.seed}
        records={records}
        best={best}
        bestBefore={bestBefore}
        challenge={challenge}
        onAgain={() => start()}
      />
    );
  }

  const results = playing?.results ?? [];
  const total = closeTotals(results).you;
  const wrong = playing?.wrong ?? [];
  const lastWrong = !answered && wrong.length > 0 ? wrong[wrong.length - 1] : null;

  return (
    <main
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-ocean-deep"
      data-phase={answered ? "revealed" : "guessing"}
      data-photo={current?.photo.id}
    >
      <h1 className="sr-only">{`Whereabout: Close-up${day ? ", today's game" : ""}, ${points(total)}`}</h1>

      <header className="flex items-start justify-between gap-4 px-4 pb-2 pt-4 md:px-6">
        <div className="min-w-0">
          <Link
            href="/"
            className="font-sign text-3xl font-extrabold leading-none tracking-tight md:text-4xl"
          >
            Whereabout
          </Link>
          <p className="mt-1 text-sm text-chalk-dim">
            {day
              ? `Today's close-ups (${day})`
              : challenge
                ? `A friend's challenge: ${points(challengeTotal(challenge))} to beat`
                : "Close-up: which country is this?"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <GamesMenu screen="close-up" streakHref="/streak" />
            <ControlsHelp screen="close-up" />
            <Link
              href={daily ? "/close-up" : "/close-up/daily"}
              className="text-sm text-gold underline underline-offset-2 hover:brightness-110"
            >
              {daily ? "Free games" : "Today's game"}
            </Link>
          </div>
        </div>
        <dl className="shrink-0 text-right">
          <dt className="text-sm text-chalk-dim">
            {playing ? `Photo ${playing.index + 1} of ${playing.order.length}` : "Photo"}
          </dt>
          <dd className="font-sign tabular text-3xl font-bold leading-none" aria-live="polite">
            {total}
          </dd>
          {!daily && (
            <div className="mt-1 flex justify-end gap-1.5 text-sm text-chalk-dim">
              <dt>Best</dt>
              <dd className="tabular">{best}</dd>
            </div>
          )}
        </dl>
      </header>

      <div
        ref={setFrame}
        data-testid="close-frame"
        className="relative mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-hidden bg-ocean md:rounded-2xl"
      >
        {current && focus && size && (
          <CropImage
            record={current}
            frame={size}
            focus={focus}
            stage={answered ? null : wrong.length}
            onLoad={() => setLoaded(current.photo.id)}
          />
        )}
        {loaded !== id && (
          <div
            className="wb-photo-placeholder absolute inset-0"
            data-photo-placeholder="showing"
            aria-hidden="true"
          />
        )}
        {!answered && current && focus && (
          <p className="absolute left-2 top-2 rounded-full bg-ocean-deep/85 px-3 py-1 text-sm font-semibold text-gold">
            {`Worth ${points(closePoints(wrong.length))}`}
          </p>
        )}
      </div>

      <p role="status" className="sr-only">
        {lastWrong ? `Not ${countryName(lastWrong)}. The photo zooms out.` : ""}
      </p>

      {/* Names, then the answer under them: the photo gives way, so both stay on a phone. */}
      <div className="z-10 mx-auto grid w-full max-w-3xl shrink-0 grid-cols-2 gap-2 px-2 pt-2 md:grid-cols-4 md:px-6 md:pt-3">
        {shown.map((country, i) => (
          <CloseOption
            key={country}
            n={i + 1}
            country={country}
            truth={answered?.truth ?? null}
            ruledOut={wrong.includes(country)}
            onPick={choose}
          />
        ))}
      </div>

      {notice && !answered && wrong.length === 0 && playing?.index === 0 && (
        <p role="status" className="px-4 pt-2 text-center text-sm text-chalk-dim">
          {notice}
        </p>
      )}

      {error && (
        <p role="alert" className="px-4 pt-2 text-center text-sm text-flare">
          {error}
        </p>
      )}

      <div className="flex shrink-0 justify-center px-2 pb-2 pt-2 md:px-6 md:pb-6 md:pt-3">
        {answered && current ? (
          <CloseCard
            key={current.photo.id}
            record={current}
            found={answered.found}
            result={answered.result}
            wrong={wrong.length}
            friend={challenge?.points[answered.index]}
            last={answered.index + 1 >= answered.order.length}
            onNext={() => dispatch({ type: "next" })}
          />
        ) : (
          current && (
            <a
              href={current.photo.credit.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="max-w-full truncate text-[11px] text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk"
            >
              Photo: {current.photo.credit.author}, {current.photo.credit.license}
            </a>
          )
        )}
      </div>
    </main>
  );
}

function CropImage({
  record,
  frame,
  focus,
  stage,
  onLoad,
}: {
  record: GameRecord;
  frame: Size;
  focus: Focus;
  /** Wrong names so far, or null for the whole photo. */
  stage: number | null;
  onLoad: () => void;
}) {
  const { imageUrl, place, id } = record.photo;
  const width = record.photo.width ?? 3;
  const height = record.photo.height ?? 2;
  const src = thumbUrl(imageUrl, width > CROP_WIDTH ? CROP_WIDTH : 1280);
  const view = cropView(
    frame,
    { width, height },
    focus,
    stage === null ? null : (CLOSE_ZOOMS[stage] ?? CLOSE_ZOOMS[CLOSE_ZOOMS.length - 1]),
  );
  const ref = useRef<HTMLImageElement>(null);
  // A photo already in the cache can finish before React attaches onLoad.
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth > 0) onLoad();
  });

  return (
    // eslint-disable-next-line @next/next/no-img-element -- hot-linked, sized by the crop
    <img
      key={id}
      ref={ref}
      src={src}
      alt={stage === null ? `The whole photo: ${place}` : "A close-up of part of the photo"}
      draggable={false}
      onLoad={onLoad}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="close-photo"
      data-stage={stage ?? "whole"}
      className="absolute left-0 top-0 max-w-none select-none transition-transform duration-700 ease-out motion-reduce:transition-none"
      style={{
        width: view.width,
        height: view.height,
        transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        transformOrigin: "0 0",
      }}
    />
  );
}

function CloseOption({
  n,
  country,
  truth,
  ruledOut,
  onPick,
}: {
  n: number;
  country: string;
  truth: string | null;
  ruledOut: boolean;
  onPick: (country: string) => void;
}) {
  const tone =
    truth !== null && country === truth
      ? "border-sonar bg-sonar/20"
      : ruledOut
        ? "border-flare bg-flare/20 text-chalk-dim"
        : truth !== null
          ? "border-graticule/50 text-chalk-dim"
          : "border-graticule bg-ocean hover:border-gold focus-visible:border-gold";

  return (
    <button
      type="button"
      onClick={() => onPick(country)}
      disabled={truth !== null || ruledOut}
      aria-keyshortcuts={String(n)}
      data-testid={`close-option-${n}`}
      data-country={country}
      className={`flex min-h-12 items-center gap-2 rounded-2xl border-2 px-3 py-2 text-left font-semibold outline-none transition-colors ${tone}`}
    >
      <span aria-hidden="true" className="font-sign text-sm text-chalk-dim">
        {n}
      </span>
      <span className="min-w-0 flex-1 leading-tight">{countryName(country)}</span>
    </button>
  );
}

const TRIES = ["first", "second", "third"] as const;

/** Atlas's line on one photo. Its rank is how many wrong names it would have paid for. */
function atlasLine(atlas: AtlasTries): string {
  const try_ = atlas.rank === null ? undefined : TRIES[atlas.rank];
  return try_
    ? `Atlas, with the whole photo, would have had it on its ${try_} try: ${points(atlas.points)}.`
    : "Atlas, with the whole photo, would have missed it: 0 points.";
}

function CloseCard({
  record,
  found,
  result,
  wrong,
  friend,
  last,
  onNext,
}: {
  record: GameRecord;
  found: boolean;
  result: CloseResult;
  wrong: number;
  /** In a friend's challenge, their points on this photo. */
  friend?: number;
  last: boolean;
  onNext: () => void;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);
  const { place, country, credit } = record.photo;
  const continent = continentOf(country);
  const clues = wrong === 0 ? "from the tightest crop" : `after ${wrong} wrong`;

  return (
    <section
      aria-labelledby="close-verdict"
      className="w-full max-w-3xl rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-3 shadow-2xl md:p-4"
    >
      <h2
        id="close-verdict"
        className={`font-sign text-2xl font-extrabold leading-tight md:text-3xl ${found ? "text-sonar" : "text-flare"}`}
      >
        {`${found ? "Right" : "Out of tries"}: ${countryName(country)}`}
      </h2>
      <p className="mt-1 text-chalk">{continent ? `${place}, ${continent}` : place}</p>
      <p className="mt-1 text-sm text-chalk-dim">
        {found ? `${points(result.points)}, ${clues}. ` : "No points on this one. "}
        {result.atlas ? atlasLine(result.atlas) : "Atlas sat this one out."}
        {friend !== undefined && ` Your friend: ${points(friend)}.`}
      </p>
      <div className="mt-2 flex items-center gap-4 md:mt-3">
        <button
          ref={nextRef}
          type="button"
          onClick={onNext}
          className="shrink-0 rounded-full bg-gold px-6 py-2.5 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          {last ? "See the score" : "Next photo"}
        </button>
        <a
          href={credit.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="block min-w-0 truncate text-xs text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk"
        >
          Photo: {credit.author}, {credit.license}
        </a>
      </div>
    </section>
  );
}

const CHALLENGE_NOTE: Record<ShareOutcome, string> = {
  shared: "Challenge sent.",
  copied: "Challenge link copied. Whoever opens it plays these five crops.",
  cancelled: "",
  failed: "Couldn't copy the link. Your browser blocked the clipboard.",
};

function CloseEnd({
  results,
  seed,
  records,
  best,
  bestBefore,
  challenge,
  onAgain,
}: {
  results: readonly CloseResult[];
  seed: number;
  records: ReadonlyMap<string, GameRecord>;
  best: number;
  bestBefore: number;
  /** The friend's challenge this game answered, if it was one. */
  challenge: CloseChallenge | null;
  onAgain: () => void;
}) {
  const { you, youOnPlayed, atlas, atlasPlayed } = closeTotals(results);
  const againRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    againRef.current?.focus({ preventScroll: true });
  }, []);
  const [sent, setSent] = useState("");
  async function sendChallenge() {
    const text = closeChallengeText(results, seed, window.location.href, challenge ?? undefined);
    setSent(CHALLENGE_NOTE[await sendShare(text, navigator)]);
  }
  const most = CLOSE_POINTS[0];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-10">
      <p className="text-sm text-gold">Close-up</p>
      <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
        {`${you} of ${CLOSE_MAX} points`}
      </h1>
      {challenge ? (
        <p className="mt-4 text-lg text-chalk-dim">
          {`${closeChallengeLine(results, challenge)} Your friend scored ${challengeTotal(challenge)}. A challenge doesn't count toward your best.`}
        </p>
      ) : (
        <p className="mt-4 text-lg text-chalk-dim">
          {you > bestBefore ? "That's your new best!" : `Your best is ${points(best)}.`}
        </p>
      )}
      {atlasPlayed > 0 && (
        <p className="mt-2 text-chalk-dim">
          {`On the ${atlasPlayed === 1 ? "photo" : `${atlasPlayed} photos`} Atlas played, with the whole photo in front of it: Atlas ${atlas}, you ${youOnPlayed}.`}
        </p>
      )}
      <ol className="mt-6 space-y-1">
        {results.map((r, i) => {
          const photo = records.get(r.id)?.photo;
          return (
            <li key={r.id} className="flex items-baseline justify-between gap-4">
              <span className="min-w-0 truncate text-chalk">{photo?.place ?? r.id}</span>
              <span className="tabular shrink-0 text-sm text-chalk-dim">
                {`${r.points} of ${most}${challenge ? `, friend ${challenge.points[i]}` : ""}`}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button
          ref={againRef}
          type="button"
          onClick={onAgain}
          className="rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          {challenge ? "Play a fresh game" : "Play again"}
        </button>
        <button
          type="button"
          onClick={sendChallenge}
          className="rounded-full border-2 border-gold px-5 py-2.5 font-semibold text-gold transition hover:bg-gold/10"
        >
          {challenge ? "Send yours back" : "Challenge a friend"}
        </button>
        <GamesMenu screen="close-up" streakHref="/streak" />
      </div>
      <p className="mt-2 min-h-5 text-sm text-chalk-dim" role="status">
        {sent}
      </p>
    </main>
  );
}

/** Today's Close-up once its last photo is over. */
function CloseDayResult({
  day,
  results,
  now,
}: {
  day: string;
  results: readonly CloseResult[];
  now?: () => Date;
}) {
  const { you, youOnPlayed, atlas, atlasPlayed } = closeTotals(results);
  const most = CLOSE_POINTS[0];
  const rival =
    atlasPlayed > 0
      ? ` On the ${atlasPlayed === 1 ? "photo" : `${atlasPlayed} photos`} Atlas played, with the whole photo: Atlas ${atlas}, you ${youOnPlayed}.`
      : "";
  return (
    <DailyRunResult
      game="Close-up"
      day={day}
      headline={`${you} of ${results.length * most} points`}
      summary={`${results.filter((r) => r.wrong.length === 0).length} of ${results.length} named from the tightest crop.${rival}`}
      shareText={(href) => closeDailyShare(day, results, href)}
      freeHref="/close-up"
      now={now}
    >
      <ol aria-label="Your photos" className="mt-4 space-y-1 text-chalk-dim">
        {results.map((r, i) => (
          <li key={r.id} className="flex justify-between gap-4">
            <span>{`Photo ${i + 1}`}</span>
            <span className="tabular">
              {`You ${r.points}${r.atlas ? `, Atlas ${r.atlas.points}` : ""}`}
            </span>
          </li>
        ))}
      </ol>
    </DailyRunResult>
  );
}
