/**
 * Odd one out: four photos, three taken on one continent and one on another. The player taps
 * the odd one. A right tap deals four more; the first wrong tap ends the run.
 *
 * Which continent a photo belongs to comes from its catalog country (`continentOf`, the same
 * table continent games use), and a quad is dealt from `deck.regions`, so it only ever draws on
 * continents with enough photos for a game. Photos already dealt this run are kept back while
 * each continent still has fresh ones, so a run does not show the same photo twice early on.
 *
 * Atlas plays along from its own guesses only: it reads each photo's continent from the top
 * country it named. When exactly one of the four reads differently from the other three, that is
 * its pick; otherwise (all four agree, or they split two and two) it picks the photo whose pin
 * lies furthest from its other three pins. A photo Atlas never guessed sits Atlas out of that
 * quad. Atlas is always judged against the true answer.
 *
 * The rules live here as a pure reducer so they can be tested without photos. The best run is
 * kept in this browser only, best effort.
 */

import { continentOf, type Continent } from "@/lib/continents";
import { haversineKm } from "@/lib/geo";

import type { Regions } from "./regions";
import type { AtlasGuess } from "./types";

export const BEST_ODD_KEY = "whereabout:odd-one-out-best";
/** Photos dealt in one quad. */
export const QUAD = 4;

/** Four photos: three from `common`, one (at `odd`) from `oddContinent`. */
export interface Quad {
  ids: readonly string[];
  /** Index into `ids` of the photo from the other continent. */
  odd: number;
  common: Continent;
  oddContinent: Continent;
}

/** The continents a quad can be dealt from: at least three photos, then any other with one. */
export function canDeal(regions: Regions): boolean {
  const sizes = Object.values(regions).map((ids) => ids?.length ?? 0);
  return sizes.some((n) => n >= QUAD - 1) && sizes.filter((n) => n > 0).length >= 2;
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

/** `count` distinct items from `pool`, preferring ones not in `seen` while enough are left. */
function draw(
  pool: readonly string[],
  count: number,
  seen: ReadonlySet<string>,
  random: () => number,
): string[] {
  const fresh = pool.filter((id) => !seen.has(id));
  const from = [...(fresh.length >= count ? fresh : pool)];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const j = Math.min(from.length - 1, Math.floor(random() * from.length));
    out.push(from[j]);
    from.splice(j, 1);
  }
  return out;
}

/**
 * Deal one quad, or null when the deck can't (`canDeal`). The common continent is any with at
 * least three photos, the odd continent any other; the odd photo's place among the four is
 * random too.
 */
export function dealQuad(
  regions: Regions,
  random: () => number = Math.random,
  seen: ReadonlySet<string> = new Set(),
): Quad | null {
  if (!canDeal(regions)) return null;
  const continents = Object.keys(regions) as Continent[];
  const common = pick(
    continents.filter((c) => (regions[c]?.length ?? 0) >= QUAD - 1),
    random,
  );
  const oddContinent = pick(
    continents.filter((c) => c !== common && (regions[c]?.length ?? 0) > 0),
    random,
  );
  const three = draw(regions[common]!, QUAD - 1, seen, random);
  const [one] = draw(regions[oddContinent]!, 1, seen, random);
  const odd = Math.min(QUAD - 1, Math.floor(random() * QUAD));
  const ids = [...three];
  ids.splice(odd, 0, one);
  return { ids, odd, common, oddContinent };
}

/** Atlas's read of one quad. */
export interface AtlasOdd {
  /** The index Atlas picked. */
  picked: number;
  /** The continent Atlas read for each photo (from its top country), null where it can't say. */
  continents: readonly (Continent | null)[];
  /** True when one photo read differently from the other three; false when it fell back on pins. */
  byContinent: boolean;
  correct: boolean;
}

/**
 * Atlas's pick for a quad from its guesses, in the quad's order, or null when any photo has no
 * guess. See the module comment for the rule.
 */
