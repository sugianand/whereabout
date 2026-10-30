"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { seededShuffle } from "@/lib/game/daily";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import {
  MAX_NAME,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PASS_ROUNDS,
  defaultName,
  initialPass,
  loadPassPlayers,
  passReducer,
  rememberPassPlayers,
  standings,
  winners,
  type PassRound,
} from "@/lib/game/passPlay";
import { formatDistance, formatPoints, type LngLat } from "@/lib/geo";
import type { RevealView } from "@/lib/reveal";
import type { Units } from "@/lib/units";
import { useUnits } from "@/lib/useUnits";

import Globe from "./Globe";
import PhotoViewer from "./PhotoViewer";
import UnitsSwitch from "./UnitsSwitch";

type PassAndPlayProps = {
  deck: Deck;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that deals each game. */
  random?: () => number;
};

/** A player's seat number in a flare disc, the same mark as their pin on the globe. */
function Seat({ index }: { index: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-flare text-[11px] font-bold leading-none text-ocean-deep"
    >
      {index + 1}
    </span>
  );
}

/** "Ana", "Ana and Bo", "Ana, Bo and Cy". */
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Pass and play (src/lib/game/passPlay.ts): two to four players take turns on one device, each
 * pinning the same photo behind a screen that hides the last pin, then one reveal shows every
 * pin, Atlas's and the running table. Five photos a game.
 */
