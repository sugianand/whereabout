/**
 * The World Tour: beat Atlas on its home ground, continent by continent. Each leg is a continent
 * game (`lib/game/regions.ts`, five photos all taken on one continent), and a leg is cleared the
 * first time the player outscores Atlas over a whole game there. Any continent game counts, from
 * the tour page, the photo picker or the results screen, so nothing is played twice for it.
 *
 * The route visits the continents in a fixed order and the next stop is the first one not yet
 * cleared, so the tour reads as a journey while a player who clears a later leg first keeps it.
 * What is kept stays in this browser (localStorage), best effort like the player record.
 */

import { CONTINENTS, type Continent } from "@/lib/continents";

export const TOUR_KEY = "whereabout:tour";

/** The order the tour visits the continents in; only those the deck can deal a game on are on it. */
export const TOUR_ROUTE: readonly Continent[] = [
  "Europe",
  "Africa",
  "Asia",
  "Oceania",
  "South America",
  "North America",
  "Antarctica",
];

/** One continent game's points on the photos Atlas also guessed, yours and Atlas's. */
export interface LegGame {
  you: number;
  atlas: number;
}

/** What the tour keeps for one continent. */
export interface TourLeg {
  /** Finished continent games here. */
  tries: number;
  /** The game with the biggest lead over Atlas (or the smallest deficit), won or not. */
  best: LegGame;
  /** The UTC day ("2026-11-18") of the first game that beat Atlas here, or null. */
  cleared: string | null;
}

/** Legs by continent; continents never played are absent. */
export type TourRecord = Partial<Record<Continent, TourLeg>>;

/** What one finished continent game did to the tour, for the results screen. */
export interface LegResult {
  continent: Continent;
  game: LegGame;
  /** This game beat Atlas. */
  won: boolean;
  /** This game cleared the leg for the first time. */
  firstClear: boolean;
  /** The leg is cleared after this game, by this one or an earlier one. */
  held: boolean;
  /** Legs on the route cleared, after this game, and legs on the route. */
  cleared: number;
  total: number;
  /** The first leg of the route not yet cleared, or null once the tour is complete. */
  next: Continent | null;
}

/** A leg is won by strictly outscoring Atlas; a game Atlas sat out entirely is not a leg. */
export function beatAtlas(game: LegGame): boolean {
  return game.you > game.atlas;
}

const lead = (g: LegGame) => g.you - g.atlas;

/** The route over the continents the deck offers a game on, in `TOUR_ROUTE` order. */
export function tourRoute(offered: readonly Continent[]): Continent[] {
  const has = new Set(offered);
  return TOUR_ROUTE.filter((c) => has.has(c));
}

/** Legs of the route cleared. */
export function clearedCount(route: readonly Continent[], record: TourRecord): number {
  return route.filter((c) => record[c]?.cleared).length;
}

/** The first leg of the route not yet cleared, or null when every leg is. */
export function nextStop(route: readonly Continent[], record: TourRecord): Continent | null {
  return route.find((c) => !record[c]?.cleared) ?? null;
}

/**
 * The record after one finished continent game. The best game is the one with the biggest lead
 * (ties keep the earlier one), and a cleared leg keeps its first day.
 */
export function addLeg(
  record: TourRecord,
  continent: Continent,
  game: LegGame,
  day: string,
): TourRecord {
  const before = record[continent];
  const won = beatAtlas(game);
  const leg: TourLeg = before
    ? {
        tries: before.tries + 1,
        best: lead(game) > lead(before.best) ? game : before.best,
        cleared: before.cleared ?? (won ? day : null),
      }
    : { tries: 1, best: game, cleared: won ? day : null };
  return { ...record, [continent]: leg };
}

/** What a game added to the record means for the tour, from the records before and after it. */
export function legResult(
  route: readonly Continent[],
  before: TourRecord,
  after: TourRecord,
  continent: Continent,
  game: LegGame,
): LegResult {
  const won = beatAtlas(game);
  return {
    continent,
    game,
    won,
    firstClear: won && !before[continent]?.cleared,
    held: Boolean(after[continent]?.cleared),
    cleared: clearedCount(route, after),
    total: route.length,
    next: nextStop(route, after),
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const points = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

function parseLeg(raw: unknown): TourLeg | null {
  if (!raw || typeof raw !== "object") return null;
  const { tries, best, cleared } = raw as Record<string, unknown>;
  if (!points(tries) || tries < 1) return null;
  if (!best || typeof best !== "object") return null;
  const { you, atlas } = best as Record<string, unknown>;
  if (!points(you) || !points(atlas)) return null;
  if (cleared !== null && !(typeof cleared === "string" && DAY.test(cleared))) return null;
  return { tries, best: { you, atlas }, cleared };
}

/** The stored tour, keeping each well-formed leg and dropping anything else. */
export function parseTour(raw: string | null): TourRecord {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const record: TourRecord = {};
  for (const c of CONTINENTS) {
    if (!Object.hasOwn(data, c)) continue;
    const leg = parseLeg((data as Record<string, unknown>)[c]);
    if (leg) record[c] = leg;
  }
  return record;
}

export type TourStore = Pick<Storage, "getItem" | "setItem">;

function browserStore(): TourStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // Touching localStorage itself can throw when storage is blocked.
  }
}

export function loadTour(store: TourStore | null = browserStore()): TourRecord {
  if (!store) return {};
  try {
    return parseTour(store.getItem(TOUR_KEY));
  } catch {
    return {};
  }
}

/**
 * Add one finished continent game to the stored tour and say what it did. Saved best effort:
 * with storage blocked the results screen still tells this game's story.
 */
export function rememberLeg(
  route: readonly Continent[],
  continent: Continent,
  game: LegGame,
  day: string,
  store: TourStore | null = browserStore(),
): LegResult {
  const before = loadTour(store);
  const after = addLeg(before, continent, game, day);
  try {
    store?.setItem(TOUR_KEY, JSON.stringify(after));
  } catch {
    // Quota or privacy mode: this game's result still shows.
  }
  return legResult(route, before, after, continent, game);
}
