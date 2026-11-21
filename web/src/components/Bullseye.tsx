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
  type Bet,
  type BullseyeRound,
} from "@/lib/game/bullseye";
import {
  BULLSEYE_CHALLENGE_PARAM,
  bullseyeChallengeLine,
  bullseyeChallengeScore,
  bullseyeChallengeText,
  bullseyeFriendBet,
  bullseyeHeadToHead,
  parseBullseyeChallenge,
  type BullseyeChallenge,
} from "@/lib/game/bullseyeChallenge";
import {
  bullseyeDailyShare,
  dailyBullseyeOrder,
  loadBullseyeDay,
  rememberBullseyeDay,
} from "@/lib/game/bullseyeDaily";
import { recordBullseyeRound } from "@/lib/game/bullseyeCalibration";
import { seededShuffle } from "@/lib/game/daily";
import { runToday } from "@/lib/game/dailyRuns";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import { formatDistance, formatPoints, type LngLat } from "@/lib/geo";
import type { RevealView, RingMark } from "@/lib/reveal";
import { sendShare, type ShareOutcome } from "@/lib/share";
import type { Units } from "@/lib/units";
import { useUnits } from "@/lib/useUnits";

import ControlsHelp from "./ControlsHelp";
import { DailyRunResult } from "./DailyRunShare";
import GamesMenu from "./GamesMenu";
import Globe from "./Globe";
import { HeadToHeadButton } from "./HeadToHeadButton";
import PhotoViewer from "./PhotoViewer";
import UnitsSwitch from "./UnitsSwitch";

type BullseyeProps = {
  deck: Deck;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that shuffles each game. */
  random?: () => number;
  /**
   * Today's game (src/lib/game/bullseyeDaily.ts): the day's five photos, one try a day, picked
   * back up after a reload at the first photo not yet bet on.
   */
  daily?: boolean;
  /** For tests: the clock that picks today's game. */
  now?: () => Date;
};

/** Why a challenge link was set aside for a fresh game. */
export const BULLSEYE_CHALLENGE_NOTICE = {
  malformed: "That challenge link was cut short, so here's a fresh game instead.",
  missing: "That challenge's photos aren't in the game any more, so here's a fresh game instead.",
} as const;