export function atlasOdd(guesses: readonly (AtlasGuess | null)[], odd: number): AtlasOdd | null {
  if (guesses.length !== QUAD || guesses.some((g) => g === null)) return null;
  const all = guesses as readonly AtlasGuess[];
  const continents = all.map((g) => continentOf(g.topCountries[0]?.country));
  let picked = -1;
  for (let i = 0; i < QUAD; i++) {
    const c = continents[i];
    const others = continents.filter((_, j) => j !== i);
    if (others[0] !== null && others.every((o) => o === others[0]) && c !== others[0]) {
      picked = i;
      break;
    }
  }
  const byContinent = picked >= 0;
  if (!byContinent) {
    // No clean three-and-one read: the pin furthest from the other three, first on a tie.
    let far = -1;
    all.forEach((g, i) => {
      const sum = all.reduce((s, h, j) => (j === i ? s : s + haversineKm(g, h)), 0);
      if (sum > far) {
        far = sum;
        picked = i;
      }
    });
  }
  return { picked, continents, byContinent, correct: picked === odd };
}

interface Run {
  quad: Quad;
  /** The quad dealt after this one, so its photos load while the player reads the answer. */
  upcoming: Quad | null;
  /** Right taps in a row this run. */
  streak: number;
  /** Quads Atlas got right, and quads it played (all four photos guessed). */
  atlasRight: number;
  atlasPlayed: number;
}

export type OddState =
  | { phase: "idle" }
  /** The deck can't deal a quad (fewer than two continents with photos). */
  | { phase: "none" }
  | (Run & { phase: "picking" })
  | (Run & {
      phase: "answered";
      picked: number;
      correct: boolean;
      atlas: AtlasOdd | null;
    });

export type OddAction =
  | { type: "start"; quad: Quad | null; upcoming: Quad | null }
  | { type: "picked"; index: number; atlas: (AtlasGuess | null)[] }
  /** Move on to the upcoming quad, dealing `upcoming` as the one after it. */
  | { type: "next"; upcoming: Quad | null };

export const initialOdd: OddState = { phase: "idle" };

export function oddReducer(state: OddState, action: OddAction): OddState {
  switch (action.type) {
    case "start":
      return action.quad
        ? {
            phase: "picking",
            quad: action.quad,
            upcoming: action.upcoming,
            streak: 0,
            atlasRight: 0,
            atlasPlayed: 0,
          }
        : { phase: "none" };
    case "picked": {
      if (state.phase !== "picking") return state;
      if (!Number.isInteger(action.index) || action.index < 0 || action.index >= QUAD) {
        return state;
      }
      const correct = action.index === state.quad.odd;
      const atlas = atlasOdd(action.atlas, state.quad.odd);
      return {
        ...state,
        phase: "answered",
        picked: action.index,
        correct,
        atlas,
        streak: state.streak + (correct ? 1 : 0),
        atlasRight: state.atlasRight + (atlas?.correct ? 1 : 0),
        atlasPlayed: state.atlasPlayed + (atlas ? 1 : 0),
      };
    }
    case "next": {
      // A wrong tap ends the run; only a new "start" plays on.
      if (state.phase !== "answered" || !state.correct || !state.upcoming) return state;
      const { streak, atlasRight, atlasPlayed } = state;
      return {
        phase: "picking",
        quad: state.upcoming,
        upcoming: action.upcoming,
        streak,
        atlasRight,
        atlasPlayed,
      };
    }
  }
}

/** True once a wrong tap has ended the run. */
export function oddOver(state: OddState): boolean {
  return state.phase === "answered" && !state.correct;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The best run this browser has kept, or 0 when none is stored or it can't be read. */
export function loadBestOdd(): number {
  try {
    const raw = storage()?.getItem(BEST_ODD_KEY);
    if (!raw) return 0;
    const value: unknown = JSON.parse(raw);
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/** Keep `streak` if it beats the stored best, and return the best after that. */
export function rememberOdd(streak: number): number {
  const best = loadBestOdd();
  if (streak <= best) return best;
  try {
    storage()?.setItem(BEST_ODD_KEY, JSON.stringify(streak));
  } catch {
    // Private mode or full storage: the run still counts for this visit.
  }
  return streak;
}
