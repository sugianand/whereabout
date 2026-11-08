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
import { seededShuffle } from "@/lib/game/daily";
import { FRESH_RUN, runToday, type DailyRun } from "@/lib/game/dailyRuns";
import { fetchRecords, type Deck, type GameRecord } from "@/lib/game/deck";
import {
  atlasPercent,
  initialName,
  loadBestName,
  nameIds,
  nameOptions,
  nameOver,
  nameReducer,
  nameSeed,
  rememberName,
  type AtlasName,
} from "@/lib/game/nameCountry";
import {
  NAME_CHALLENGE_PARAM,
  nameChallengeLine,
  nameChallengeOrder,
  nameChallengeText,
  parseNameChallenge,
  type NameChallenge,
} from "@/lib/game/nameChallenge";
import {
  dailyNameOrder,
  dailyNameSeed,
  loadNameDay,
  nameDailyShare,
  rememberNameDay,
} from "@/lib/game/nameDaily";

import { sendShare, type ShareOutcome } from "@/lib/share";

import ControlsHelp from "./ControlsHelp";
import { DailyRunResult, ShareDay } from "./DailyRunShare";
import GamesMenu from "./GamesMenu";
import PhotoViewer from "./PhotoViewer";

type NameCountryProps = {
  deck: Deck;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
  /** For tests: the randomness that deals each run. */
  random?: () => number;
  /**
   * Today's run (src/lib/game/nameDaily.ts): the day's photos and names, one try a day, picked
   * back up where it was left, with a share line at the end. Off, every run is shuffled at random.
   */
  daily?: boolean;
  /** For tests: the clock that picks today's run. */
  now?: () => Date;
};

/** "1 country", "4 countries". */
function countries(n: number): string {
  return `${n} ${n === 1 ? "country" : "countries"}`;
}

/** Why a challenge link was set aside for a fresh run. */
export const NAME_CHALLENGE_NOTICE = {
  malformed: "That challenge link was cut short, so here's a fresh run instead.",
  missing: "That challenge's photos aren't in the game any more, so here's a fresh run instead.",
} as const;

/** The challenge the address carries, read once as the page opens; null without one. */
function linkedChallenge(dealable: readonly string[]) {
  const value = new URLSearchParams(window.location.search).get(NAME_CHALLENGE_PARAM);
  return value === null ? null : parseNameChallenge(value, dealable);
}

