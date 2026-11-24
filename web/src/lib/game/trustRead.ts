/**
 * Your trust: over every Trust Atlas? call, how often you trusted Atlas when its country was
 * right and doubted it when it was wrong, split by how sure Atlas said it was, beside how its own
 * fixed rule (trust from `ATLAS_TRUSTS_FROM`) did on the same photos.
 *
 * Atlas's sureness falls in one of three bands: low (under 25%), middling (25% to under 50%) and
 * high (50% and over). The high band starts where Atlas's rule starts trusting, so its rule
 * doubts every low and middling answer and trusts every high one; its correct calls in a band are
 * therefore never stored, only worked out from how often Atlas was right there, so a kept read
 * can't claim a rule better than its own photos.
 *
 * Each call is counted once, as it is made (`recordTrustRead`), with the sureness from the photo's
 * record: free games, friends' challenges and today's game alike. Today's kept days hold only the
 * calls, not the sureness, so they are never read back here and nothing is counted twice.
 *
 * Only counts are kept, never a photo or a country. Storage is best effort, as for the bests.
 */

import { ATLAS_TRUSTS_FROM, type TrustResult } from "./trustAtlas";

export const TRUST_READ_KEY = "whereabout:trust-atlas-read";

/** The bands of Atlas's sureness, least sure first, each from its `from` up to the next. */
export const SURENESS = [
  { key: "low", name: "Low", from: 0, label: "under 25% sure" },
  { key: "middling", name: "Middling", from: 0.25, label: "25% to 50% sure" },
  { key: "high", name: "High", from: ATLAS_TRUSTS_FROM, label: "50% sure or more" },
] as const;

/** One band's calls. */
export interface BandTally {
  /** Photos called. */
  photos: number;
  /** Of those, how many Atlas named the right country for. */
  right: number;
  /** Of the right ones, how many you trusted. */
  trusted: number;
  /** Of the wrong ones, how many you doubted. */
  doubted: number;
}

/** One tally per band, in `SURENESS` order. */
export type TrustRead = BandTally[];

export function emptyTrustRead(): TrustRead {
  return SURENESS.map(() => ({ photos: 0, right: 0, trusted: 0, doubted: 0 }));
}

/** The band (an index into `SURENESS`) an answer Atlas gave probability `p` falls in. */
export function bandOf(p: number): number {
  let band = 0;
  SURENESS.forEach((b, i) => {
    if (p >= b.from) band = i;
  });
  return band;
}

/** True for the band from which Atlas's own rule trusts its answer. */
const ruleTrusts = (band: number) => SURENESS[band]!.from >= ATLAS_TRUSTS_FROM;

/** Your correct calls in a band: trusted when right, doubted when wrong. */
export function youCorrect(t: BandTally): number {
  return t.trusted + t.doubted;
}

/** Atlas's rule's correct calls in `band`: every right answer there, or every wrong one. */
export function ruleCorrect(t: BandTally, band: number): number {
  return ruleTrusts(band) ? t.right : t.photos - t.right;
}

/** `read` with one call added, made on an answer Atlas gave probability `p`. */
export function addCall(read: TrustRead, result: TrustResult, p: number): TrustRead {
  const band = bandOf(p);
  return read.map((t, i) =>
    i !== band
      ? t
      : {
          photos: t.photos + 1,
          right: t.right + (result.atlasRight ? 1 : 0),
          trusted: t.trusted + (result.atlasRight && result.call === "trust" ? 1 : 0),
          doubted: t.doubted + (!result.atlasRight && result.call === "doubt" ? 1 : 0),
        },
  );
}

const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** A stored read taken back only in the shape `recordTrustRead` writes, else null. */
export function parseTrustRead(value: unknown): TrustRead | null {
  if (!Array.isArray(value) || value.length !== SURENESS.length) return null;
  const read: TrustRead = [];
  for (const t of value) {
    if (typeof t !== "object" || t === null) return null;
    const { photos, right, trusted, doubted } = t as Record<string, unknown>;
    if (!count(photos) || !count(right) || !count(trusted) || !count(doubted)) return null;
    if (right > photos || trusted > right || doubted > photos - right) return null;
    read.push({ photos, right, trusted, doubted });
  }
  return read;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Every call kept in this browser; empty when none can be read. */
export function loadTrustRead(): TrustRead {
  try {
    const raw = storage()?.getItem(TRUST_READ_KEY);
    if (!raw) return emptyTrustRead();
    return parseTrustRead(JSON.parse(raw)) ?? emptyTrustRead();
  } catch {
    return emptyTrustRead();
  }
}

/** Add one call, on an answer Atlas gave probability `p`, to the kept read; returns it. */
export function recordTrustRead(result: TrustResult, p: number): TrustRead {
  const next = addCall(loadTrustRead(), result, p);
  try {
    storage()?.setItem(TRUST_READ_KEY, JSON.stringify(next));
  } catch {
    // Private mode or full storage: the call still counted on screen.
  }
  return next;
}

/** Every band added up: photos called, yours right and Atlas's rule's right. */
export function trustReadTotals(read: TrustRead): { photos: number; you: number; rule: number } {
  return read.reduce(
    (s, t, i) => ({
      photos: s.photos + t.photos,
      you: s.you + youCorrect(t),
      rule: s.rule + ruleCorrect(t, i),
    }),
    { photos: 0, you: 0, rule: 0 },
  );
}

const pct = (n: number, of: number) => `${Math.round((n / of) * 100)}%`;

/** The headline: "You called 14 of 20 photos right (70%); Atlas's own rule called 12 (60%)." */
export function trustReadLine(read: TrustRead): string {
  const { photos, you, rule } = trustReadTotals(read);
  if (photos === 0) return "No calls yet.";
  const noun = photos === 1 ? "photo" : "photos";
  return `You called ${you} of ${photos} ${noun} right (${pct(you, photos)}); Atlas's own rule called ${rule} (${pct(rule, photos)}).`;
}

/** Who called more right over every band, on the same photos, or null before any call. */
export function trustReadLeader(read: TrustRead): "you" | "atlas" | "level" | null {
  const { photos, you, rule } = trustReadTotals(read);
  if (photos === 0) return null;
  return you === rule ? "level" : you > rule ? "you" : "atlas";
}

/** A band's detail: "Trusted 3 of 4 right answers · doubted 5 of 6 wrong ones." */
export function bandDetail(t: BandTally): string {
  if (t.photos === 0) return "Not called yet.";
  const wrong = t.photos - t.right;
  const parts: string[] = [];
  if (t.right > 0) {
    parts.push(`trusted ${t.trusted} of ${t.right} right ${t.right === 1 ? "answer" : "answers"}`);
  }
  if (wrong > 0) {
    parts.push(`doubted ${t.doubted} of ${wrong} wrong ${wrong === 1 ? "one" : "ones"}`);
  }
  const text = parts.join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1) + ".";
}
