"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { ApiBackend, LocalBackend } from "@/lib/game/backends";
import {
  BLITZ_SECONDS,
  clockWithTimeLeft,
  fractionLeft,
  pauseClock,
  remainingMs,
  rememberBlitz,
  resumeClock,
  secondsShown,
  startClock,
  timeUp,
  type BlitzBest,
  type BlitzClock,
} from "@/lib/game/blitz";
import { CHALLENGE_PARAM, encodeChallenge, parseChallenge, sumScores } from "@/lib/game/challenge";
import { dayKey, pickDaily } from "@/lib/game/daily";
import { fetchRecords, recordUrl, type Deck, type GameRecord } from "@/lib/game/deck";
import { loadRecent, pickFresh, rememberPlayed, saveRecent } from "@/lib/game/fresh";
import type { GameMode } from "@/lib/game/mode";
import { gameToResume, loadSaved, snapshot, storeSaved, type SavedGame } from "@/lib/game/saved";
import { ROUNDS_PER_GAME, gameReducer, initialState, totals } from "@/lib/game/state";
import {
  offeredRegions,
  regionBlurb,
  regionFromSlug,
  regionSlug,
  type Regions,
} from "@/lib/game/regions";
import { TIERS, TIER_NAMES, isTier, tierBlurb, type Tier, type Tiers } from "@/lib/game/tiers";
import type { Continent } from "@/lib/continents";
import type { CatalogPhoto, GameBackend } from "@/lib/game/types";
import { formatPoints, maxPoints, type LngLat } from "@/lib/geo";
import type { Clue } from "@/lib/hints";
import { hasSeenIntro, INTRO_TEXT, markIntroSeen } from "@/lib/intro";
import { keepForOffline, photoUrlsToKeep } from "@/lib/offline/register";
import { gameFeats, newBadges, type BadgeId } from "@/lib/badges";
import {
  loadRecord,
  recordGame,
  resetRecord,
  tallyContinents,
  type PlayerRecord,
} from "@/lib/playerRecord";
import type { RevealView } from "@/lib/reveal";

import BlitzRing from "./BlitzRing";
import Globe from "./Globe";
import PhotoViewer from "./PhotoViewer";
import RevealCard from "./RevealCard";
import Summary from "./Summary";

export type { GameMode } from "@/lib/game/mode";

export function modeTitle(mode: GameMode): string {
  if (mode.kind === "fresh") return "Fresh game";
  if (mode.kind === "tier") return `${TIER_NAMES[mode.tier]} game`;
  if (mode.kind === "region") return `${mode.region} game`;
  if (mode.kind === "challenge") return "A friend's challenge";
  if (mode.kind === "blitz") return "Blitz";
  const label = new Date(`${mode.day}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return `Daily Five, ${label}`;
}

type GameProps = {
  /**
   * The photos this site can deal (only those Atlas has guessed, src/lib/game/playable.ts).
   * Their records are fetched five at a time as games are dealt.
   */
  deck: Deck;
  /** Base URL of the FastAPI backend. Without one, rounds are played from the bundled catalog. */
  apiUrl?: string;
  /** Which game a visit opens on. Defaults to `?daily` in the URL, otherwise a fresh game. */
  start?: GameMode["kind"];
  /** For tests: the date that decides the Daily Five. Defaults to now, read in the browser. */
  today?: Date;
  /** For tests: supply the backend directly. */
  backendFor?: (photos: CatalogPhoto[]) => GameBackend;
  /** For tests: load records without the network. Defaults to fetching the static files. */
  loadRecords?: (ids: string[]) => Promise<GameRecord[]>;
};

/** True when the page URL asks for the Daily Five (`?daily`). */
function urlWantsDaily(): boolean {
  return new URLSearchParams(window.location.search).has("daily");
}

/** True when the page URL asks for a Blitz game (`?blitz`). */
function urlWantsBlitz(): boolean {
  return new URLSearchParams(window.location.search).has("blitz");
}

/** The tier the page URL asks for (`?tier=hard`), if it names one. */
function urlTier(): Tier | null {
  const tier = new URLSearchParams(window.location.search).get("tier");
  return isTier(tier) ? tier : null;
}

/** The continent the page URL asks for (`?region=europe`), if it names one. */
function urlRegion(): Continent | null {
  return regionFromSlug(new URLSearchParams(window.location.search).get("region"));
}

/** The friend's challenge the page URL carries (`?challenge=`), or null without one. */
function urlChallenge(deckIds: readonly string[]): ReturnType<typeof parseChallenge> | null {
  const value = new URLSearchParams(window.location.search).get(CHALLENGE_PARAM);
  return value === null ? null : parseChallenge(value, deckIds);
}

export const CHALLENGE_NOTICE = {
  malformed: "That challenge link was cut short, so here's a fresh game instead.",
  missing: "That challenge's photos aren't in the game any more, so here's a fresh game instead.",
} as const;

/** Keep the address bar in step with the mode, so a shared link opens the same kind of game. */
function syncUrl(mode: GameMode) {
  const url = new URL(window.location.href);
  if (mode.kind === "daily") url.searchParams.set("daily", "");
  else url.searchParams.delete("daily");
  if (mode.kind === "tier") url.searchParams.set("tier", mode.tier);
  else url.searchParams.delete("tier");
  if (mode.kind === "region") url.searchParams.set("region", regionSlug(mode.region));
  else url.searchParams.delete("region");
  if (mode.kind === "challenge")
    url.searchParams.set(CHALLENGE_PARAM, encodeChallenge(mode.challenge));
  else url.searchParams.delete(CHALLENGE_PARAM);
  if (mode.kind === "blitz") url.searchParams.set("blitz", "");
  else url.searchParams.delete("blitz");
  const search = url.search.replace(/(daily|blitz)=(?=&|$)/g, "$1");
  const next = `${url.pathname}${search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, "", next);
  }
}