/** Take the challenge out of the address, so a reload deals a fresh run, not the old link. */
function dropChallengeParam() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(NAME_CHALLENGE_PARAM)) return;
  url.searchParams.delete(NAME_CHALLENGE_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

const CHALLENGE_NOTE: Record<ShareOutcome, string> = {
  shared: "Challenge sent.",
  copied: "Challenge link copied. Whoever opens it plays these photos, with these names.",
  cancelled: "",
  failed: "Couldn't copy the link. Your browser blocked the clipboard.",
};

/** "1 photo", "4 photos". */
function photos(n: number): string {
  return `${n} photo${n === 1 ? "" : "s"}`;
}

/**
 * Name the country (src/lib/game/nameCountry.ts): one photo, four countries from the same
 * continent; tap the right one. Endless until the first miss, with Atlas picking from its own
 * country probabilities.
 */
export default function NameCountry({
  deck,
  loadRecords,
  random,
  daily = false,
  now,
}: NameCountryProps) {
  const [state, dispatch] = useReducer(nameReducer, initialName);
  const [best, setBest] = useState(0);
  // The best before this run, so its end can say when it was beaten.
  const [bestBefore, setBestBefore] = useState(0);
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const [error, setError] = useState<string | null>(null);
  // Today's run: the day it was dealt for (kept when the clock passes midnight mid-run) and,
  // once it has ended, how it went, which shows instead of the game.
  const [day, setDay] = useState<string | null>(null);
  const [dayDone, setDayDone] = useState<DailyRun | null>(null);
  // A friend's challenge this run answers: their photos, names and streak to beat.
  const [challenge, setChallenge] = useState<NameChallenge | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Deal a run; `fromLink` takes up a challenge the address carries, as the page opens. */
  const start = useCallback(
    (fromLink = false) => {
      if (daily) {
        const today = runToday(now?.());
        const kept = loadNameDay(today);
        setDay(today);
        if (kept?.ended) {
          setDayDone(kept);
          return;
        }
        const { streak, atlasRight, atlasPlayed } = kept ?? FRESH_RUN;
        dispatch({
          type: "start",
          order: dailyNameOrder(nameIds(deck.streakIds, deck.regions), today),
          seed: dailyNameSeed(today),
          from: { streak, atlasRight, atlasPlayed },
        });
        return;
      }
      const ids = nameIds(deck.streakIds, deck.regions);
      const stored = loadBestName();
      setBest(stored);
      setBestBefore(stored);
      const linked = fromLink ? linkedChallenge(ids) : null;
      setNotice(linked && !linked.ok ? NAME_CHALLENGE_NOTICE[linked.reason] : null);
      if (linked?.ok) {
        const { challenge: c } = linked;
        setChallenge(c);
        dispatch({ type: "start", order: nameChallengeOrder(c, ids), seed: c.seed });
        return;
      }
      setChallenge(null);
      dropChallengeParam();
      const seed = Math.floor((random ?? Math.random)() * 2 ** 32);
      dispatch({ type: "start", order: seededShuffle(ids, seed), seed });
    },
    [daily, deck.regions, deck.streakIds, now, random],
  );

  // The run is shuffled in the browser after hydration, never at build time.
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

  const id = playing?.order[playing.index];
  const seed = playing?.seed;
  const current = id ? records.get(id) : undefined;
  const upcoming = playing ? records.get(playing.order[playing.index + 1]) : undefined;

  useEffect(() => {
    if (upcoming) new Image().src = upcoming.photo.imageUrl;
  }, [upcoming]);

  const truth = current?.photo.country;
  const options = useMemo(
    () =>
      truth && id && seed !== undefined
        ? nameOptions(truth, deck.countryPool, nameSeed(seed, id))
        : [],
    [truth, id, seed, deck.countryPool],
  );

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
      const after = nameReducer(state, action);
      if (after.phase === "answered" && day) {
        // Today's run is kept after every tap, so a reload resumes it and never deals it again.
        const cleared = after.correct && after.index + 1 >= after.order.length;
        rememberNameDay(day, {
          streak: after.streak,
          atlasRight: after.atlasRight,
          atlasPlayed: after.atlasPlayed,
          ended: !after.correct ? "miss" : cleared ? "cleared" : null,
        });
      } else if (after.phase === "answered" && after.correct && !challenge) {
        // Keep the run as the best after every right tap, so leaving mid-run keeps it. A
        // challenge's photos may have been seen before, so it is played for the friend only.
        setBest(rememberName(after.streak));
      }
      dispatch(action);
    },
    [state, current, options, day, challenge],
  );

  // 1 to 4 pick a name from the keyboard. Attached before paint, so a key pressed the moment the
  // names appear is never lost to a listener that hasn't caught up.
  useLayoutEffect(() => {
    if (state.phase !== "guessing" || options.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e)) return;
      const pick = options[Number(e.key) - 1];
      if (pick) choose(pick);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.phase, options, choose]);

  // A day that has ended, on this visit or an earlier one, shows its result and never deals again.
  const dayResult =
    dayDone ??
    (day && state.phase === "cleared"
      ? {
          streak: state.streak,
          atlasRight: state.atlasRight,
          atlasPlayed: state.atlasPlayed,
          ended: "cleared" as const,
        }
      : null);
  if (day && dayResult) {
    const cleared = dayResult.ended === "cleared";
    return (
      <DailyRunResult
        game="Name the country"
        day={day}
        headline={cleared ? "You named every photo" : `${countries(dayResult.streak)} in a row`}
        summary={
          "That's today's run played." +
          (dayResult.atlasPlayed > 0
            ? ` Atlas got ${dayResult.atlasRight} of the ${photos(dayResult.atlasPlayed)} it played.`
            : "")
        }
        shareText={(href) => nameDailyShare(day, dayResult, href)}
        freeHref="/name-country"
        now={now}
      />
    );
  }

  if (state.phase === "none" || state.phase === "cleared") {
    const cleared = state.phase === "cleared";
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-6 py-16">
        <p className="text-sm text-gold">Name the country</p>
        <h1 className="mt-2 font-sign text-5xl font-extrabold leading-none tracking-tight">
          {cleared ? `All ${state.streak} named` : "No photos to play yet"}
        </h1>
        <p className="mt-4 text-lg text-chalk-dim">
          {cleared
            ? "You named the country of every photo in the game without a miss."
            : "Name the country needs photos taken in countries the globe draws."}
          {cleared && challenge && ` ${nameChallengeLine(state.streak, challenge)}`}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          {cleared && (
            <button
              type="button"
              onClick={() => start()}
              className="rounded-full bg-gold px-6 py-3 font-semibold text-ocean-deep transition hover:brightness-110"
            >
              {challenge ? "Play a fresh run" : "Start a new run"}
            </button>
          )}
          {cleared && <ChallengeButton run={state} answering={challenge} />}
          <Link href="/" className="text-chalk-dim underline underline-offset-2 hover:text-chalk">
            Back to the main game
          </Link>
        </div>
      </main>
    );
  }

  const streak = playing?.streak ?? 0;
  const over = nameOver(state);
  // Atlas guessed this photo, but gave none of the four names anything.
  const atlasOutOfIt = answered && current?.atlas ? answered.atlas === null : false;

  return (
    <main
      className="relative flex h-dvh w-full flex-col overflow-hidden bg-ocean-deep"
      data-phase={answered ? "revealed" : "guessing"}
      data-photo={current?.photo.id}
    >
      <h1 className="sr-only">{`Whereabout: Name the country, streak ${streak}`}</h1>

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
              ? `Today's run, ${day}`
              : challenge
                ? `A friend's challenge: ${countries(challenge.streak)} in a row to beat`
                : "Name the country: which of these four?"}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <GamesMenu screen="name-country" streakHref="/streak" />
            <ControlsHelp screen="name-country" />
            <Link
              href={daily ? "/name-country" : "/name-country/daily"}
              className="whitespace-nowrap text-sm text-gold underline underline-offset-2 hover:brightness-110"
            >
              {daily ? "Free runs" : "Today's run"}
            </Link>
          </div>
        </div>
        <div className="shrink-0">
          <dl className="text-right">
            <dt className="text-sm text-chalk-dim">Streak</dt>
            <dd className="font-sign tabular text-3xl font-bold leading-none" aria-live="polite">
              {streak}
            </dd>
            {!daily && (
              <div className="mt-1 flex justify-end gap-1.5 text-sm text-chalk-dim">
                <dt>Best</dt>
                <dd className="tabular">{best}</dd>
              </div>
            )}
          </dl>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden" data-testid="name-photo">
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

      {/* Names, then the answer under them: the photo gives way, so both stay on a phone. */}
      <div className="z-10 mx-auto grid w-full max-w-3xl shrink-0 grid-cols-2 gap-2 px-2 pt-2 md:grid-cols-4 md:px-6 md:pt-3">
        {options.map((country, i) => (
          <NameOption
            key={country}
            n={i + 1}
            country={country}
            truth={answered?.truth ?? null}
            picked={answered?.picked ?? null}
            atlas={answered?.atlas ?? null}
            onPick={choose}
          />
        ))}
      </div>

      {notice && !answered && playing?.index === 0 && (
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
          <NameCard
            key={current.photo.id}
            record={current}
            correct={answered.correct}
            atlas={answered.atlas}
            atlasOutOfIt={atlasOutOfIt}
            atlasTally={[answered.atlasRight, answered.atlasPlayed]}
            streak={answered.streak}
            over={over}
            best={best}
            newBest={over && answered.streak > bestBefore}
            daily={day}
            run={answered}
            challenge={challenge}
            onNext={over ? () => start() : () => dispatch({ type: "next" })}
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

function NameOption({
  n,
  country,
  truth,
  picked,
  atlas,
  onPick,
}: {
  n: number;
  country: string;
  truth: string | null;
  picked: string | null;
  atlas: AtlasName | null;
  onPick: (country: string) => void;
}) {
  const revealed = truth !== null;
  const tone = !revealed
    ? "border-graticule bg-ocean hover:border-gold focus-visible:border-gold"
    : country === truth
      ? "border-sonar bg-sonar/20"
      : country === picked
        ? "border-flare bg-flare/20"
        : "border-graticule/50 text-chalk-dim";

  return (
    <button
      type="button"
      onClick={() => onPick(country)}
      disabled={revealed}
      aria-keyshortcuts={String(n)}
      data-testid={`name-option-${n}`}
      data-country={country}
      className={`flex min-h-12 items-center gap-2 rounded-2xl border-2 px-3 py-2 text-left font-semibold outline-none transition-colors ${tone}`}
    >
      <span aria-hidden="true" className="font-sign text-sm text-chalk-dim">
        {n}
      </span>
      <span className="min-w-0 flex-1 leading-tight">{countryName(country)}</span>
      {atlas?.picked === country && (
        <span className="shrink-0 rounded-full border border-gold px-1.5 text-xs text-gold">
          Atlas
        </span>
      )}
    </button>
  );
}

/** Atlas's line: what it picked of the four, and how much it gave that. */
function atlasSentence(atlas: AtlasName): string {
  const name = countryName(atlas.picked);
  const result = atlas.correct ? "and got it" : "wrong";
  return `Of these four, Atlas leaned most to ${name} (${atlasPercent(atlas.p)}%), ${result}.`;
}

function NameCard({
  record,
  correct,
  atlas,
  atlasOutOfIt,
  atlasTally,
  streak,
  over,
  best,
  newBest,
  daily,
  run,
  challenge,
  onNext,
}: {
  record: GameRecord;
  correct: boolean;
  atlas: AtlasName | null;
  /** Atlas guessed this photo but gave none of the four anything. */
  atlasOutOfIt: boolean;
  atlasTally: readonly [number, number];
  streak: number;
  over: boolean;
  best: number;
  newBest: boolean;
  /** Today's run's day, when this is it: its end shares the day instead of starting again. */
  daily: string | null;
  /** The run as it stands, for the challenge link its end can send. */
  run: { order: readonly string[]; index: number; seed: number; streak: number };
  /** The friend's challenge this run answers, if it is one. */
  challenge: NameChallenge | null;
  onNext: () => void;
}) {
  const nextRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, []);
  const { place, country, credit } = record.photo;
  const continent = continentOf(country);
  const [atlasRight, atlasPlayed] = atlasTally;
  const photoCredit = (
    <a
      href={credit.sourceUrl}
      target="_blank"
      rel="noreferrer"
      className="block min-w-0 truncate text-xs text-chalk-dim underline decoration-graticule underline-offset-2 hover:text-chalk"
    >
      Photo: {credit.author}, {credit.license}
    </a>
  );

  return (
    <section
      aria-labelledby="name-verdict"
      className="w-full max-w-3xl rounded-2xl border border-graticule/70 bg-ocean-deep/95 p-3 shadow-2xl md:p-4"
    >
      <h2
        id="name-verdict"
        className={`font-sign text-2xl font-extrabold leading-tight md:text-3xl ${correct ? "text-sonar" : "text-flare"}`}
      >
        {`${correct ? "Right" : "Wrong"}: ${countryName(country)}`}
      </h2>
      <p className="mt-1 text-chalk">{continent ? `${place}, ${continent}` : place}</p>
      {atlas && (
        <p className="mt-1 text-sm text-chalk-dim">
          {`${atlasSentence(atlas)} Atlas this run: ${atlasRight} of ${photos(atlasPlayed)}.`}
        </p>
      )}
      {atlasOutOfIt && (
        <p className="mt-1 text-sm text-chalk-dim">
          Atlas gave none of these four a chance, so it sat this one out.
        </p>
      )}
      {over && daily && (
        <p className="mt-1 text-chalk">{`Today's run is over: ${countries(streak)} in a row.`}</p>
      )}
      {challenge && correct && streak === challenge.streak + 1 && (
        <p className="mt-1 font-semibold text-sonar">
          {`That beats your friend's ${challenge.streak} in a row!`}
        </p>
      )}
      {over && !daily && (
        <p className="mt-1 text-chalk">
          {`Run over: ${countries(streak)} in a row. `}
          {challenge
            ? nameChallengeLine(streak, challenge)
            : newBest
              ? "That's your new best!"
              : best > 0
                ? `Your best is ${countries(best)}.`
                : ""}
        </p>
      )}
      {over && daily ? (
        <>
          <ShareDay
            shareText={(href) =>
              nameDailyShare(daily, { streak, atlasRight, atlasPlayed, ended: "miss" }, href)
            }
            freeHref="/name-country"
            focus
          />
          {photoCredit}
        </>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 md:mt-3">
            <button
              ref={nextRef}
              type="button"
              onClick={onNext}
              className="shrink-0 rounded-full bg-gold px-6 py-2.5 font-semibold text-ocean-deep transition hover:brightness-110"
            >
              {over ? (challenge ? "Play a fresh run" : "Start a new run") : "Next photo"}
            </button>
            {over ? <ChallengeButton run={run} answering={challenge} compact /> : photoCredit}
          </div>
          {over && photoCredit}
        </>
      )}
    </section>
  );
}

/**
 * Challenge a friend from a finished run (src/lib/game/nameChallenge.ts): a link to the same
 * photos and names, and the streak to beat. Answering a challenge, it sends the reply back.
 */
function ChallengeButton({
  run,
  answering,
  compact = false,
}: {
  run: { order: readonly string[]; index: number; seed: number; streak: number };
  answering: NameChallenge | null;
  /** On the answer card, where it shares a row with the button for a new run. */
  compact?: boolean;
}) {
  const [sent, setSent] = useState("");
  async function send() {
    const text = nameChallengeText(run, window.location.href, answering ?? undefined);
    setSent(CHALLENGE_NOTE[await sendShare(text, navigator)]);
  }
  return (
    <span className={compact ? "flex min-w-0 flex-col" : "flex flex-col"}>
      <button
        type="button"
        onClick={send}
        className={`rounded-full border-2 border-gold font-semibold text-gold transition hover:bg-gold/10 ${compact ? "px-4 py-2" : "px-5 py-2.5"}`}
      >
        {answering ? "Send yours back" : "Challenge a friend"}
      </button>
      <span role="status" className={sent ? "mt-1 text-xs text-chalk-dim" : "sr-only"}>
        {sent}
      </span>
    </span>
  );
}
