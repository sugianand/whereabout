"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { isShortcut } from "@/lib/controls";
import { runToday } from "@/lib/game/dailyRuns";
import {
  LINE_CHALLENGE_PARAM,
  lineChallengeLine,
  lineHeadToHead,
  lineChallengeText,
  lineChallengeTotal,
  parseLineChallenge,
  type LineChallenge,
} from "@/lib/game/lineChallenge";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import {
  dailyLineRows,
  lineDailyShare,
  loadLineDay,
  rememberLineDay,
} from "@/lib/game/lineDaily";
import {
  ROW,
  ROWS,
  atlasLinePoints,
  dealRows,
  formatLongitude,
  initialLine,
  linePoints,
  lineReducer,
  loadBestLine,
  nearestPlace,
  rememberLine,
  type RowResult,
  type Spots,
} from "@/lib/game/lineUp";
import { placeholderUrl, sources } from "@/lib/photoSources";
import { sendShare, type ShareOutcome } from "@/lib/share";

import ControlsHelp from "./ControlsHelp";
import { DailyRunResult } from "./DailyRunShare";
import GamesMenu from "./GamesMenu";
import { HeadToHeadButton } from "./HeadToHeadButton";
import PhotoViewer from "./PhotoViewer";

type LineUpProps = {
  deck: Deck;
  /**
   * Today's game (src/lib/game/lineDaily.ts): the day's rows, one try a day, picked back up after
   * a reload, kept apart from the free games' best.
   */
  daily?: boolean;
  /** For tests: the clock that says what today is. Defaults to the system clock. */
  now?: () => Date;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that deals each game. */
  random?: () => number;
};

/** Why a challenge link was set aside for a fresh game. */
export const LINE_CHALLENGE_NOTICE = {
  malformed: "That challenge link was cut short, so here's a fresh game instead.",
  missing: "That challenge's photos aren't in the game any more, so here's a fresh game instead.",
} as const;

/** The challenge the address carries, read once as the page opens; null without one. */
function linkedChallenge(dealable: readonly string[]) {
  const value = new URLSearchParams(window.location.search).get(LINE_CHALLENGE_PARAM);
  return value === null ? null : parseLineChallenge(value, dealable);
}

