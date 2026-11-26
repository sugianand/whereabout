/**
 * What fools Atlas: over every Which fooled Atlas? pair, how often you picked the photo Atlas
 * really missed by more, beside how its own sureness rule did on the same pairs (it picks the
 * photo it was less sure of, `atlasFooledPick`), split by how far apart the two misses were.
 *
 * The gap is how many times the larger miss is the smaller one (`gapRatio`). A dead heat
 * (`tooClose`) counts any pick as right, so it says nothing about reading Atlas and is only
 * counted apart, as a dead heat. Every other pair falls in one band: close (under 3 times),
 * clear (3 to under 10 times) or far apart (10 times or more). Pairs Atlas sat out, not having
 * said how sure it was of both photos, aren't counted either, so you and its rule are always
 * compared on the same pairs.
 *
 * Each pick is counted once, as it is made (`recordFooledRead`): free runs, friends' challenges
 * and today's run alike. A reload of today's run resumes at the next pair, so nothing is counted
 * twice. Only counts are kept, never a photo or a miss. Storage is best effort, as for the bests.
 */

import { tooClose, type FooledVerdict } from "./fooledAtlas";

export const FOOLED_READ_KEY = "whereabout:fooled-atlas-read";

/** The bands of the gap between two misses, closest first, each from its `from` up to the next. */
export const GAPS = [
  { key: "close", name: "Close", from: 0, label: "one miss under 3 times the other" },
  { key: "clear", name: "Clear", from: 3, label: "3 to 10 times the other" },
  { key: "far", name: "Far apart", from: 10, label: "10 times the other or more" },
] as const;

/** One band's pairs. */
export interface GapTally {
  /** Pairs picked in this band. */
  pairs: number;
  /** Of those, how many you picked right. */
  you: number;
  /** Of those, how many Atlas's own pick got right. */
  atlas: number;
}

/** One tally per band, in `GAPS` order, and the dead heats set aside. */
export interface FooledRead {
  bands: GapTally[];
  ties: number;
}

export function emptyFooledRead(): FooledRead {
  return { bands: GAPS.map(() => ({ pairs: 0, you: 0, atlas: 0 })), ties: 0 };
}

/**
 * How many times the larger miss is the smaller one. The smaller is taken as at least 1 km, so
 * a pin right on the spot still gives a finite gap.
 */
export function gapRatio(missA: number, missB: number): number {
  const [low, high] = missA <= missB ? [missA, missB] : [missB, missA];
  return high / Math.max(low, 1);
}

/** The band (an index into `GAPS`) a pair with misses of `missA` and `missB` km falls in. */
export function gapOf(missA: number, missB: number): number {
  const ratio = gapRatio(missA, missB);
  let band = 0;
  GAPS.forEach((g, i) => {
    if (ratio >= g.from) band = i;
  });
  return band;
}

/**
 * `read` with one pair added: your verdict and Atlas's own on misses of `missA` and `missB` km.
 * A dead heat only adds to `ties`; a pair Atlas sat out (`atlas` null) adds nothing.
 */
export function addPair(
  read: FooledRead,
  verdict: FooledVerdict,
  atlas: FooledVerdict | null,
  missA: number,
  missB: number,
): FooledRead {
  if (tooClose(missA, missB)) return { ...read, ties: read.ties + 1 };
  if (atlas === null) return read;
  const band = gapOf(missA, missB);
  return {
    ...read,
    bands: read.bands.map((t, i) =>
      i !== band
        ? t
        : {
            pairs: t.pairs + 1,
            you: t.you + (verdict.correct ? 1 : 0),
            atlas: t.atlas + (atlas.correct ? 1 : 0),
          },
    ),
  };
}

const count = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/** A stored read taken back only in the shape `recordFooledRead` writes, else null. */
export function parseFooledRead(value: unknown): FooledRead | null {
  if (typeof value !== "object" || value === null) return null;
  const { bands, ties } = value as Record<string, unknown>;
  if (!count(ties) || !Array.isArray(bands) || bands.length !== GAPS.length) return null;
  const read: FooledRead = { bands: [], ties };
  for (const t of bands) {
    if (typeof t !== "object" || t === null) return null;
    const { pairs, you, atlas } = t as Record<string, unknown>;
    if (!count(pairs) || !count(you) || !count(atlas)) return null;
    if (you > pairs || atlas > pairs) return null;
    read.bands.push({ pairs, you, atlas });
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

/** Every pair kept in this browser; empty when none can be read. */
export function loadFooledRead(): FooledRead {
  try {
    const raw = storage()?.getItem(FOOLED_READ_KEY);
    if (!raw) return emptyFooledRead();
    return parseFooledRead(JSON.parse(raw)) ?? emptyFooledRead();
  } catch {
    return emptyFooledRead();
  }
}

/** Add one pair to the kept read, as `addPair` does; returns it. */
export function recordFooledRead(
  verdict: FooledVerdict,
  atlas: FooledVerdict | null,
  missA: number,
  missB: number,
): FooledRead {
  const next = addPair(loadFooledRead(), verdict, atlas, missA, missB);
  try {
    storage()?.setItem(FOOLED_READ_KEY, JSON.stringify(next));
  } catch {
    // Private mode or full storage: the pick still counted on screen.
  }
  return next;
}

/** Every band added up: pairs counted, yours right and Atlas's own picks right. */
export function fooledReadTotals(read: FooledRead): { pairs: number; you: number; atlas: number } {
  return read.bands.reduce(
    (s, t) => ({ pairs: s.pairs + t.pairs, you: s.you + t.you, atlas: s.atlas + t.atlas }),
    { pairs: 0, you: 0, atlas: 0 },
  );
}

const pct = (n: number, of: number) => `${Math.round((n / of) * 100)}%`;

/** The headline: "You picked 14 of 20 pairs right (70%); Atlas's own sureness picked 12 (60%)." */
export function fooledReadLine(read: FooledRead): string {
  const { pairs, you, atlas } = fooledReadTotals(read);
  if (pairs === 0) return "No pairs read yet.";
  const noun = pairs === 1 ? "pair" : "pairs";
  return `You picked ${you} of ${pairs} ${noun} right (${pct(you, pairs)}); Atlas's own sureness picked ${atlas} (${pct(atlas, pairs)}).`;
}

/** Who picked more right over every band, on the same pairs, or null before any pair. */
export function fooledReadLeader(read: FooledRead): "you" | "atlas" | "level" | null {
  const { pairs, you, atlas } = fooledReadTotals(read);
  if (pairs === 0) return null;
  return you === atlas ? "level" : you > atlas ? "you" : "atlas";
}

/** The dead heats set aside: "3 dead heats aren't counted: any pick is right on those." */
export function tiesLine(ties: number): string | null {
  if (ties === 0) return null;
  return ties === 1
    ? "1 dead heat isn't counted: any pick is right on those."
    : `${ties} dead heats aren't counted: any pick is right on those.`;
}