/** Take the challenge out of the address, so a reload deals a fresh game, not the old link. */
function dropChallengeParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(BULLSEYE_CHALLENGE_PARAM)) return;
  url.searchParams.delete(BULLSEYE_CHALLENGE_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

const CHALLENGE_NOTE: Record<ShareOutcome, string> = {
  shared: "Challenge sent.",
  copied: "Challenge link copied. Whoever opens it plays these five photos, in the same order.",
  cancelled: "",
  failed: "Couldn't copy the link. Your browser blocked the clipboard.",
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
export default function Bullseye({ deck, loadRecords, random, daily = false, now }: BullseyeProps) {
  const [state, dispatch] = useReducer(bullseyeReducer, initialBullseye);
  const [best, setBest] = useState(0);
  // The best before this game, so the end screen can say when it was beaten.
  const [bestBefore, setBestBefore] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  // The day today's game was dealt for, kept when the clock passes midnight mid-game.
  const [day, setDay] = useState<string | null>(null);
  // A friend's challenge this game answers (src/lib/game/bullseyeChallenge.ts): their five
  // photos and their ring and distance on each, shown once you have bet on that photo.
  const [challenge, setChallenge] = useState<BullseyeChallenge | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const units = useUnits();

  /** Deal a game; `fromLink` takes up a challenge the address carries, as the page opens. */
  const start = useCallback((fromLink = false) => {
    if (daily) {
      const today = runToday(now?.());
      setDay(today);
      dispatch({
        type: "start",
        order: dailyBullseyeOrder(deck.ids, today),
        from: loadBullseyeDay(today)?.results,
      });
      return;
    }
    const stored = loadBestBullseye();
    setBest(stored);
    setBestBefore(stored);
    const value = fromLink
      ? new URLSearchParams(window.location.search).get(BULLSEYE_CHALLENGE_PARAM)
      : null;
    const linked = value === null ? null : parseBullseyeChallenge(value, deck.ids);
    setNotice(linked && !linked.ok ? BULLSEYE_CHALLENGE_NOTICE[linked.reason] : null);
    if (linked?.ok) {
      setChallenge(linked.challenge);
      dispatch({ type: "start", order: linked.challenge.ids });
      return;
    }
    setChallenge(null);
    dropChallengeParam();
    const seed = Math.floor((random ?? Math.random)() * 2 ** 32);
    dispatch({ type: "start", order: seededShuffle(deck.ids, seed).slice(0, BULLSEYE_PHOTOS) });
  }, [daily, deck.ids, now, random]);

  // The order is shuffled in the browser after hydration, never at build time.
  useEffect(() => {
    const id = requestAnimationFrame(() => start(true));
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
    const action = {
      type: "bet",
      truth: photo,
      atlas: atlas ? { lng: atlas.lng, lat: atlas.lat, confidence: atlas.confidence } : null,
    } as const;
    const after = bullseyeReducer(guessing, action);
    if (after.phase === "answered") {
      // Today's bets are kept after every one, settled by the reducer's own rules, so a reload
      // can't take them back, and Your calibration reads them from there; a free game's or a
      // challenge's are tallied for it here, bet by bet.
      if (day) rememberBullseyeDay(day, after.results);
      else recordBullseyeRound(after.round);
    }
    dispatch(action);
  }, [current, day, guessing]);

  const next = useCallback(() => {
    const after = bullseyeReducer(state, { type: "next" });
    // Today's game is played once for the day, apart from the free games' best, and a friend's
    // challenge never counts as one: its photos were picked by someone who had seen them.
    if (after.phase === "finished" && !day && !challenge) {
      setBest(rememberBullseye(bullseyeTotal(after.results)));
    }
    dispatch({ type: "next" });
  }, [challenge, day, state]);

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

  if (state.phase === "finished" && day && state.results.length > 0) {
    return <DayResult day={day} results={state.results} units={units} now={now} />;
  }

  if (state.phase === "finished") {
    const total = bullseyeTotal(state.results);
    return (
      <Finished
        results={state.results}
        best={best}
        newBest={!challenge && total > bestBefore}
        units={units}
        challenge={challenge}
        onAgain={() => start()}
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
      <h1 className="sr-only">{`Whereabout: Bullseye${daily ? ", today" : ""}, photo ${(playing?.index ?? 0) + 1} of ${of}`}</h1>

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
            {`Bullseye${daily ? ", today" : ""}: photo ${(playing?.index ?? 0) + 1} of ${of}`}
          </p>
          {challenge && (
            <p className="text-sm text-chalk-dim" data-testid="bullseye-challenge">
              {`A friend's challenge: ${formatPoints(bullseyeChallengeScore(challenge))} to beat`}
            </p>
          )}
          <div className="pointer-events-auto mt-2 flex items-center gap-2">
            <GamesMenu screen="bullseye" streakHref="/streak" />
            <ControlsHelp screen="bullseye" />
            <Link
              href={daily ? "/bullseye" : "/bullseye/daily"}
              className="whitespace-nowrap text-sm text-gold underline underline-offset-2 hover:brightness-110"
            >
              {daily ? "Free games" : "Today's game"}
            </Link>
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
            {challenge && (
              <div className="flex justify-end gap-1.5">
                <dt>Friend</dt>
                <dd className="tabular text-flare" data-testid="bullseye-friend-score">
                  {formatPoints(bullseyeChallengeScore(challenge, results.length))}
                </dd>
              </div>
            )}
            {!daily && !challenge && (
              <div className="flex justify-end gap-1.5">
                <dt>Best</dt>
                <dd className="tabular">{formatPoints(best)}</dd>
              </div>
            )}
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
            {notice && guessing && results.length === 0 && (
              <p role="status" className="mt-2 text-center text-sm text-chalk-dim">
                {notice}
              </p>
            )}
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
            friend={challenge ? bullseyeFriendBet(challenge, answered.index) : null}
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
  friend,
  last,
  onNext,
}: {
  round: BullseyeRound;
  record: GameRecord;
  units: Units;
  /** On a friend's challenge: the bet they made on this photo, shown once you have made yours. */
  friend: Bet | null;
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
      {friend && (
        <p className="mt-1 text-sm text-chalk-dim" data-testid="bullseye-friend">
          <span className="text-flare">Friend</span>
          {`: ${betLine(friend, units)}`}
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

/** Each photo's ring, whether it held, how far off the pin was and what it scored. */
function PhotoList({
  results,
  units,
  friend = null,
}: {
  results: readonly BullseyeRound[];
  units: Units;
  /** On a friend's challenge: their bets, listed under yours. */
  friend?: BullseyeChallenge | null;
}) {
  const words = (b: Bet) =>
    `${b.inside ? "inside" : "outside"} ${ringName(b.ring, units)}, ${formatDistance(b.km, units)} off`;
  return (
    <ol className="mt-6 space-y-2" aria-label="Your photos">
      {results.map((r, i) => {
        const theirs = friend ? bullseyeFriendBet(friend, i) : null;
        return (
          <li key={r.id} className="text-sm" data-testid="bullseye-row">
            <span className="flex items-baseline justify-between gap-4">
              <span className="text-chalk-dim">{`Photo ${i + 1}: ${words(r.you)}`}</span>
              <span className="tabular shrink-0 font-semibold">{formatPoints(r.you.score)}</span>
            </span>
            {theirs && (
              <span className="flex items-baseline justify-between gap-4">
                <span className="text-chalk-dim">{`Friend: ${words(theirs)}`}</span>
                <span className="tabular shrink-0 text-flare">{formatPoints(theirs.score)}</span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Today's Bullseye once its last photo is bet on, on this visit or an earlier one. */
function DayResult({
  day,
  results,
  units,
  now,
}: {
  day: string;
  results: readonly BullseyeRound[];
  units: Units;
  now?: () => Date;
}) {
  const atlas = bullseyeAtlasLine(results);
  const held = ringsHeld(results);
  return (
    <DailyRunResult
      game="Bullseye"
      day={day}
      unit="game"
      headline={`${formatPoints(bullseyeTotal(results))} points`}
      summary={`Out of ${formatPoints(results.length * PHOTO_POINTS)}. Your rings held ${held} of ${results.length} photos.${atlas ? ` ${atlas}` : ""}`}
      shareText={(href) => bullseyeDailyShare(day, results, href, units)}
      freeHref="/bullseye"
      now={now}
    >
      <PhotoList results={results} units={units} />
    </DailyRunResult>
  );
}

function Finished({
  results,
  best,
  newBest,
  units,
  challenge,
  onAgain,
}: {
  results: readonly BullseyeRound[];
  best: number;
  newBest: boolean;
  units: Units;
  /** The friend's challenge this game answered, if it was one. */
  challenge: BullseyeChallenge | null;
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
            {challenge
              ? ""
              : newBest
                ? "That's your new best!"
                : best > 0
                  ? `Your best is ${formatPoints(best)}.`
                  : ""}
          </p>
          {challenge && (
            <p className="mt-2 text-chalk" data-testid="bullseye-challenge-line">
              {bullseyeChallengeLine(results, challenge)}
            </p>
          )}
          {atlas && (
            <p className="mt-2 text-chalk" data-testid="bullseye-atlas-total">
              {atlas}
            </p>
          )}
          <PhotoList results={results} units={units} friend={challenge} />
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
        {results.length === BULLSEYE_PHOTOS && (
          <ChallengeButton results={results} units={units} answering={challenge} />
        )}
        <Link href="/" className="text-chalk-dim underline underline-offset-2 hover:text-chalk">
          Back to the main game
        </Link>
      </div>
    </main>
  );
}

/**
 * Challenge a friend from a whole free game (src/lib/game/bullseyeChallenge.ts): a link to the
 * same five photos with your ring and distance on each. Answering a challenge, it sends one back,
 * with the head-to-head picture beside it.
 */
function ChallengeButton({
  results,
  units,
  answering,
}: {
  results: readonly BullseyeRound[];
  units: Units;
  answering: BullseyeChallenge | null;
}) {
  const [sent, setSent] = useState("");
  const text = () => bullseyeChallengeText(results, window.location.href, answering ?? undefined);
  async function send() {
    setSent(CHALLENGE_NOTE[await sendShare(text(), navigator)]);
  }
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex flex-wrap gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={send}
          className="rounded-full border-2 border-gold px-5 py-2.5 font-semibold text-gold transition hover:bg-gold/10"
        >
          {answering ? "Send yours back" : "Challenge a friend"}
        </button>
        {answering && (
          <HeadToHeadButton
            headToHead={bullseyeHeadToHead(results, answering, window.location.href, units)}
            replyText={text}
            onNote={setSent}
          />
        )}
      </span>
      <span role="status" className={sent ? "mt-1 text-xs text-chalk-dim" : "sr-only"}>
        {sent}
      </span>
    </span>
  );
}