/** Take the challenge out of the address, so a reload deals a fresh game, not the old link. */
function dropChallengeParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(LINE_CHALLENGE_PARAM)) return;
  url.searchParams.delete(LINE_CHALLENGE_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

/** "1 in place", "3 in place". */
function inPlaceCount(n: number): string {
  return `${n} in place`;
}

/** A press that has moved less than this, in pixels, is a tap rather than a drag. */
const DRAG_START = 8;

/** "1st", "2nd", "3rd", "4th". */
const ORDINALS = ["1st", "2nd", "3rd", "4th"];

const ROW_POINTS = ROW;

/** What a game came to against Atlas, or null when Atlas played no row of it. */
function atlasLine(results: readonly RowResult[]): string | null {
  const { points, rows } = atlasLinePoints(results);
  return rows === 0 ? null : `Atlas: ${points} of ${rows * ROW_POINTS} in place.`;
}

/**
 * Line them up (src/lib/game/lineUp.ts): four photos, put them in order from west to east. Tap
 * two to swap them, drag one into place, or press their numbers. Five rows against Atlas's order.
 *
 * The tiles keep their place in the DOM and are moved on screen by CSS `order`, because moving a
 * node in the DOM mid-drag would drop its pointer capture.
 */
export default function LineUp({ deck, daily = false, now, loadRecords, random }: LineUpProps) {
  const [state, dispatch] = useReducer(lineReducer, initialLine);
  const [best, setBest] = useState(0);
  // The best before this game, so its end can say when it was beaten.
  const [bestBefore, setBestBefore] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  // The place picked up by a tap, waiting for a second tap to swap it with.
  const [picked, setPicked] = useState<number | null>(null);
  // The photo opened to look closer.
  const [closer, setCloser] = useState<string | null>(null);
  // The tile under a finger or the mouse, and how far it hangs from its place.
  const [dragged, setDragged] = useState<{ id: string; x: number; y: number } | null>(null);

  // The day today's game was dealt for, kept when the clock passes midnight mid-game.
  const [day, setDay] = useState<string | null>(null);

  // A friend's challenge this game answers: their rows, as dealt, and their points to beat.
  const [challenge, setChallenge] = useState<LineChallenge | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Deal a game; `fromLink` takes up a challenge the address carries, as the page opens. */
  const start = useCallback(
    (fromLink = false) => {
      setPicked(null);
      if (daily) {
        const today = runToday(now?.());
        setDay(today);
        dispatch({
          type: "start",
          rows: dailyLineRows(deck.regions, today),
          results: loadLineDay(today)?.results,
        });
        return;
      }
      const stored = loadBestLine();
      setBest(stored);
      setBestBefore(stored);
      const linked = fromLink ? linkedChallenge(Object.values(deck.regions).flat()) : null;
      setNotice(linked && !linked.ok ? LINE_CHALLENGE_NOTICE[linked.reason] : null);
      if (linked?.ok) {
        setChallenge(linked.challenge);
        dispatch({ type: "start", rows: linked.challenge.rows });
        return;
      }
      setChallenge(null);
      dropChallengeParam();
      dispatch({ type: "start", rows: dealRows(deck.regions, random) });
    },
    [deck.regions, random, daily, now],
  );

  // The game is dealt in the browser after hydration, never at build time.
  useEffect(() => {
    const id = requestAnimationFrame(() => start(true));
    return () => cancelAnimationFrame(id);
  }, [start]);

  const load = useCallback(
    (ids: string[]) => (loadRecords ? loadRecords(ids) : fetchRecords(deck, ids)),
    [deck, loadRecords],
  );

  const playing = state.phase === "placing" || state.phase === "revealed" ? state : null;
  const placing = state.phase === "placing" ? state : null;
  const revealed = state.phase === "revealed" ? state : null;

  const rows = playing?.rows;
  const rowAt = playing?.index ?? 0;
  const row = useMemo(() => rows?.[rowAt] ?? [], [rows, rowAt]);
  const upcoming = useMemo(() => rows?.[rowAt + 1] ?? [], [rows, rowAt]);

  // This row and the next, so the next row opens without waiting.
  const wanted = useMemo(() => [...row, ...upcoming], [row, upcoming]);
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

  useEffect(() => {
    for (const id of upcoming) {
      const photo = records.get(id)?.photo;
      if (photo) new Image().src = sources(photo).src;
    }
  }, [upcoming, records]);

  // Once a row's records are in, its place on the map is known and it can be played.
  const awaiting = placing !== null && placing.spots === null;
  useEffect(() => {
    if (!awaiting || row.some((id) => !records.has(id))) return;
    const spots: Record<string, Spots[string]> = {};
    for (const id of row) {
      const { photo, atlas } = records.get(id)!;
      spots[id] = { lng: photo.lng, atlasLng: atlas?.lng ?? null };
    }
    dispatch({ type: "ready", spots });
  }, [awaiting, row, records]);

  const ready = placing !== null && placing.spots !== null;
  const order = playing?.order;

  const lockRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ready) lockRef.current?.focus({ preventScroll: true });
  }, [ready]);

  const tap = useCallback(
    (place: number) => {
      if (!ready) return;
      if (picked === null) setPicked(place);
      else {
        if (picked !== place) dispatch({ type: "swap", a: picked, b: place });
        setPicked(null);
      }
    },
    [ready, picked],
  );

  const lock = useCallback(() => {
    setPicked(null);
    const after = lineReducer(state, { type: "lock" });
    // Today's game is kept as each row locks, so a reload picks up at the next one.
    if (after.phase === "revealed" && day) rememberLineDay(day, { results: after.results });
    dispatch({ type: "lock" });
  }, [state, day]);

  const next = useCallback(() => {
    if (state.phase !== "revealed") return;
    // A challenge's photos may have been seen before, so it is played for the friend only.
    const last = state.index + 1 >= state.rows.length;
    if (!daily && !challenge && last && state.rows.length === ROWS) {
      setBest(rememberLine(linePoints(state.results)));
    }
    dispatch({ type: "next" });
  }, [state, daily, challenge]);

  // 1 to 4 pick a place up and put it down on another; Escape lets go.
  useEffect(() => {
    if (!ready || closer) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e)) return;
      if (e.key === "Escape") setPicked(null);
      const place = Number(e.key) - 1;
      if (Number.isInteger(place) && place >= 0 && place < ROW) tap(place);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, closer, tap]);

  // A drag in progress. Refs, so a pointer move sees the latest without waiting for a render.
  const grab = useRef<{
    pointer: number;
    id: string;
    startX: number;
    startY: number;
    /** Where each place's tile sits on the screen, measured as the drag begins. */
    centres: { x: number; y: number }[];
    place: number;
    home: number;
    moved: boolean;
  } | null>(null);
  const tilesRef = useRef<HTMLDivElement>(null);
  // A drag ends in a click on the same tile, which mustn't also count as a tap.
  const dropped = useRef(false);

  const onPointerDown = (e: ReactPointerEvent, id: string, place: number) => {
    if (!ready || e.button !== 0) return;
    dropped.current = false;
    const tiles = [...(tilesRef.current?.querySelectorAll("[data-place]") ?? [])];
    const centres: { x: number; y: number }[] = [];
    for (const tile of tiles) {
      const box = tile.getBoundingClientRect();
      centres[Number(tile.getAttribute("data-place"))] = {
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
      };
    }
    grab.current = {
      pointer: e.pointerId,
      id,
      startX: e.clientX,
      startY: e.clientY,
      centres,
      place,
      home: place,
      moved: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const g = grab.current;
    if (!g || g.pointer !== e.pointerId) return;
    const x = e.clientX - g.startX;
    const y = e.clientY - g.startY;
    if (!g.moved && Math.hypot(x, y) < DRAG_START) return;
    if (!g.moved) {
      g.moved = true;
      setPicked(null);
    }
    const home = g.centres[g.home];
    const place = nearestPlace(home.x + x, home.y + y, g.centres);
    if (place !== g.place) {
      dispatch({ type: "move", from: g.place, to: place });
      g.place = place;
    }
    const at = g.centres[g.place];
    setDragged({ id: g.id, x: home.x + x - at.x, y: home.y + y - at.y });
  };

  const onPointerEnd = (e: ReactPointerEvent) => {
    const g = grab.current;
    if (!g || g.pointer !== e.pointerId) return;
    dropped.current = g.moved;
    grab.current = null;
    setDragged(null);
  };

  const onTileClick = (place: number) => {
    if (dropped.current) dropped.current = false;
    else tap(place);
  };

  if (state.phase === "finished" && day) {
    return <LineDayResult day={day} results={state.results} now={now} />;
  }

  if (state.phase === "finished" || state.phase === "none") {
    const results = state.phase === "finished" ? state.results : [];
    return (
      <Finished
        rows={state.phase === "finished" ? state.rows : []}
        results={results}
        whole={results.length === ROWS}
        best={best}
        newBest={!challenge && linePoints(results) > bestBefore && results.length === ROWS}
        challenge={challenge}
        onAgain={() => start()}
      />
    );
  }

  const index = rowAt;
  const rowCount = playing?.rows.length ?? ROWS;
  const score = linePoints(playing?.results ?? []);
  const places = revealed ? revealed.result.east : order;
  const photo = closer ? records.get(closer)?.photo : undefined;

  return (
    <main
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-ocean-deep"
      data-phase={revealed ? "revealed" : "placing"}
    >
      <h1 className="sr-only">{`Whereabout: Line them up${day ? ", today's game" : ""}, row ${index + 1} of ${rowCount}`}</h1>

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
              ? `Today's rows (${day}): west to east`
              : challenge
                ? `A friend's challenge: ${inPlaceCount(lineChallengeTotal(challenge))} to beat`
                : "Line them up: west to east"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <GamesMenu screen="line-up" streakHref="/streak" />
            <ControlsHelp screen="line-up" />
            <Link
              href={daily ? "/line-up" : "/line-up/daily"}
              className="text-sm text-gold underline underline-offset-2 hover:brightness-110"
            >
              {daily ? "Free games" : "Today's game"}
            </Link>
          </div>
        </div>
        <dl className="shrink-0 text-right">
          <dt className="text-sm text-chalk-dim">{`Row ${index + 1} of ${rowCount}`}</dt>
          <dd className="font-sign tabular text-3xl font-bold leading-none" aria-live="polite">
            {score}
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
        ref={tilesRef}
        className="grid min-h-0 flex-1 grid-cols-1 grid-rows-4 gap-1.5 px-2 md:grid-cols-4 md:grid-rows-1 md:gap-3 md:px-6"
      >
        {row.map((id) => {
          const place = places?.indexOf(id) ?? 0;
          return (
            <Tile
              key={id}
              id={id}
              place={place}
              record={records.get(id)}
              ready={ready}
              picked={picked === place}
              offset={dragged?.id === id ? dragged : null}
              result={revealed?.result ?? null}
              spots={revealed?.spots ?? null}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerEnd={onPointerEnd}
              onClick={onTileClick}
              onCloser={setCloser}
            />
          );
        })}
      </div>

      {notice && placing && index === 0 && (
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
        {revealed ? (
          <RowCard
            key={index}
            result={revealed.result}
            results={revealed.results}
            friend={challenge?.points[index]}
            last={index + 1 >= rowCount}
            onNext={next}
          />
        ) : (
          <div className="flex w-full max-w-3xl items-center justify-between gap-3 px-1">
            <p role="status" className="min-w-0 text-sm text-chalk-dim">
              {picked === null
                ? "Tap two photos to swap them, or drag one into place."
                : "Now tap the place it goes."}
            </p>
            <button
              ref={lockRef}
              type="button"
              onClick={lock}
              disabled={!ready}
              className="shrink-0 rounded-full bg-gold px-6 py-2.5 font-semibold text-ocean-deep transition hover:brightness-110 disabled:cursor-wait disabled:opacity-50"
            >
              Lock it in
            </button>
          </div>
        )}
      </div>

      {photo && (
        <Closer
          photo={photo}
          onClose={() => {
            setCloser(null);
            lockRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </main>
  );
}

function Tile({
  id,
  place,
  record,
  ready,
  picked,
  offset,
  result,
  spots,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
  onClick,
  onCloser,
}: {
  id: string;
  place: number;
  record: GameRecord | undefined;
  ready: boolean;
  picked: boolean;
  offset: { x: number; y: number } | null;
  result: RowResult | null;
  spots: Spots | null;
  onPointerDown: (e: ReactPointerEvent, id: string, place: number) => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerEnd: (e: ReactPointerEvent) => void;
  onClick: (place: number) => void;
  onCloser: (id: string) => void;
}) {
  const n = place + 1;
  const photo = record?.photo;
  const src = photo ? sources(photo) : null;
  const blur = photo ? placeholderUrl(photo.imageUrl) : null;
  const yours = result ? result.order.indexOf(id) : -1;
  const right = result ? result.right[yours] : false;
  const atlas = result?.atlas ? result.atlas.order.indexOf(id) : -1;
  const ring = result
    ? right
      ? "border-sonar"
      : "border-flare"
    : picked
      ? "border-gold ring-2 ring-gold"
      : "border-graticule hover:border-gold focus-within:border-gold";
  const end = place === 0 ? " West" : place === ROW - 1 ? " East" : "";

  return (
    <div
      className={`relative min-h-0 overflow-hidden rounded-2xl border-2 bg-graticule/40 transition-colors ${ring} ${offset ? "z-20 shadow-2xl" : ""}`}
      data-testid={`line-photo-${n}`}
      data-place={place}
      data-photo={id}
      style={{
        order: place,
        ...(blur ? { backgroundImage: `url(${blur})`, backgroundSize: "cover" } : {}),
        ...(offset ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : {}),
      }}
    >
      {src && (
        // Wikimedia thumbnails, already sized; next/image can't optimise a static export.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src.src}
          srcSet={src.srcSet}
          sizes="(min-width: 768px) 25vw, 100vw"
          alt={`Photo in place ${n}`}
          decoding="async"
          draggable={false}
          className="absolute inset-0 h-full w-full select-none object-cover"
        />
      )}
      {!result && (
        <button
          type="button"
          disabled={!ready}
          onPointerDown={(e) => onPointerDown(e, id, place)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onClick={() => onClick(place)}
          aria-label={`Photo in place ${n}${picked ? ", picked up" : ""}`}
          aria-pressed={picked}
          aria-keyshortcuts={String(n)}
          className="absolute inset-0 cursor-grab touch-none outline-none disabled:cursor-wait"
        />
      )}
      <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-ocean-deep/85 px-2 py-0.5 font-sign text-base font-extrabold leading-tight">
        {`${n}${end}`}
      </span>
      {result && photo && spots ? (
        <div className="absolute inset-x-1.5 top-1.5 flex flex-col items-end gap-0.5 text-right">
          <span className="flex items-center justify-end gap-1">
            {atlas >= 0 && (
              <span className="rounded-full border border-gold bg-ocean-deep/85 px-1.5 text-xs text-gold">
                {`Atlas: ${ORDINALS[atlas]}`}
              </span>
            )}
            {!right && (
              <span className="rounded-full bg-ocean-deep/85 px-1.5 text-xs text-flare">
                {`You: ${ORDINALS[yours]}`}
              </span>
            )}
            <span className="rounded-full bg-gold px-2 text-sm font-semibold text-ocean-deep">
              {formatLongitude(spots[id].lng)}
            </span>
          </span>
          <span className="max-w-full truncate rounded-full bg-ocean-deep/85 px-2 text-xs">
            {photo.place}
          </span>
        </div>
      ) : (
        photo && (
          <button
            type="button"
            onClick={() => onCloser(id)}
            aria-label={`Look closer at the photo in place ${n}`}
            className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full bg-ocean-deep/85 text-lg leading-none outline-none hover:text-gold focus-visible:text-gold"
          >
            <span aria-hidden="true">⤢</span>
          </button>
        )
      )}
      {photo && (
        <a
          href={photo.credit.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className={`absolute bottom-0.5 right-2 max-w-[90%] truncate rounded bg-ocean-deep/70 px-1 text-[11px] leading-6 text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk ${result ? "" : "hidden md:block"}`}
        >
          Photo: {photo.credit.author}, {photo.credit.license}
        </a>
      )}
    </div>
  );
}

/** One photo over the whole screen, to pan and zoom. The row waits behind it. */
function Closer({ photo, onClose }: { photo: GameRecord["photo"]; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="The photo, closer"
      className="absolute inset-0 z-40 flex flex-col bg-ocean-deep"
    >
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <PhotoViewer
          src={photo.imageUrl}
          roundKey={photo.id}
          width={photo.width}
          height={photo.height}
        />
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3 p-2 md:p-4">
        <a
          href={photo.credit.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate text-xs leading-6 text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk"
        >
          Photo: {photo.credit.author}, {photo.credit.license}
        </a>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-full bg-gold px-6 py-2.5 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          Back to the row
        </button>
      </div>
    </div>
  );
}

function RowCard({
  result,
  results,
  friend,
  last,
  onNext,
}: {
  result: RowResult;
  results: readonly RowResult[];
  /** In a friend's challenge, how many they had in place on this row. */
  friend?: number;
  last: boolean;
  onNext: () => void;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);
  const whole = result.points === ROW;
  const { points: atlasPoints, rows } = atlasLinePoints(results);

  return (
    <section
      aria-labelledby="line-verdict"
      className="flex w-full max-w-3xl items-center justify-between gap-3 rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-2.5 md:p-3"
    >
      <div className="min-w-0">
        <h2
          id="line-verdict"
          className={`font-sign text-xl font-extrabold leading-tight md:text-2xl ${whole ? "text-sonar" : "text-chalk"}`}
        >
          {whole ? "All four in place" : `${result.points} of ${ROW} in place`}
        </h2>
        <p className="text-sm text-chalk-dim">
          {result.atlas
            ? `Atlas put ${result.atlas.points} in place: ${atlasPoints} of ${rows * ROW_POINTS} so far.`
            : "Atlas hasn't guessed every photo here, so it sat this row out."}
          {friend !== undefined && ` Your friend: ${inPlaceCount(friend)}.`}
        </p>
      </div>
      <button
        ref={nextRef}
        type="button"
        onClick={onNext}
        className="shrink-0 rounded-full bg-gold px-5 py-2.5 font-semibold text-ocean-deep transition hover:brightness-110"
      >
        {last ? "See your score" : "Next row"}
      </button>
    </section>
  );
}

/** Each row's points, yours and Atlas's, and the friend's in a challenge. */
function RowList({
  results,
  friend,
}: {
  results: readonly RowResult[];
  friend?: readonly number[];
}) {
  return (
    <ol aria-label="Your rows" className="mt-4 space-y-1 text-chalk-dim">
      {results.map((r, i) => (
        <li key={r.order.join()} className="flex justify-between gap-4">
          <span>{`Row ${i + 1}`}</span>
          <span className="tabular">
            {`You ${r.points}${r.atlas ? `, Atlas ${r.atlas.points}` : ""}${friend ? `, friend ${friend[i]}` : ""}`}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Today's Line them up once its last row is locked. */
function LineDayResult({
  day,
  results,
  now,
}: {
  day: string;
  results: readonly RowResult[];
  now?: () => Date;
}) {
  const atlas = atlasLine(results);
  return (
    <DailyRunResult
      game="Line them up"
      day={day}
      headline={`${linePoints(results)} in place`}
      summary={`Out of ${results.length * ROW_POINTS}.${atlas ? ` ${atlas}` : ""}`}
      shareText={(href) => lineDailyShare(day, results, href)}
      freeHref="/line-up"
      now={now}
    >
      <RowList results={results} />
    </DailyRunResult>
  );
}

const CHALLENGE_NOTE: Record<ShareOutcome, string> = {
  shared: "Challenge sent.",
  copied: "Challenge link copied. Whoever opens it plays these rows.",
  cancelled: "",
  failed: "Couldn't copy the link. Your browser blocked the clipboard.",
};

function Finished({
  rows,
  results,
  whole,
  best,
  newBest,
  challenge,
  onAgain,
}: {
  /** The game's rows as they were dealt, for the link that challenges a friend. */
  rows: readonly (readonly string[])[];
  results: readonly RowResult[];
  whole: boolean;
  best: number;
  newBest: boolean;
  /** The friend's challenge this game answered, if it was one. */
  challenge: LineChallenge | null;
  onAgain: () => void;
}) {
  const none = results.length === 0;
  const atlas = atlasLine(results);
  const [sent, setSent] = useState("");
  async function sendChallenge() {
    const text = lineChallengeText(rows, results, window.location.href, challenge ?? undefined);
    setSent(CHALLENGE_NOTE[await sendShare(text, navigator)]);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-sm text-gold">Line them up</p>
      <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
        {none ? "No photos to play yet" : `${linePoints(results)} in place`}
      </h1>
      {none ? (
        <p className="mt-4 text-lg text-chalk-dim">Line them up needs four photos to deal.</p>
      ) : (
        <>
          <p className="mt-4 text-lg text-chalk-dim">
            {`Out of ${results.length * ROW_POINTS}. `}
            {challenge
              ? `${lineChallengeLine(results, challenge)} Your friend had ${lineChallengeTotal(challenge)}. A challenge doesn't count toward your best.`
              : newBest
                ? "That's your new best!"
                : whole && best > 0
                  ? `Your best is ${best}.`
                  : ""}
          </p>
          {atlas && (
            <p className="mt-2 text-chalk" data-testid="line-atlas-total">
              {atlas}
            </p>
          )}
          <RowList results={results} friend={challenge?.points} />
        </>
      )}
      <div className="mt-8 flex flex-wrap items-center gap-4">
        {!none && (
          <button
            type="button"
            onClick={onAgain}
            className="rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
          >
            {challenge ? "Play a fresh game" : "Play again"}
          </button>
        )}
        {!none && (
          <button
            type="button"
            onClick={sendChallenge}
            className="rounded-full border-2 border-gold px-5 py-2.5 font-semibold text-gold transition hover:bg-gold/10"
          >
            {challenge ? "Send yours back" : "Challenge a friend"}
          </button>
        )}
        {!none && challenge && (
          <HeadToHeadButton
            headToHead={lineHeadToHead(results, challenge, window.location.href)}
            replyText={() => lineChallengeText(rows, results, window.location.href, challenge)}
            onNote={setSent}
          />
        )}
        <Link href="/" className="text-chalk-dim underline underline-offset-2 hover:text-chalk">
          Back to the main game
        </Link>
      </div>
      <p className="mt-2 min-h-5 text-sm text-chalk-dim" role="status">
        {sent}
      </p>
    </main>
  );
}
