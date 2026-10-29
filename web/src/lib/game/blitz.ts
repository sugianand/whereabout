/**
 * Blitz: a five-photo game against the clock.
 *
 * Each photo gets `BLITZ_SECONDS`. When the clock runs out the guess is locked in wherever the
 * pin is; with no pin on the globe the round scores 0. The clock only runs while the player can
 * see the photo: hiding the tab (switching apps on a phone, another browser tab) pauses it, so a
 * phone call never costs a round.
 *
 * The clock is a plain value with pure functions over it, so every rule is tested without a
 * browser or fake timers: the caller passes the current time in.
 */

export const BLITZ_SECONDS = 30;
export const BLITZ_MS = BLITZ_SECONDS * 1000;

/** Under this many seconds left the ring turns to a warning colour. */
export const BLITZ_WARN_SECONDS = 10;

export interface BlitzClock {
  /** The whole allowance for the round. */
  limitMs: number;
  /** Time already spent while the clock was running, not counting the current run. */
  spentMs: number;
  /** When the current run started (ms, same clock as `now`), or null while paused. */
  runningSince: number | null;
}

/** A fresh clock for a round, running from `now`. */
export function startClock(now: number, limitMs: number = BLITZ_MS): BlitzClock {
  return { limitMs, spentMs: 0, runningSince: now };
}

function spent(clock: BlitzClock, now: number): number {
  const running = clock.runningSince === null ? 0 : Math.max(0, now - clock.runningSince);
  return clock.spentMs + running;
}

/** Stop the clock, keeping the time spent so far. Pausing a paused clock changes nothing. */
export function pauseClock(clock: BlitzClock, now: number): BlitzClock {
  if (clock.runningSince === null) return clock;
  return { ...clock, spentMs: spent(clock, now), runningSince: null };
}

/** Start a paused clock again from `now`. Resuming a running clock changes nothing. */
export function resumeClock(clock: BlitzClock, now: number): BlitzClock {
  if (clock.runningSince !== null) return clock;
  return { ...clock, runningSince: now };
}

/** Milliseconds left, never below 0. */
export function remainingMs(clock: BlitzClock, now: number): number {
  return Math.max(0, clock.limitMs - spent(clock, now));
}

/** True once the round's time is used up. */
export function timeUp(clock: BlitzClock, now: number): boolean {
  return remainingMs(clock, now) <= 0;
}

/** Whole seconds to show: 29.2 s left reads 30, so "0" only shows when time is really up. */
export function secondsShown(clock: BlitzClock, now: number): number {
  return Math.ceil(remainingMs(clock, now) / 1000);
}

/** Share of the round left, 1 at the start down to 0, for the countdown ring. */
export function fractionLeft(clock: BlitzClock, now: number): number {
  return clock.limitMs > 0 ? remainingMs(clock, now) / clock.limitMs : 0;
}

export const BLITZ_BEST_KEY = "whereabout:blitz-best";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // Touching localStorage itself can throw when storage is blocked.
  }
}

/** The best Blitz game this browser has seen, or null before the first one. */
export function loadBlitzBest(store: Pick<Storage, "getItem"> | null = storage()): number | null {
  try {
    const raw = store?.getItem(BLITZ_BEST_KEY);
    if (raw === null || raw === undefined) return null;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

export interface BlitzBest {
  /** The best Blitz score after this game. */
  best: number;
  /** The best before this game, or null if this was the first. */
  previous: number | null;
  /** This game set a new best (the first game always does). */
  isNew: boolean;
}

/**
 * Keep `score` if it beats the stored best, and say how it compares. Best effort: in private
 * mode or with full storage the result is still right for this game, it just isn't kept.
 */
export function rememberBlitz(
  score: number,
  store: Pick<Storage, "getItem" | "setItem"> | null = storage(),
): BlitzBest {
  const previous = loadBlitzBest(store);
  const isNew = previous === null || score > previous;
  if (isNew) {
    try {
      store?.setItem(BLITZ_BEST_KEY, String(score));
    } catch {
      // The best still shows for this visit.
    }
  }
  return { best: isNew ? score : previous, previous, isNew };
}
