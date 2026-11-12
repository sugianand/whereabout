/**
 * Countries you mix up: every time Name the country, Close-up or Country Streak takes a wrong
 * country for a photo, the browser keeps which country was tapped for which, so Your map can list
 * the pairs a player confuses most. Like the rest of Your map it lives only in this browser, is
 * best effort (blocked or full storage never stops a game) and whatever comes back from storage
 * goes through `parseMixUps`, which drops a malformed entry on its own.
 *
 * Only what was tapped and what was right is kept, newest last and capped, so the list follows
 * the player's recent play rather than everything they ever got wrong.
 */
import { continentOf, type Continent } from "./continents";
import { countryInSentence } from "./missLesson";

export const MIX_UPS_KEY = "whereabout:mix-ups";

/** How many wrong taps are kept; the newest stay when it overflows. */
export const MAX_MIX_UPS = 300;

/** How many pairs Your map lists. */
export const TOP_PAIRS = 5;

export interface MixUp {
  /** The photo's country (ISO alpha-2). */
  truth: string;
  /** The country tapped for it instead. */
  picked: string;
}

const CODE = /^[A-Z]{2}$/;

/** The kept log with one more wrong tap, newest last. Pure: returns a new array. */
export function noteMixUp(log: readonly MixUp[], entry: MixUp, max = MAX_MIX_UPS): MixUp[] {
  const next = [...log, entry];
  return next.slice(Math.max(0, next.length - max));
}

/** One wrong tap from what storage held, or null when it isn't one. */
function parseEntry(value: unknown): MixUp | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { truth, picked } = value as Record<string, unknown>;
  if (typeof truth !== "string" || typeof picked !== "string") return null;
  if (!CODE.test(truth) || !CODE.test(picked) || truth === picked) return null;
  return { truth, picked };
}

/** What storage held, keeping the well-formed wrong taps (the newest, up to the cap). */
export function parseMixUps(value: unknown): MixUp[] {
  if (!Array.isArray(value)) return [];
  const log = value.map(parseEntry).filter((e): e is MixUp => e !== null);
  return log.slice(Math.max(0, log.length - MAX_MIX_UPS));
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The wrong taps kept in this browser, oldest first. */
export function loadMixUps(): MixUp[] {
  try {
    const raw = storage()?.getItem(MIX_UPS_KEY);
    return raw ? parseMixUps(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/**
 * Keep a wrong tap: `picked` was tapped for a photo in `truth`. A right answer, an empty pick (a
 * tap on the sea) or a code that isn't a country is not a mix-up and keeps nothing. Best effort:
 * storage that refuses it changes nothing.
 */
export function keepMixUp(
  truth: string | null | undefined,
  picked: string | null | undefined,
): void {
  const entry = parseEntry({ truth: truth?.toUpperCase(), picked: picked?.toUpperCase() });
  if (!entry) return;
  try {
    storage()?.setItem(MIX_UPS_KEY, JSON.stringify(noteMixUp(loadMixUps(), entry)));
  } catch {
    // Blocked or full storage: the game goes on without it.
  }
}

export interface MixUpPair {
  /** The pair's two countries, in a fixed order: the one more often the photo's first. */
  a: string;
  b: string;
  /** Wrong taps between them, either way round. */
  times: number;
  /** Times `b` was tapped for a photo in `a`. */
  bForA: number;
  /** Times `a` was tapped for a photo in `b`. */
  aForB: number;
  /** Where in the log the pair last came up, for ordering ties by recency. */
  latest: number;
}

/**
 * The pairs of countries mixed up, either way round, most often first, the more recent first on
 * a tie; at most `top` of them.
 */
export function mixUpPairs(log: readonly MixUp[], top = TOP_PAIRS): MixUpPair[] {
  const pairs = new Map<
    string,
    { x: string; y: string; xForY: number; yForX: number; latest: number }
  >();
  log.forEach(({ truth, picked }, i) => {
    const [x, y] = truth < picked ? [truth, picked] : [picked, truth];
    const key = `${x}-${y}`;
    const p = pairs.get(key) ?? { x, y, xForY: 0, yForX: 0, latest: i };
    if (truth === x) p.yForX += 1;
    else p.xForY += 1;
    p.latest = i;
    pairs.set(key, p);
  });
  return [...pairs.values()]
    .map((p) => {
      // The country more often the photo's leads; alphabetical on a tie, so it reads the same.
      const xLeads = p.yForX >= p.xForY;
      return {
        a: xLeads ? p.x : p.y,
        b: xLeads ? p.y : p.x,
        times: p.xForY + p.yForX,
        bForA: xLeads ? p.yForX : p.xForY,
        aForB: xLeads ? p.xForY : p.yForX,
        latest: p.latest,
      };
    })
    .sort((p, q) => q.times - p.times || q.latest - p.latest)
    .slice(0, top);
}

/** "once", "twice", "3 times". */
export function timesWord(n: number): string {
  return n === 1 ? "once" : n === 2 ? "twice" : `${n.toLocaleString("en-US")} times`;
}

/**
 * Which way round a pair went, in a sentence: "You said South Korea for Japan twice, and Japan for
 * South Korea once." Only the directions that happened are named.
 */
export function mixUpLine(pair: MixUpPair): string {
  const parts: string[] = [];
  if (pair.bForA > 0) {
    parts.push(
      `${countryInSentence(pair.b)} for ${countryInSentence(pair.a)} ${timesWord(pair.bForA)}`,
    );
  }
  if (pair.aForB > 0) {
    parts.push(
      `${countryInSentence(pair.a)} for ${countryInSentence(pair.b)} ${timesWord(pair.aForB)}`,
    );
  }
  return `You said ${parts.join(", and ")}.`;
}

/**
 * The continent to practise a pair on: that of the country whose photos you missed more often
 * (where both are, when they share one), or else the other's; only a continent Country Streak
 * can deal a run from, or null.
 */
export function practiceContinent(
  pair: MixUpPair,
  streakable: readonly Continent[],
): Continent | null {
  const ok = (c: Continent | null): c is Continent => c !== null && streakable.includes(c);
  const a = continentOf(pair.a);
  const b = continentOf(pair.b);
  if (ok(a)) return a;
  if (ok(b)) return b;
  return null;
}
