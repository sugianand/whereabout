/**
 * The Daily Five: everyone gets the same five photos on the same UTC day, chosen by a seeded
 * shuffle of the catalog. No server needed, and results are comparable between friends.
 */

/** mulberry32: a tiny, well-distributed 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string to a 32-bit seed. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** "2026-10-09" for the UTC calendar day of `date`. */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function pickDaily<T>(catalog: readonly T[], day: string, count = 5): T[] {
  return seededShuffle(catalog, hashSeed(`whereabout:${day}`)).slice(0, count);
}

export function pickRandom<T>(catalog: readonly T[], count = 5, random = Math.random): T[] {
  return seededShuffle(catalog, Math.floor(random() * 2 ** 32)).slice(0, count);
}