export default function PassAndPlay({ deck, loadRecords, random }: PassAndPlayProps) {
  const [state, dispatch] = useReducer(passReducer, initialPass);
  const [names, setNames] = useState<string[]>(() => Array.from({ length: MIN_PLAYERS }, () => ""));
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  const units = useUnits();

  // The last table's names, read after hydration so the server render stays the same.
  useEffect(() => {
    const kept = loadPassPlayers();
    if (!kept) return;
    const id = requestAnimationFrame(() => setNames(kept));
    return () => cancelAnimationFrame(id);
  }, []);

  const deal = useCallback(
    (players: readonly string[]) => {
      const seed = Math.floor((random ?? Math.random)() * 2 ** 32);
      rememberPassPlayers(players);
      dispatch({ type: "start", players, order: seededShuffle(deck.ids, seed) });
    },
    [deck.ids, random],
  );

  const load = useCallback(
    (ids: string[]) => (loadRecords ? loadRecords(ids) : fetchRecords(deck, ids)),
    [deck, loadRecords],
  );

  const playing = state.phase === "pass" || state.phase === "pinning" || state.phase === "revealed";
  // The round on screen: the one being pinned, or the one just revealed.
  const roundIndex = !playing
    ? 0
    : state.phase === "revealed"
      ? state.rounds.length - 1
      : state.rounds.length;

  // This photo and the next one, so the next round opens without waiting.
  const wanted = useMemo(
    () => (playing ? state.order.slice(roundIndex, roundIndex + 2) : []),
    [playing, state, roundIndex],
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

  const current = playing ? records.get(state.order[roundIndex]) : undefined;
  const next =
    state.phase === "revealed" ? records.get(state.order[roundIndex + 1] ?? "") : undefined;

  // Warm the cache with the next photo while the table reads the answer.
  useEffect(() => {
    if (next) new Image().src = next.photo.imageUrl;
  }, [next]);

  const onPinChange = useCallback((pin: LngLat) => dispatch({ type: "pinned", pin }), []);

  function lock() {
    if (state.phase !== "pinning" || !current || !state.pin) return;
    dispatch({ type: "lock", truth: current.photo, atlas: current.atlas ?? null });
  }

  const shownRound = state.phase === "revealed" ? state.rounds.at(-1) : undefined;
  const reveal = useMemo<RevealView | null>(() => {
    if (!shownRound) return null;
    const guesses: RevealView["guesses"] = shownRound.guesses.map((g, i) => ({
      actor: "player",
      at: g.at,
      label: String(i + 1),
    }));
    if (shownRound.atlas) guesses.push({ actor: "atlas", at: shownRound.atlas.at });
    return { truth: shownRound.truth, guesses };
  }, [shownRound]);

  if (state.phase === "setup") {
    return <Setup names={names} onNames={setNames} onStart={deal} empty={deck.ids.length === 0} />;
  }

  if (state.phase === "finished") {
    return (
      <Final
        players={state.players}
        rounds={state.rounds}
        onAgain={() => deal(state.players)}
        onNewPlayers={() => dispatch({ type: "setup" })}
      />
    );
  }

  const player = state.phase === "revealed" ? null : state.players[state.turn];
  const pin = state.phase === "pinning" ? state.pin : null;

  return (
    <main
      className="wb-stage relative h-dvh w-full overflow-hidden bg-ocean-deep"
      data-phase={state.phase === "revealed" ? "revealed" : "guessing"}
      data-photo={current?.photo.id}
    >
      <h1 className="sr-only">
        {player
          ? `Whereabout: pass and play, round ${roundIndex + 1} of ${state.order.length}, ${player}'s turn`
          : `Whereabout: pass and play, round ${roundIndex + 1} of ${state.order.length}`}
      </h1>

      <div className="wb-photo">
        {current && state.phase !== "pass" ? (
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
          <p className="mt-1 text-sm text-chalk-dim">Pass and play</p>
        </div>
        <div className="flex flex-col items-end text-right">
          <p className="text-sm text-chalk-dim">
            Round{" "}
            <span className="tabular">
              {roundIndex + 1} of {state.order.length}
            </span>
          </p>
          {player && state.phase === "pinning" && (
            <p className="mt-0.5 flex items-center gap-1.5 font-sign text-2xl font-bold leading-none">
              <Seat index={state.turn} />
              <span className="max-w-[10rem] truncate">{player}</span>
            </p>
          )}
        </div>
      </header>

      <div className="wb-globe-panel z-10" data-pinned={pin ? "true" : "false"}>
        <div className="wb-globe-frame">
          <Globe
            pin={pin}
            onPinChange={onPinChange}
            disabled={state.phase !== "pinning" || !current}
            reveal={reveal}
            className="h-full"
          />
        </div>
        {state.phase !== "revealed" && (
          <div className="wb-guess-bar">
            <button
              type="button"
              onClick={lock}
              disabled={state.phase !== "pinning" || !current || !pin}
              className="w-full rounded-full bg-flare px-4 py-3 font-semibold text-ocean-deep transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-chalk/15 disabled:text-chalk-dim"
            >
              {pin ? "Lock in my pin" : "Place your pin on the globe"}
            </button>
            {error && (
              <p role="alert" className="mt-2 text-center text-sm text-flare">
                {error}
              </p>
            )}
          </div>
        )}
      </div>

      {state.phase === "pass" && (
        <PassScreen
          // A fresh screen (and focus) for every hand-over.
          key={`${roundIndex}-${state.turn}`}
          name={state.players[state.turn]}
          seat={state.turn}
          round={roundIndex}
          rounds={state.order.length}
          firstOfRound={state.pins.every((p) => p === null)}
          onReady={() => dispatch({ type: "ready" })}
        />
      )}

      {state.phase === "revealed" && shownRound && current && (
        <div className="wb-reveal pointer-events-none absolute z-30">
          <RoundCard
            key={roundIndex}
            record={current}
            round={shownRound}
            players={state.players}
            rounds={state.rounds}
            last={state.rounds.length >= state.order.length}
            units={units}
            onNext={() => dispatch({ type: "next" })}
          />
        </div>
      )}
    </main>
  );
}

/** Two to four name fields, prefilled with the last table's names. */
function Setup({
  names,
  onNames,
  onStart,
  empty,
}: {
  names: string[];
  onNames: (names: string[]) => void;
  onStart: (names: string[]) => void;
  empty: boolean;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
      <Link href="/" className="font-sign text-3xl font-extrabold leading-none tracking-tight">
        Whereabout
      </Link>
      <h1 className="mt-8 font-sign text-5xl font-extrabold leading-none tracking-tight text-flare">
        Pass and play
      </h1>
      <p className="mt-4 text-lg text-chalk-dim">
        Two to four players, one {PASS_ROUNDS}-photo game on this device. Each of you pins the same
        photo in turn, then the reveal shows every pin, Atlas&apos;s too.
      </p>
      <form
        className="mt-8"
        onSubmit={(e) => {
          e.preventDefault();
          onStart(names);
        }}
      >
        <fieldset>
          <legend className="text-sm text-chalk-dim">Players</legend>
          <ol className="mt-2 space-y-2">
            {names.map((name, i) => (
              <li key={i} className="flex items-center gap-2">
                <Seat index={i} />
                <input
                  type="text"
                  value={name}
                  maxLength={MAX_NAME}
                  autoComplete="off"
                  aria-label={`Player ${i + 1} name`}
                  placeholder={defaultName(i)}
                  onChange={(e) => onNames(names.map((n, j) => (j === i ? e.target.value : n)))}
                  className="min-w-0 flex-1 rounded-xl border border-graticule/70 bg-ocean-deep px-3 py-2 text-chalk placeholder:text-chalk-dim/70 focus:border-chalk focus:outline-none"
                />
                {names.length > MIN_PLAYERS && (
                  <button
                    type="button"
                    aria-label={`Remove player ${i + 1}`}
                    onClick={() => onNames(names.filter((_, j) => j !== i))}
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-chalk/30 text-chalk-dim transition hover:border-chalk hover:text-chalk"
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </li>
            ))}
          </ol>
          {names.length < MAX_PLAYERS && (
            <button
              type="button"
              onClick={() => onNames([...names, ""])}
              className="mt-3 rounded-full border border-chalk/30 px-4 py-1.5 text-sm font-semibold transition hover:border-chalk"
            >
              Add a player
            </button>
          )}
        </fieldset>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={empty}
            className="rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-chalk/15 disabled:text-chalk-dim"
          >
            Start the game
          </button>
          <Link href="/" className="text-chalk-dim underline underline-offset-2 hover:text-chalk">
            Back to the main game
          </Link>
        </div>
        {empty && <p className="mt-3 text-flare">Pass and play needs photos to deal.</p>}
      </form>
    </main>
  );
}

/** Covers the whole stage between turns, so the next player never sees the last pin. */
function PassScreen({
  name,
  seat,
  round,
  rounds,
  firstOfRound,
  onReady,
}: {
  name: string;
  seat: number;
  round: number;
  rounds: number;
  firstOfRound: boolean;
  onReady: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section
      aria-labelledby="pass-to"
      className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-ocean-deep px-6 text-center"
    >
      <p className="text-sm text-gold">
        Round {round + 1} of {rounds}
      </p>
      <h2
        id="pass-to"
        className="mt-3 flex max-w-full items-center gap-3 font-sign text-5xl font-extrabold leading-none tracking-tight md:text-6xl"
      >
        <span className="shrink-0">Pass to</span>{" "}
        <span className="truncate text-flare">{name}</span>
      </h2>
      <p className="mt-4 max-w-sm text-chalk-dim">
        {firstOfRound
          ? "A new photo. Pin it, lock it in, then hand over."
          : "The last pin is hidden. Pin the same photo, lock it in, then hand over."}
      </p>
      <button
        ref={ref}
        type="button"
        onClick={onReady}
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
      >
        <Seat index={seat} />
        {`I'm ${name}, show the photo`}
      </button>
    </section>
  );
}

/** The reveal: every pin of this photo, Atlas's, and the table so far. */
function RoundCard({
  record,
  round,
  players,
  rounds,
  last,
  units,
  onNext,
}: {
  record: GameRecord;
  round: PassRound;
  players: readonly string[];
  rounds: readonly PassRound[];
  last: boolean;
  units: Units;
  onNext: () => void;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);
  const { credit } = record.photo;
  const table = standings(players, rounds);
  const best = Math.min(...round.guesses.map((g) => g.distanceKm));
  const closest = round.guesses.flatMap((g, i) => (g.distanceKm === best ? [players[i]] : []));

  return (
    <section
      aria-labelledby="pass-answer"
      className="wb-card pointer-events-auto w-full max-w-md rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-4 shadow-2xl md:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gold">{`Closest: ${joinNames(closest)}`}</p>
        <UnitsSwitch />
      </div>
      <h2
        id="pass-answer"
        className="font-sign text-2xl font-extrabold leading-tight text-chalk md:text-4xl"
      >
        {record.photo.place}
      </h2>
      <table className="mt-3 w-full text-sm">
        <caption className="sr-only">The table after this photo</caption>
        <thead className="text-left text-xs text-chalk-dim">
          <tr>
            <th scope="col" className="pb-1 font-normal">
              Player
            </th>
            <th scope="col" className="pb-1 text-right font-normal">
              This photo
            </th>
            <th scope="col" className="pb-1 text-right font-normal">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {table.map((row) => {
            const guess = row.who === "atlas" ? round.atlas : round.guesses[row.who];
            return (
              <tr
                key={row.who}
                className={`border-t border-graticule/50 ${row.who === "atlas" ? "text-sonar" : ""}`}
              >
                <th scope="row" className="py-1 pr-2 text-left font-semibold">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="w-4 shrink-0 tabular text-chalk-dim">{row.place}</span>
                    {row.who === "atlas" ? (
                      <span
                        aria-hidden="true"
                        className="h-5 w-5 shrink-0 rounded-full border-2 border-sonar"
                      />
                    ) : (
                      <Seat index={row.who} />
                    )}
                    <span className="truncate">{row.name}</span>
                  </span>
                </th>
                <td className="py-1 text-right tabular whitespace-nowrap">
                  {guess ? (
                    <>
                      <span className="text-chalk-dim">
                        {formatDistance(guess.distanceKm, units)}
                      </span>
                      {" · "}
                      {formatPoints(guess.score)}
                    </>
                  ) : (
                    <span className="text-chalk-dim">no guess</span>
                  )}
                </td>
                <td className="py-1 pl-3 text-right font-semibold tabular">
                  {formatPoints(row.total)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-4 flex items-center gap-4">
        <button
          ref={nextRef}
          type="button"
          onClick={onNext}
          className="shrink-0 rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          {last ? "See the final table" : "Next photo"}
        </button>
        <a
          href={credit.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate text-xs text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk"
        >
          Photo: {credit.author}, {credit.license}
        </a>
      </div>
    </section>
  );
}

/** After the last photo: who won, the whole table, and a rematch for the same players. */
function Final({
  players,
  rounds,
  onAgain,
  onNewPlayers,
}: {
  players: readonly string[];
  rounds: readonly PassRound[];
  onAgain: () => void;
  onNewPlayers: () => void;
}) {
  const table = standings(players, rounds);
  const won = winners(players, rounds).map((i) => players[i]);
  const atlasRow = table.find((r) => r.who === "atlas");
  const topPlayer = table.find((r) => r.who !== "atlas");
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
      <p className="text-sm text-gold">Pass and play · final table</p>
      <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
        {won.length === 1 ? `${won[0]} wins!` : `${joinNames(won)} tie!`}
      </h1>
      {atlasRow && topPlayer && (
        <p className="mt-4 text-lg text-chalk-dim">
          {atlasRow.total > topPlayer.total
            ? `Atlas beat the whole table with ${formatPoints(atlasRow.total)} points.`
            : atlasRow.total === topPlayer.total
              ? `Atlas tied the top score.`
              : `The table beat Atlas, who scored ${formatPoints(atlasRow.total)}.`}
        </p>
      )}
      <ol className="mt-8 space-y-2" aria-label="Final table">
        {table.map((row) => (
          <li
            key={row.who}
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
              row.who === "atlas" ? "border-sonar/40 text-sonar" : "border-graticule/70"
            }`}
          >
            <span className="w-5 tabular text-chalk-dim">{row.place}</span>
            {row.who === "atlas" ? (
              <span
                aria-hidden="true"
                className="h-5 w-5 shrink-0 rounded-full border-2 border-sonar"
              />
            ) : (
              <Seat index={row.who} />
            )}
            <span className="min-w-0 flex-1 truncate font-semibold">{row.name}</span>
            <span className="font-sign text-2xl font-bold tabular">{formatPoints(row.total)}</span>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex flex-wrap items-center gap-4">
        <button
          ref={ref}
          type="button"
          onClick={onAgain}
          className="rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
        >
          Play again with five new photos
        </button>
        <button
          type="button"
          onClick={onNewPlayers}
          className="rounded-full border border-chalk/30 px-5 py-3 font-semibold transition hover:border-chalk"
        >
          Change players
        </button>
        <Link href="/" className="text-chalk-dim underline underline-offset-2 hover:text-chalk">
          Back to the main game
        </Link>
      </div>
    </main>
  );
}