/**
 * Words dropped from the header's buttons on phones narrower than 400px (a 360px Android has
 * room for about 330px of controls), leaving labels that still say what each one does.
 */
const NARROW_HIDDEN = "max-[399px]:hidden";

/** What the picker can deal from: a difficulty third, a continent, or the whole catalog. */
export type PhotoChoice = { tier: Tier } | { region: Continent } | null;

/**
 * "Any photos", one difficulty tier or one continent; picking one deals a new game from it. One
 * control for both, so the header stays one row on a phone and the photo stays the hero.
 */
function PhotoPicker({
  tiers,
  regions,
  value,
  onPick,
}: {
  tiers: Tiers | null;
  regions: Continent[];
  /** The select's value: "any", a tier ("hard") or a continent's slug ("south-america"). */
  value: string;
  onPick: (choice: PhotoChoice) => void;
}) {
  return (
    <select
      aria-label="Which photos: how hard they were for Atlas, or where they were taken"
      title="Which photos: how hard each was for Atlas, or one continent"
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        const region = regionFromSlug(v);
        onPick(isTier(v) ? { tier: v } : region ? { region } : null);
      }}
      className="pointer-events-auto max-w-32 rounded-full border border-chalk/30 bg-ocean-deep/60 py-1 pl-3 pr-1 text-xs font-semibold text-chalk backdrop-blur transition hover:border-chalk"
    >
      <option value="any">Any photos</option>
      {tiers && (
        <optgroup label="How hard for Atlas">
          {TIERS.map((tier) => (
            <option key={tier} value={tier} title={tierBlurb(tier, tiers)}>
              {TIER_NAMES[tier]}
            </option>
          ))}
        </optgroup>
      )}
      {regions.length > 0 && (
        <optgroup label="Where">
          {regions.map((region) => (
            <option key={region} value={regionSlug(region)}>
              {region}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

export default function Game({ apiUrl, deck, start, today, backendFor, loadRecords }: GameProps) {
  // Tiers and continents choose which photos a game deals, so they only exist when the browser
  // deals them.
  const tiers = apiUrl ? null : deck.tiers;
  const regions: Regions = useMemo(() => (apiUrl ? {} : (deck.regions ?? {})), [apiUrl, deck]);
  const regionList = useMemo(() => offeredRegions(regions), [regions]);
  // The mode is decided in the browser after hydration: the URL, today's date and the photos
  // this browser played recently are all unknown when the static page is built.
  const [mode, setMode] = useState<GameMode | null>(null);
  const [state, dispatch] = useReducer(gameReducer, initialState);
  // The first-visit card. Browser storage is only readable after hydration, so it starts closed.
  const [introOpen, setIntroOpen] = useState(false);
  // The player's record against Atlas, updated once as each game ends (see `next` below).
  const [record, setRecord] = useState<PlayerRecord | null>(null);
  // The badges the game just finished earned, marked "New" on the summary.
  const [earned, setEarned] = useState<BadgeId[]>([]);
  // A finished game's round shown again from the summary (index from 0), or null for the
  // summary itself; `lookedAt` is the last one shown, so the summary can return focus to it.
  const [replay, setReplay] = useState<number | null>(null);
  const [lookedAt, setLookedAt] = useState<number | null>(null);
  // Why a challenge link in the address couldn't be played, until the next game starts.
  const [challengeNotice, setChallengeNotice] = useState<string | null>(null);
  // A finished Blitz game against the best kept in this browser, shown on the summary.
  const [blitzBest, setBlitzBest] = useState<BlitzBest | null>(null);
  // The kept game this visit reopened (src/lib/game/saved.ts). It applies only while its own
  // mode is playing: any new game is a new mode value, so it lets go by itself.
  const [resumed, setResumed] = useState<SavedGame | null>(null);
  const resumedFor = resumed && resumed.mode === mode ? resumed : null;

  useEffect(() => {
    if (mode) return;
    const id = requestAnimationFrame(() => {
      // Challenges are dealt by the browser, so the API backend leaves them alone.
      const linked = start || apiUrl ? null : urlChallenge(deck.ids);
      if (linked && !linked.ok) setChallengeNotice(CHALLENGE_NOTICE[linked.reason]);
      // Blitz deals in the browser like tiers and continents; the API backend plays untimed.
      const blitz = !start && !apiUrl && !urlWantsDaily() && urlWantsBlitz();
      const kind = start ?? (urlWantsDaily() ? "daily" : "fresh");
      const tier = kind === "fresh" && tiers ? urlTier() : null;
      const wanted = kind === "fresh" && !tier ? urlRegion() : null;
      const region = wanted && regions[wanted] ? wanted : null;
      const day = dayKey(today ?? new Date());
      const requested: GameMode = linked?.ok
        ? { kind: "challenge", challenge: linked.challenge }
        : blitz
          ? { kind: "blitz", game: 1 }
          : kind === "daily"
            ? { kind: "daily", day }
            : tier
              ? { kind: "tier", tier, game: 1 }
              : region
                ? { kind: "region", region, game: 1 }
                : { kind: "fresh", game: 1 };
      // The plain address reopens whatever game was left unfinished; an address asking for a
      // particular game reopens it only if that is the one kept.
      const explicit =
        !!start || linked !== null || blitz || kind === "daily" || !!tier || !!wanted;
      const saved = apiUrl
        ? null
        : gameToResume(loadSaved(deck.ids, Date.now()), requested, explicit, day);
      setIntroOpen(!hasSeenIntro());
      if (saved) {
        setResumed(saved);
        dispatch({ type: "resumed", results: saved.results });
        setMode(saved.mode);
        return;
      }
      // Starting another game lets the kept one go.
      if (!apiUrl) storeSaved(null);
      setMode(requested);
    });
    return () => cancelAnimationFrame(id);
  }, [mode, start, today, tiers, regions, apiUrl, deck.ids]);

  const pool = useMemo(() => deck.ids.map((id) => ({ id })), [deck.ids]);

  // Each fresh game is drawn once per mode change and avoids the photos played lately; a tier
  // or continent game does the same within its part of the catalog.
  const dealt = useMemo(() => {
    if (!mode) return [];
    // A game picked up after a reload keeps the photos it was dealt.
    if (resumedFor) return resumedFor.dealt;
    const within = (ids: readonly string[]) =>
      pickFresh(
        ids.map((id) => ({ id })),
        loadRecent(),
        ROUNDS_PER_GAME,
      );
    const picked =
      mode.kind === "challenge"
        ? mode.challenge.ids.map((id) => ({ id }))
        : mode.kind === "daily"
          ? pickDaily(pool, mode.day, ROUNDS_PER_GAME)
          : mode.kind === "tier" && tiers
            ? within(tiers[mode.tier].ids)
            : mode.kind === "region" && regions[mode.region]
              ? within(regions[mode.region]!)
              : pickFresh(pool, loadRecent(), ROUNDS_PER_GAME);
    return picked.map((p) => p.id);
  }, [mode, pool, tiers, regions, resumedFor]);

  // Remember what was dealt, so the next visit or fresh game opens on other photos.
  useEffect(() => {
    if (dealt.length === 0) return;
    const limit = Math.max(0, pool.length - ROUNDS_PER_GAME);
    saveRecent(rememberPlayed(loadRecent(), dealt, limit));
  }, [dealt, pool]);

  // Records fetched so far, by photo id: the photo, its size and Atlas's guess.
  const [records, setRecords] = useState<ReadonlyMap<string, GameRecord>>(() => new Map());
  const load = useCallback(
    (ids: string[]) => (loadRecords ? loadRecords(ids) : fetchRecords(deck, ids)),
    [deck, loadRecords],
  );
  const remember = useCallback((loaded: GameRecord[]) => {
    setRecords((known) => {
      const next = new Map(known);
      for (const r of loaded) next.set(r.photo.id, r);
      return next;
    });
  }, []);

  // A local game needs its five records before the first round; fetch them as soon as dealt.
  useEffect(() => {
    if (apiUrl || dealt.length === 0) return;
    let cancelled = false;
    load(dealt)
      .then((loaded) => !cancelled && remember(loaded))
      .catch((err: Error) => !cancelled && dispatch({ type: "failed", message: err.message }));
    return () => {
      cancelled = true;
    };
  }, [apiUrl, dealt, load, remember]);

  const gamePhotos = useMemo<CatalogPhoto[] | null>(() => {
    if (dealt.length === 0 || dealt.some((id) => !records.has(id))) return null;
    return dealt.map((id) => records.get(id)!.photo);
  }, [dealt, records]);

  // Keep all five photos and records on the device as soon as they are dealt, so a game that has
  // started keeps going if the connection drops (the service worker, src/sw/sw.ts, stores them).
  useEffect(() => {
    if (!gamePhotos || apiUrl) return;
    keepForOffline([
      ...dealt.map((id) => recordUrl(deck.version, id)),
      ...photoUrlsToKeep(gamePhotos),
    ]);
  }, [gamePhotos, apiUrl, dealt, deck.version]);

  useEffect(() => {
    if (mode) syncUrl(mode);
  }, [mode]);

  const backend = useMemo<GameBackend | null>(() => {
    if (!mode) return null;
    if (apiUrl && !backendFor) return new ApiBackend(apiUrl);
    if (!gamePhotos) return null;
    // A resumed game's backend starts on the first round not yet played.
    const played = resumedFor?.results.length ?? 0;
    return backendFor ? backendFor(gamePhotos) : new LocalBackend(gamePhotos, played);
  }, [mode, gamePhotos, apiUrl, backendFor, resumedFor]);

  // The round that was on screen when a kept game was left: its pin, hints and Blitz clock come
  // back with it. Only for the first round after a resume.
  const restoring =
    resumedFor?.round && state.phase === "loading" && state.index === resumedFor.results.length
      ? resumedFor.round
      : null;
  // A resumed Blitz round's clock picks up with the time it had left, not a fresh 30 seconds.
  const restoredClock = useRef<{ roundId: string; msLeft: number } | null>(null);

  // Start each round as soon as the game enters the loading phase.
  useEffect(() => {
    if (!backend || state.phase !== "loading" || state.error) return;
    let cancelled = false;
    (async () => {
      const round = await backend.startRound();
      const restore = restoring?.photoId === round.photo.id ? restoring : null;
      // Hints taken before the reload are taken again, so the round's cap stays where it was.
      let clues: Clue[] = [];
      const hints = Math.min(restore?.hintsUsed ?? 0, round.hintsAvailable);
      for (let i = 0; i < hints; i++) clues = await backend.hint(round.roundId);
      if (cancelled) return;
      if (restore?.blitzMsLeft !== undefined) {
        restoredClock.current = { roundId: round.roundId, msLeft: restore.blitzMsLeft };
      }
      dispatch({ type: "started", round, pin: restore?.pin ?? null, clues });
    })().catch((err: Error) => !cancelled && dispatch({ type: "failed", message: err.message }));
    return () => {
      cancelled = true;
    };
  }, [backend, state, restoring]);

  // Warm the cache with the next photo while the player reads the reveal.
  useEffect(() => {
    if (state.phase !== "revealed" || backend?.kind !== "local") return;
    const next = gamePhotos?.[state.index + 1];
    if (next) new Image().src = next.imageUrl;
  }, [state, backend, gamePhotos]);

  // The API deals its own photos: fetch each round's record for its size and, from an older
  // server that leaves Atlas to the client, Atlas's guess. Best effort; the round plays without.
  const roundId = state.phase === "guessing" ? state.round.photo.id : null;
  useEffect(() => {
    if (!apiUrl || !roundId || records.has(roundId) || !deck.ids.includes(roundId)) return;
    load([roundId])
      .then(remember)
      .catch(() => {});
  }, [apiUrl, roundId, records, deck.ids, load, remember]);

  // The player's first tap (or key press) on the photo or the globe dismisses the card for good.
  // It listens in the capture phase and never stops the event, so that tap still zooms or pins.
  // Only attached while the card is open.
  const dismissIntro = useCallback(() => {
    markIntroSeen();
    setIntroOpen(false);
  }, []);

  // Back (the button, or the browser's) closes the replay: the summary is the entry below it.
  const replaying = replay !== null;
  useEffect(() => {
    if (!replaying) return;
    const onPop = () => setReplay(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [replaying]);

  const onPinChange = useCallback((pin: LngLat) => dispatch({ type: "pinned", pin }), []);

  // Blitz: each photo's clock starts once the photo is on screen and runs only while the page
  // is visible. `now` ticks a few times a second to redraw the ring and to notice time is up.
  const blitz = mode?.kind === "blitz";
  const guessingId = state.phase === "guessing" ? state.round.roundId : null;
  const [clock, setClock] = useState<{ roundId: string; clock: BlitzClock } | null>(null);
  const [now, setNow] = useState(0);
  const roundClock = blitz && clock && clock.roundId === guessingId ? clock.clock : null;
  // The round whose clock already locked its guess in, so time up fires once.
  const lockedFor = useRef<string | null>(null);
  const onPhotoShown = useCallback(() => {
    if (!blitz || !guessingId) return;
    const t = performance.now();
    const kept = restoredClock.current;
    const fresh = kept?.roundId === guessingId ? clockWithTimeLeft(t, kept.msLeft) : startClock(t);
    lockedFor.current = null;
    setNow(t);
    setClock({ roundId: guessingId, clock: document.hidden ? pauseClock(fresh, t) : fresh });
  }, [blitz, guessingId]);

  useEffect(() => {
    if (!roundClock) return;
    const onVisibility = () => {
      const t = performance.now();
      setNow(t);
      setClock(
        (c) =>
          c && { ...c, clock: document.hidden ? pauseClock(c.clock, t) : resumeClock(c.clock, t) },
      );
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [roundClock]);

  const ticking = roundClock !== null && state.phase === "guessing" && !state.submitting;
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setNow(performance.now()), 200);
    return () => window.clearInterval(id);
  }, [ticking]);

  // Time up locks the guess in once per round, wherever the pin is, or with no pin at all.
  const onTimeUp = useEffectEvent(() => {
    if (state.phase !== "guessing" || state.submitting || !backend) return;
    if (lockedFor.current === state.round.roundId) return;
    lockedFor.current = state.round.roundId;
    dispatch({ type: "timeUp" });
    void send(state.round.roundId, state.pin);
  });
  const expired = ticking && roundClock !== null && timeUp(roundClock, now);
  useEffect(() => {
    if (expired) onTimeUp();
  }, [expired]);

  // Keep the game after every move, so a reload or a killed tab reopens it where it was. A
  // finished game is let go; the API backend's rounds live on its server, so they aren't kept.
  const persist = useEffectEvent(() => {
    if (!mode || apiUrl) return;
    if (state.phase === "finished") {
      storeSaved(null);
      return;
    }
    const left = roundClock ? remainingMs(roundClock, performance.now()) : null;
    const kept = snapshot(mode, dealt, state, Date.now(), left);
    if (kept) storeSaved(kept);
  });
  useEffect(() => {
    persist();
  }, [state, mode, dealt, roundClock]);
  // Leaving the page (a reload, switching apps, the phone closing the tab) keeps the latest,
  // including how long a Blitz round's clock has left.
  useEffect(() => {
    const onLeave = () => persist();
    document.addEventListener("visibilitychange", onLeave);
    window.addEventListener("pagehide", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onLeave);
      window.removeEventListener("pagehide", onLeave);
    };
  }, []);

  async function send(roundId: string, pin: LngLat | null) {
    if (!backend) return;
    try {
      const reveal = await backend.guess(roundId, pin);
      // The server's word on Atlas wins; otherwise use the guesses bundled with the site.
      const photoId = state.phase === "guessing" ? state.round.photo.id : null;
      const atlasGuess =
        reveal.atlas !== undefined
          ? reveal.atlas
          : ((photoId ? records.get(photoId)?.atlas : null) ?? null);
      dispatch({ type: "revealed", reveal, atlas: atlasGuess });
    } catch (err) {
      dispatch({ type: "failed", message: (err as Error).message });
    }
  }

  async function submit() {
    if (state.phase !== "guessing" || !state.pin || state.submitting || !backend) return;
    dispatch({ type: "submitted" });
    await send(state.round.roundId, state.pin);
  }

  async function takeHint() {
    if (state.phase !== "guessing" || state.hinting || state.submitting || !backend) return;
    if (state.clues.length >= state.round.hintsAvailable) return;
    dispatch({ type: "hintRequested" });
    try {
      dispatch({ type: "hinted", clues: await backend.hint(state.round.roundId) });
    } catch (err) {
      dispatch({ type: "failed", message: (err as Error).message });
    }
  }

  /** Next photo, or the summary after the last round: that is when the game joins the record. */
  function next() {
    if (state.phase === "revealed" && state.index + 1 >= ROUNDS_PER_GAME && mode) {
      const t = totals(state.results);
      const before = loadRecord().badges;
      const after = recordGame({
        score: t.player,
        roundsVsAtlas: t.atlasRounds,
        roundsWon: t.playerWins,
        daily: mode.kind === "daily" ? mode.day : null,
        continents: tallyContinents(state.results),
        ...gameFeats(state.results, mode.kind === "tier" && mode.tier === "hard"),
      });
      setRecord(after);
      setEarned(newBadges(before, after.badges));
      setBlitzBest(mode.kind === "blitz" ? rememberBlitz(t.player) : null);
    }
    dispatch({ type: "next" });
  }

  /** Every new game starts from round one, with no replay open. */
  function restart() {
    if (!apiUrl) storeSaved(null);
    setChallengeNotice(null);
    setBlitzBest(null);
    setReplay(null);
    setLookedAt(null);
    dispatch({ type: "restart" });
  }

  /**
   * Opens a finished round again. The summary gets a history entry of its own, so a phone's
   * back gesture returns to the results instead of leaving the game.
   */
  function openReplay(index: number) {
    if (replay === null) window.history.pushState({ ...window.history.state, wbReplay: true }, "");
    window.scrollTo(0, 0);
    setReplay(index);
    setLookedAt(index);
  }

  function closeReplay() {
    if (window.history.state?.wbReplay) window.history.back();
    else setReplay(null);
  }

  /**
   * Another game of the same kind: a tier or continent game stays where it was, the Daily Five
   * goes fresh.
   */
  function playFresh() {
    setMode((m) =>
      m?.kind === "tier" || m?.kind === "region" || m?.kind === "blitz"
        ? { ...m, game: m.game + 1 }
        : { kind: "fresh", game: m?.kind === "fresh" ? m.game + 1 : 1 },
    );
    restart();
  }

  /** A new game from one tier or continent, or from the whole catalog for "Any photos". */
  function playFrom(choice: PhotoChoice) {
    setMode((m) => {
      const game = m && "game" in m ? m.game + 1 : 1;
      if (choice && "tier" in choice) return { kind: "tier", tier: choice.tier, game };
      if (choice) return { kind: "region", region: choice.region, game };
      return { kind: "fresh", game };
    });
    restart();
  }

  function playBlitz() {
    setMode((m) => ({ kind: "blitz", game: m && "game" in m ? m.game + 1 : 1 }));
    restart();
  }

  function playDaily() {
    setMode({ kind: "daily", day: dayKey(today ?? new Date()) });
    restart();
  }

  const title = mode ? modeTitle(mode) : "";

  // The round on the reveal card: this game's latest guess, or a finished one looked at again.
  const replayed =
    state.phase === "finished" && replay !== null ? (state.results[replay] ?? null) : null;
  const shown = state.phase === "revealed" ? state.current : replayed;

  const revealView = useMemo<RevealView | null>(() => {
    if (!shown) return null;
    const current = shown;
    const guesses: RevealView["guesses"] = current.pin
      ? [{ actor: "player", at: current.pin }]
      : [];
    if (current.atlas) guesses.push({ actor: "atlas", at: current.atlas });
    return {
      truth: current.reveal.answer,
      guesses,
      ...(current.atlas?.belief ? { belief: current.atlas.belief } : {}),
    };
  }, [shown]);

  if (state.phase === "finished" && !replayed) {
    return (
      <Summary
        results={state.results}
        title={title}
        onPlayAgain={playFresh}
        playAgainLabel={
          mode?.kind === "tier"
            ? `Play another ${TIER_NAMES[mode.tier]} game`
            : mode?.kind === "region"
              ? `Play another ${mode.region} game`
              : mode?.kind === "blitz"
                ? "Play another Blitz"
                : undefined
        }
        onPlayDaily={mode?.kind === "daily" ? undefined : playDaily}
        record={record}
        newBadges={earned}
        today={today ?? new Date()}
        onResetRecord={() => {
          setEarned([]);
          setRecord(resetRecord());
        }}
        onReplay={openReplay}
        returnedFrom={lookedAt}
        canChallenge={!apiUrl}
        challenge={mode?.kind === "challenge" ? mode.challenge : undefined}
        blitz={blitzBest ?? undefined}
      />
    );
  }

  const round = state.phase === "guessing" ? state.round : (shown?.round ?? null);
  const pin = state.phase === "guessing" ? state.pin : (shown?.pin ?? null);
  const score = totals(state.results).player;
  const error = state.phase === "guessing" || state.phase === "loading" ? state.error : null;
  const index = state.phase === "finished" ? (replay ?? 0) : state.index;
  const roundNumber = index + 1;
  const roundSize = round ? records.get(round.photo.id)?.photo : undefined;
  const clues = state.phase === "guessing" ? state.clues : [];
  const hintsLeft = state.phase === "guessing" ? state.round.hintsAvailable - clues.length : 0;

  return (
    <main
      className="wb-stage relative h-dvh w-full overflow-hidden bg-ocean-deep"
      data-phase={shown ? "revealed" : state.phase}
      data-replay={replayed ? "true" : undefined}
    >
      <h1 className="sr-only">{`Whereabout: ${title}, ${replayed ? "looking again at " : ""}round ${roundNumber} of ${ROUNDS_PER_GAME}`}</h1>

      <div
        className="wb-photo"
        onPointerDownCapture={introOpen ? dismissIntro : undefined}
        onKeyDownCapture={introOpen ? dismissIntro : undefined}
      >
        {round ? (
          <PhotoViewer
            src={round.photo.imageUrl}
            roundKey={round.roundId}
            width={roundSize?.width}
            height={roundSize?.height}
            onShown={blitz ? onPhotoShown : undefined}
          />
        ) : (
          <div
            className="wb-photo-placeholder h-full w-full"
            data-photo-placeholder="showing"
            aria-hidden="true"
          />
        )}
        {introOpen && !shown && (
          // Taps pass straight through the card to the photo underneath.
          <div className="wb-intro pointer-events-none absolute inset-x-4 top-1/2 z-10 mx-auto max-w-xs -translate-y-1/2 rounded-2xl border border-chalk/20 bg-ocean-deep/80 px-4 py-3 text-center shadow-lg backdrop-blur md:top-[55%]">
            <p className="font-sign text-xl font-bold leading-tight">{INTRO_TEXT.title}</p>
            <p className="mt-1 text-sm text-chalk-dim">{INTRO_TEXT.body}</p>
          </div>
        )}
      </div>

      {/* Two lines: the title and the score side by side, then the controls across the whole
          width. Kept under the title column, the controls only had what the score left over,
          and on a 360px phone they ran off the screen. */}
      <header className="wb-header pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-x-4 px-4 pt-4 md:px-6">
        {/* Only the controls take taps: on a phone this column spans the photo, and its empty
            space must not swallow taps meant for the photo's own buttons underneath. A zero
            basis keeps a long notice from pushing the score onto a line of its own. */}
        <div className="min-w-0 flex-1 basis-0">
          <p className="font-sign text-3xl font-extrabold leading-none tracking-tight md:text-4xl">
            Whereabout
          </p>
          <p className="mt-1 text-sm text-chalk-dim">{title}</p>
          {mode?.kind === "tier" && tiers && (
            <p className="mt-1 inline-block rounded-full bg-ocean-deep/60 px-2 py-0.5 text-[11px] text-chalk-dim backdrop-blur">
              {tierBlurb(mode.tier, tiers)}
            </p>
          )}
          {mode?.kind === "region" && (
            <p className="mt-1 inline-block rounded-full bg-ocean-deep/60 px-2 py-0.5 text-[11px] text-chalk-dim backdrop-blur">
              {regionBlurb(mode.region, regions)}
            </p>
          )}
          {mode?.kind === "challenge" && !replayed && (
            <p className="mt-1 inline-block rounded-full bg-ocean-deep/60 px-2 py-0.5 text-[11px] text-gold backdrop-blur">
              Score to beat:{" "}
              <span className="tabular font-semibold">
                {formatPoints(sumScores(mode.challenge.scores))}
              </span>
            </p>
          )}
          {resumedFor && !shown && state.results.length === resumedFor.results.length && (
            <p
              role="status"
              className="mt-1 inline-block max-w-72 rounded-2xl bg-ocean-deep/60 px-2 py-0.5 text-[11px] text-chalk-dim backdrop-blur"
            >
              Picked up where you left off
            </p>
          )}
          {challengeNotice && !shown && (
            <p
              role="status"
              className="mt-1 inline-block max-w-72 rounded-2xl bg-ocean-deep/60 px-2 py-0.5 text-[11px] text-chalk-dim backdrop-blur"
            >
              {challengeNotice}
            </p>
          )}
        </div>
        <div className="pointer-events-auto text-right">
          <ol className="flex justify-end gap-1.5" aria-hidden="true">
            {Array.from({ length: ROUNDS_PER_GAME }, (_, i) => (
              <li
                key={i}
                className={`h-1.5 w-6 rounded-full ${
                  replayed
                    ? i === index
                      ? "bg-chalk"
                      : "bg-flare"
                    : i < state.results.length
                      ? "bg-flare"
                      : i === index
                        ? "bg-chalk"
                        : "bg-chalk/25"
                }`}
              />
            ))}
          </ol>
          <p className="mt-2 text-sm text-chalk-dim">
            {replayed ? "Looking again at round" : "Round"} {roundNumber} of {ROUNDS_PER_GAME}
          </p>
          <p className="font-sign tabular text-2xl font-bold">
            {formatPoints(score)}{" "}
            <span className="text-base font-normal text-chalk-dim">points</span>
          </p>
        </div>
        <div className="basis-full">
          {mode && !replayed && (
            // Labels shorten below 400px and the row wraps as a last resort, so on the
            // narrowest phones every control stays on screen instead of running off the edge.
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={mode.kind === "daily" ? playFresh : playDaily}
                className="pointer-events-auto shrink-0 rounded-full border border-chalk/30 bg-ocean-deep/60 px-3 py-1 text-xs font-semibold backdrop-blur transition hover:border-chalk"
              >
                {mode.kind === "daily" ? (
                  <>
                    New <span className={NARROW_HIDDEN}>random</span> game
                  </>
                ) : (
                  <>
                    <span className={NARROW_HIDDEN}>Play the</span> Daily Five
                  </>
                )}
              </button>
              {(tiers || regionList.length > 0) && (
                <PhotoPicker
                  tiers={tiers}
                  regions={regionList}
                  value={
                    mode.kind === "tier"
                      ? mode.tier
                      : mode.kind === "region"
                        ? regionSlug(mode.region)
                        : "any"
                  }
                  onPick={playFrom}
                />
              )}
              {!apiUrl && mode.kind !== "blitz" && (
                <button
                  type="button"
                  onClick={playBlitz}
                  title="30 seconds a photo: your pin goes in when time runs out"
                  className="pointer-events-auto shrink-0 rounded-full border border-flare/50 bg-ocean-deep/60 px-3 py-1 text-xs font-semibold text-flare backdrop-blur transition hover:border-flare"
                >
                  Blitz
                </button>
              )}
              {!apiUrl && deck.streakIds.length > 0 && (
                <Link
                  // From a continent game, the streak deals from the same continent.
                  href={
                    mode.kind === "region" ? `/streak?region=${regionSlug(mode.region)}` : "/streak"
                  }
                  className="pointer-events-auto shrink-0 rounded-full border border-chalk/30 bg-ocean-deep/60 px-3 py-1 text-xs font-semibold backdrop-blur transition hover:border-chalk"
                >
                  <span className={NARROW_HIDDEN}>Country</span> Streak
                </Link>
              )}
            </div>
          )}
          {!shown && (
            <Link
              href="/you"
              className="wb-try-atlas pointer-events-auto mt-2 flex max-w-60 items-center gap-2 rounded-full md:mt-3 md:gap-2.5 md:rounded-2xl border border-sonar/40 bg-ocean-deep/70 py-1 pl-1 pr-3 backdrop-blur transition hover:border-sonar md:px-3 md:py-2"
            >
              <span
                aria-hidden="true"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sonar/15 md:h-7 md:w-7 text-sonar"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M4 8h3l2-3h6l2 3h3v11H4z" strokeLinejoin="round" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
              </span>
              <span className="text-left leading-tight">
                <span className="block text-xs font-semibold text-sonar">
                  Try Atlas on your photo
                </span>
                <span className="hidden text-[11px] text-chalk-dim md:block">
                  Runs in your browser, stays private
                </span>
              </span>
            </Link>
          )}
        </div>
      </header>

      <div
        className="wb-globe-panel z-10"
        data-pinned={pin ? "true" : "false"}
        onPointerDownCapture={introOpen ? dismissIntro : undefined}
        onKeyDownCapture={introOpen ? dismissIntro : undefined}
      >
        <div className="wb-globe-frame">
          <Globe
            pin={pin}
            onPinChange={onPinChange}
            disabled={state.phase !== "guessing" || state.submitting}
            reveal={revealView}
            className="h-full"
          />
        </div>
        {!shown && (
          <div className="wb-guess-bar">
            {clues.length > 0 && (
              <div className="mb-2" aria-live="polite">
                <ol aria-label="Hints" className="flex flex-wrap gap-1.5">
                  {clues.map((clue) => (
                    <li
                      key={clue.kind}
                      className="rounded-full border border-gold/50 bg-ocean-deep/70 px-3 py-1 text-xs text-gold backdrop-blur"
                    >
                      {clue.text}
                    </li>
                  ))}
                </ol>
                <p className="mt-1 inline-block rounded-full bg-ocean-deep/70 px-2 py-0.5 text-[11px] text-chalk-dim backdrop-blur">
                  This round is now worth up to {formatPoints(maxPoints(clues.length))} points.
                </p>
              </div>
            )}
            <div className="flex items-center gap-2">
              {blitz && state.phase === "guessing" && (
                <BlitzRing
                  seconds={roundClock ? secondsShown(roundClock, now) : BLITZ_SECONDS}
                  fraction={roundClock ? fractionLeft(roundClock, now) : 1}
                  paused={!roundClock || roundClock.runningSince === null}
                />
              )}
              {hintsLeft > 0 && state.phase === "guessing" && (
                <button
                  type="button"
                  onClick={takeHint}
                  disabled={state.hinting || state.submitting}
                  aria-label={`Take a hint: the round will be worth up to ${formatPoints(maxPoints(clues.length + 1))} points`}
                  className="shrink-0 rounded-full border border-gold/60 bg-ocean-deep/60 px-4 py-3 text-sm font-semibold text-gold backdrop-blur transition enabled:hover:border-gold disabled:cursor-wait disabled:opacity-60"
                >
                  Hint{" "}
                  <span className="tabular font-normal text-chalk-dim">
                    −{formatPoints(maxPoints(clues.length) - maxPoints(clues.length + 1))}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={submit}
                disabled={
                  state.phase !== "guessing" || !state.pin || state.submitting || state.hinting
                }
                className="min-w-0 flex-1 rounded-full bg-flare px-4 py-3 font-semibold text-ocean-deep transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:bg-chalk/15 disabled:text-chalk-dim"
              >
                {state.phase === "guessing" && state.timedOut
                  ? "Time's up!"
                  : state.phase === "guessing" && state.submitting
                    ? "Checking…"
                    : state.phase === "guessing" && state.pin
                      ? "Guess here"
                      : "Place your pin on the globe"}
              </button>
            </div>
            {error && (
              <p role="alert" className="mt-2 text-center text-sm text-flare">
                {error}
              </p>
            )}
          </div>
        )}
      </div>

      {shown && (
        <div className="wb-reveal pointer-events-none absolute z-30">
          <RevealCard
            result={shown}
            isLast={index + 1 >= ROUNDS_PER_GAME}
            onNext={next}
            sureness={deck.sureness}
            friend={mode?.kind === "challenge" ? mode.challenge.scores[index] : undefined}
            replay={
              replayed
                ? {
                    round: roundNumber,
                    of: state.results.length,
                    onBack: closeReplay,
                    onPrevious: index > 0 ? () => openReplay(index - 1) : undefined,
                    onNext:
                      index + 1 < state.results.length ? () => openReplay(index + 1) : undefined,
                  }
                : undefined
            }
          />
        </div>
      )}
    </main>
  );
}
