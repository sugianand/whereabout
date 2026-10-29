/**
 * Feel: a short buzz on phones and a soft chime when a guess is revealed, both scaled to how
 * close the pin landed.
 *
 * The rules are pure (which closeness a distance earns, which buzz and chime that closeness
 * gets, whether anything plays at all), so they are tested without a browser. The browser side
 * is a thin layer: `navigator.vibrate` where it exists (Android browsers; iPhones have none, so
 * they get only the chime) and a few sine notes from the Web Audio API, synthesised on the spot,
 * so there are no sound files to download, cache or license.
 *
 * One toggle mutes both, remembered in this browser under `FEEL_KEY`. Under
 * `prefers-reduced-motion: reduce` nothing plays at all and the toggle is not offered.
 */

import { BULLSEYE_KM } from "./badges";

export const FEEL_KEY = "whereabout:feel";

/** How close a revealed pin landed, from best to worst. No pin counts as far. */
export type Closeness = "bullseye" | "close" | "near" | "far";

/**
 * The upper bound of each closeness, in km. 25 km matches the Bullseye badge, so a pin that earns
 * the badge also gets the best buzz.
 */
export const CLOSENESS_KM: Readonly<Record<Exclude<Closeness, "far">, number>> = {
  bullseye: BULLSEYE_KM,
  close: 500,
  near: 2_000,
};

export function closenessOf(distanceKm: number | null): Closeness {
  if (distanceKm === null || !Number.isFinite(distanceKm)) return "far";
  if (distanceKm <= CLOSENESS_KM.bullseye) return "bullseye";
  if (distanceKm <= CLOSENESS_KM.close) return "close";
  if (distanceKm <= CLOSENESS_KM.near) return "near";
  return "far";
}

/**
 * Vibration patterns (`navigator.vibrate`: on, off, on, ... in ms). Closer pins buzz more; a far
 * pin gets one faint tick, so the phone still says "revealed" without celebrating.
 */
export const BUZZ: Readonly<Record<Closeness, readonly number[]>> = {
  bullseye: [35, 50, 35, 50, 110],
  close: [35, 60, 70],
  near: [45],
  far: [15],
};

export interface Chime {
  /** Note frequencies in Hz, played one after another. */
  notes: readonly number[];
  /** Seconds between the starts of consecutive notes. */
  gap: number;
  /** Peak gain of each note, 0..1. Kept low: this is a soft sound, not an alert. */
  volume: number;
}

// A C-major arpeggio climbs higher the closer the pin; a far pin gets one low, quiet note.
const E4 = 329.63;
const G4 = 392.0;
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;
const A3 = 220.0;

export const CHIME: Readonly<Record<Closeness, Chime>> = {
  bullseye: { notes: [C5, E5, G5, C6], gap: 0.09, volume: 0.16 },
  close: { notes: [C5, E5, G5], gap: 0.1, volume: 0.14 },
  near: { notes: [E4, G4], gap: 0.12, volume: 0.12 },
  far: { notes: [A3], gap: 0, volume: 0.09 },
};

/** Minimal storage surface, so tests can pass a fake (including one that throws). */
export type FeelStore = Pick<Storage, "getItem" | "setItem">;

function browserStore(): FeelStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // Touching localStorage itself can throw when storage is blocked.
  }
}

/** True when the player muted sound and vibration in this browser. Unknown means not muted. */
export function isMuted(store: FeelStore | null = browserStore()): boolean {
  if (!store) return false;
  try {
    return store.getItem(FEEL_KEY) === "off";
  } catch {
    return false;
  }
}

/** Remember the toggle. Best effort: blocked storage only means it resets next visit. */
export function setMuted(muted: boolean, store: FeelStore | null = browserStore()): void {
  if (!store) return;
  try {
    store.setItem(FEEL_KEY, muted ? "off" : "on");
  } catch {
    // Quota or privacy mode: the toggle still applies for this visit.
  }
}

/** True when the player asked their system for less motion; then nothing plays at all. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

/** What a reveal does, injected so the rules can be tested without a phone or speakers. */
export interface FeelOutputs {
  muted: boolean;
  reducedMotion: boolean;
  vibrate?: (pattern: number[]) => void;
  chime?: (chime: Chime) => void;
}

/**
 * Buzz and chime for a revealed guess. Returns the closeness that played, or null when nothing
 * did (muted, reduced motion).
 */
export function feelReveal(distanceKm: number | null, out: FeelOutputs): Closeness | null {
  if (out.muted || out.reducedMotion) return null;
  const closeness = closenessOf(distanceKm);
  // No pin: the chime still marks the reveal, but the phone stays still.
  if (distanceKm !== null) out.vibrate?.([...BUZZ[closeness]]);
  out.chime?.(CHIME[closeness]);
  return closeness;
}

// ---- Browser outputs -------------------------------------------------------------------------

let audio: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (audio) return audio;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    audio = Ctor ? new Ctor() : null;
  } catch {
    audio = null;
  }
  return audio;
}

/**
 * Browsers only let a page start sound after a tap or key press. Called from the player's own
 * input (placing a pin, "Guess here"), it wakes the audio so a reveal moments later, or a Blitz
 * clock running out, can play.
 */
export function primeAudio(): void {
  if (prefersReducedMotion() || isMuted()) return;
  const ctx = audioContext();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
}

/** Plays a chime: each note a sine with a quick attack and a soft decay. */
export function playChime(chime: Chime): void {
  const ctx = audioContext();
  if (!ctx || ctx.state !== "running") return;
  const start = ctx.currentTime + 0.02;
  chime.notes.forEach((freq, i) => {
    const at = start + i * chime.gap;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(chime.volume, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.5);
  });
}

function vibrate(pattern: number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Some browsers throw outside a user gesture; a missed buzz is fine.
  }
}

/** The reveal's buzz and chime in this browser, honouring the toggle and reduced motion. */
export function feelRevealInBrowser(distanceKm: number | null): Closeness | null {
  return feelReveal(distanceKm, {
    muted: isMuted(),
    reducedMotion: prefersReducedMotion(),
    vibrate,
    chime: playChime,
  });
}
