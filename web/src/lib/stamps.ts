/**
 * Stamps: a page of things to collect, each earned from what this browser already keeps.
 *
 * - The five badges of the player's record (`lib/badges.ts`), with how far along the next one is
 *   where the record can say (rounds won, a Daily Five run, continents played, the closest pin).
 * - A continent cleared: a round played on a photo from every country the catalog has there,
 *   read from your map's history (`lib/playedMap.ts`), so the six inhabited continents each have
 *   one. The countries counted are the ones the game deals, so a stamp is always within reach.
 * - A full day and a full week of Today (`lib/game/today.ts`): every daily game finished in one
 *   day, and on seven days in a row, read from the days each game keeps.
 * - Beat Atlas: one per daily game Atlas can be called on, earned on a day you outscored it there,
 *   by the same rule as Atlas's day on Today (`DayTally.versus`). Until then, the note gives the
 *   closest you came on the days kept.
 * - Reading the clues: a road reader for a Left or right? run of `ROAD_READER_RUN`, a climate
 *   reader for every photo right in a whole Which climate? game (free or today's; a practice game
 *   of your mix-ups is dealt from fewer climates and doesn't count), and one per clue for reading
 *   it better than Atlas over at least `CLUE_PHOTOS` photos, by Your map's clue reading
 *   (`lib/game/quickRecord.ts`), with Atlas's rate over the photos it read.
 *
 * The days every game keeps are the last `ARCHIVE_DAYS`, and the map's history is capped, so a
 * stamp could otherwise fade once its proof is gone. Each stamp is therefore written down under
 * `STAMPS_KEY` with the day it was first seen earned, and stays from then on, like a badge.
 * What comes back from storage is checked: unknown ids and malformed days are dropped.
 */

import { BADGES, GLOBETROTTER_CONTINENTS, STREAK_DAYS, type BadgeId } from "@/lib/badges";
import { CONTINENT_OF, type Continent } from "@/lib/continents";
import { countryName } from "@/lib/countries";
import { isDayKey } from "@/lib/game/dailyArchive";
import { regionSlug } from "@/lib/game/regions";
import { formatDistance, formatPoints } from "@/lib/geo";
import { loadClimateDays } from "@/lib/game/climateDaily";
import { loadBestLeftRight } from "@/lib/game/leftRight";
import {
  loadQuickRecord,
  percent,
  standing,
  standingLine,
  type Tally,
} from "@/lib/game/quickRecord";
import { loadSideDays } from "@/lib/game/sideDaily";
import { VERSUS_GAMES, type DayTally, type TodayGameId, type Versus } from "@/lib/game/today";
import { CLIMATE_PHOTOS, loadBestClimate } from "@/lib/game/whichClimate";
import { currentStreak, type PlayerRecord } from "@/lib/playerRecord";
import type { PlayedPhoto } from "@/lib/playedMap";
import type { Units } from "@/lib/units";

export const STAMPS_KEY = "whereabout:stamps";

/** Full days in a row for "Full week". */
export const FULL_WEEK = 7;

/** A cleared continent's progress names the countries left once this few remain. */
export const NAME_LEFT = 3;

export type ContinentStampId = `cleared-${string}`;
export type AtlasStampId = `beat-atlas-${TodayGameId}`;
/** A Left or right? run this long earns the road reader. */
export const ROAD_READER_RUN = 10;

/** Photos of a clue read beside Atlas before a lead over it earns that clue's stamp. */
export const CLUE_PHOTOS = 30;

export const CLUE_STAMP_IDS = [
  "road-reader",
  "climate-reader",
  "road-ahead",
  "climate-ahead",
] as const;
export type ClueStampId = (typeof CLUE_STAMP_IDS)[number];

export type StampId =
  BadgeId | ContinentStampId | "full-day" | "full-week" | AtlasStampId | ClueStampId;

export type StampGroup = "badges" | "continents" | "days" | "atlas" | "clues";

export const STAMP_GROUPS: readonly { id: StampGroup; title: string }[] = [
  { id: "badges", title: "Badges" },
  { id: "continents", title: "Continents cleared" },
  { id: "days", title: "Full days" },
  { id: "atlas", title: "Beat Atlas" },
  { id: "clues", title: "Reading the clues" },
];

/** How far along an unearned stamp is: `have` of `need`, counted in `unit`. */
export interface StampProgress {
  have: number;
  need: number;
  /** Singular and plural, e.g. ["country", "countries"]. */
  unit: readonly [string, string];
}

export interface Stamp {
  id: StampId;
  group: StampGroup;
  name: string;
  /** How it is earned, shown whether or not it has been. */
  how: string;
  /** A picture for the stamp's face. */
  icon: string;
  earned: boolean;
  /** Absent when the stamp is all or nothing (a Hard game won, say). */
  progress: StampProgress | null;
  /** A line of detail: the countries still to play, the closest pin so far. */
  note: string | null;
}

/** Everything stamps are read from; each part is loaded and validated by its own module. */
export interface StampSources {
  record: PlayerRecord;
  played: readonly PlayedPhoto[];
  /** Today's tallies of the days kept, newest first (`dayTallies`). */
  tallies: readonly DayTally[];
  /** The countries the game deals photos from, by continent. */
  countries: Partial<Record<Continent, readonly string[]>>;
  now: Date;
  /** For the closest pin; kilometres if not given. */
  units?: Units;
  /** What the clue games keep (`loadClueSources`); none played if not given. */
  clues?: ClueSources;
}

/** What the clue games keep, for the clue stamps. */
export interface ClueSources {
  /** The longest Left or right? run: the free runs' best or a day's run. */
  bestRun: number;
  /** Most photos right in one whole Which climate? game, free or today's. */
  bestClimate: number;
  /** Your clue reading against Atlas's, free and daily together (`loadQuickRecord`). */
  road: Tally;
  climate: Tally;
}

export const NO_CLUES: ClueSources = {
  bestRun: 0,
  bestClimate: 0,
  road: { runs: 0, rounds: 0, right: 0, atlasPlayed: 0, atlasRight: 0 },
  climate: { runs: 0, rounds: 0, right: 0, atlasPlayed: 0, atlasRight: 0 },
};

const BADGE_ICONS: Record<BadgeId, string> = {
  "first-win": "🏅",
  bullseye: "🎯",
  "daily-five": "📅",
  globetrotter: "🌐",
  "hard-won": "⛰️",
};

const CONTINENT_ICONS: Partial<Record<Continent, string>> = {
  Africa: "🌍",
  Europe: "🌍",
  Asia: "🌏",
  Oceania: "🌏",
  "North America": "🌎",
  "South America": "🌎",
};

export function continentStampId(c: Continent): ContinentStampId {
  return `cleared-${regionSlug(c)}`;
}

export function atlasStampId(game: TodayGameId): AtlasStampId {
  return `beat-atlas-${game}`;
}

/** Every stamp id there can be, in the order the page lists them. */
export const STAMP_IDS: readonly StampId[] = [
  ...BADGES.map((b) => b.id),
  ...GLOBETROTTER_CONTINENTS.map(continentStampId),
  "full-day",
  "full-week",
  ...VERSUS_GAMES.map((g) => atlasStampId(g.id)),
  ...CLUE_STAMP_IDS,
];

const KNOWN: ReadonlySet<string> = new Set(STAMP_IDS);

export const isStampId = (v: unknown): v is StampId => typeof v === "string" && KNOWN.has(v);

const count = (n: number, [one, many]: readonly [string, string]) => `${n} ${n === 1 ? one : many}`;

/** "3 countries to go", for the next stamp up. */
export function toGo(p: StampProgress): string {
  return `${count(Math.max(0, p.need - p.have), p.unit)} to go`;
}

/** The longest run of full days among the tallies (consecutive days, newest first). */
export function longestFullRun(tallies: readonly DayTally[]): number {
  let best = 0;
  let run = 0;
  for (const t of tallies) {
    run = t.of > 0 && t.done >= t.of ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** The current run of full days: from today if it is full, else from yesterday. */
function currentFullRun(tallies: readonly DayTally[]): number {
  const full = (t: DayTally) => t.of > 0 && t.done >= t.of;
  let days = 0;
  for (
    let i = tallies[0] && full(tallies[0]) ? 0 : 1;
    i < tallies.length && full(tallies[i]);
    i++
  ) {
    days++;
  }
  return days;
}

function closestKm(played: readonly PlayedPhoto[]): number | null {
  const km = played.map((p) => p.km).filter((k): k is number => k !== null);
  return km.length ? Math.min(...km) : null;
}

function badgeStamps({ record, played, now, units = "km" }: StampSources): Stamp[] {
  const has = new Set(record.badges);
  const continentsPlayed = GLOBETROTTER_CONTINENTS.filter(
    (c) => (record.continents[c]?.rounds ?? 0) > 0,
  ).length;
  const streak = currentStreak(record, now);
  const closest = closestKm(played);
  return BADGES.map((b): Stamp => {
    const earned = has.has(b.id);
    let progress: StampProgress | null = null;
    let note: string | null = null;
    switch (b.id) {
      case "first-win":
        progress = {
          have: Math.min(record.roundsWon, 1),
          need: 1,
          unit: ["round won", "rounds won"],
        };
        break;
      case "daily-five":
        progress = {
          have: Math.min(streak, STREAK_DAYS),
          need: STREAK_DAYS,
          unit: ["day", "days"],
        };
        if (!earned && record.bestStreak > streak)
          note = `Best run so far: ${count(record.bestStreak, ["day", "days"])}`;
        break;
      case "globetrotter":
        progress = {
          have: continentsPlayed,
          need: GLOBETROTTER_CONTINENTS.length,
          unit: ["continent", "continents"],
        };
        break;
      case "bullseye":
        if (!earned && closest !== null)
          note = `Closest pin so far: ${formatDistance(closest, units)}`;
        break;
      case "hard-won":
        break;
    }
    return {
      id: b.id,
      group: "badges",
      name: b.name,
      how: b.how,
      icon: BADGE_ICONS[b.id],
      earned,
      progress,
      note,
    };
  });
}

function continentStamps({ played, countries }: StampSources): Stamp[] {
  const seen = new Set(played.map((p) => p.country).filter((c): c is string => c !== null));
  return GLOBETROTTER_CONTINENTS.flatMap((c): Stamp[] => {
    const all = countries[c] ?? [];
    if (all.length === 0) return [];
    const left = all.filter((code) => !seen.has(code));
    const earned = left.length === 0;
    const names = left.map(countryName).sort((a, b) => a.localeCompare(b));
    return [
      {
        id: continentStampId(c),
        group: "continents",
        name: `${c} cleared`,
        how: `Pin a photo from each of the ${all.length} countries the game has in ${c}`,
        icon: CONTINENT_ICONS[c] ?? "🌐",
        earned,
        progress: {
          have: all.length - left.length,
          need: all.length,
          unit: ["country", "countries"],
        },
        note: !earned && left.length <= NAME_LEFT ? `Still to play: ${names.join(", ")}` : null,
      },
    ];
  });
}

function dayStamps({ tallies }: StampSources): Stamp[] {
  const today = tallies[0];
  const fullDay = tallies.some((t) => t.of > 0 && t.done >= t.of);
  const week = longestFullRun(tallies) >= FULL_WEEK;
  return [
    {
      id: "full-day",
      group: "days",
      name: "Full day",
      how: "Finish every daily game on Today in one day",
      icon: "☀️",
      earned: fullDay,
      progress: today ? { have: today.done, need: today.of, unit: ["game", "games"] } : null,
      note: null,
    },
    {
      id: "full-week",
      group: "days",
      name: "Full week",
      how: `Finish every daily game ${FULL_WEEK} days in a row`,
      icon: "🗓️",
      earned: week,
      progress: {
        have: Math.min(currentFullRun(tallies), FULL_WEEK),
        need: FULL_WEEK,
        unit: ["day", "days"],
      },
      note: null,
    },
  ];
}

/** A tally in its unit: "4,200 points", "14 in place", "3 right". */
export function versusTally(n: number, unit: string): string {
  return `${unit === "points" ? formatPoints(n) : n} ${unit}`;
}

/** "Closest so far: 3 right to Atlas's 4" or "Level with Atlas so far: 3 right each". */
export function closestWords(v: Pick<Versus, "you" | "atlas" | "unit">): string {
  if (v.you === v.atlas) return `Level with Atlas so far: ${versusTally(v.you, v.unit)} each`;
  const atlas = v.unit === "points" ? formatPoints(v.atlas) : String(v.atlas);
  return `Closest so far: ${versusTally(v.you, v.unit)} to Atlas's ${atlas}`;
}

/**
 * One stamp per game Atlas can be called on: earned on any day kept where you outscored it.
 * Unearned, the note is the closest you came, the day with the smallest gap (ties to the newest),
 * so a near miss shows how little is left; a game never finished against Atlas has no note.
 */
function atlasStamps({ tallies }: StampSources): Stamp[] {
  return VERSUS_GAMES.map((game): Stamp => {
    const calls = tallies
      .map((t) => t.versus?.[game.id])
      .filter((v): v is Versus => v !== undefined);
    const earned = calls.some((v) => v.call === "you");
    let closest: Versus | null = null;
    for (const v of calls) {
      if (!closest || v.you - v.atlas > closest.you - closest.atlas) closest = v;
    }
    return {
      id: atlasStampId(game.id),
      group: "atlas",
      name: `Beat Atlas: ${game.name}`,
      how: `Outscore Atlas at today's ${game.name}, with Atlas playing all of it too`,
      icon: game.icon,
      earned,
      progress: null,
      note: !earned && closest ? closestWords(closest) : null,
    };
  });
}

/**
 * A clue read better than Atlas: earned once both of you have read `CLUE_PHOTOS` photos of it
 * and your rate is ahead of Atlas's, by the same whole percentages Your map shows. Short of the
 * photos, the progress counts them; past them but not ahead, there is no progress left to make,
 * only the gap to close.
 */
function aheadStamp(id: ClueStampId, tally: Tally, name: string, how: string, icon: string): Stamp {
  const photos = Math.min(tally.rounds, tally.atlasPlayed);
  const enough = photos >= CLUE_PHOTOS;
  const s = standing(tally);
  const earned = enough && s.lead === "you";
  let note: string | null = null;
  if (!earned && enough) note = `${standingLine(tally, "photo")} Read on to pull ahead.`;
  else if (!earned && s.you !== null && s.atlas !== null)
    note = `So far: you ${s.you}%, Atlas ${s.atlas}%`;
  return {
    id,
    group: "clues",
    name,
    how,
    icon,
    earned,
    progress: enough
      ? null
      : {
          have: photos,
          need: CLUE_PHOTOS,
          unit: ["photo read with Atlas", "photos read with Atlas"],
        },
    note,
  };
}

function clueStamps({ clues = NO_CLUES }: StampSources): Stamp[] {
  const climateRate = percent(clues.climate.right, clues.climate.rounds);
  return [
    {
      id: "road-reader",
      group: "clues",
      name: "Road reader",
      how: `Call the side of the road right ${ROAD_READER_RUN} photos in a row at Left or right?`,
      icon: "🛣️",
      earned: clues.bestRun >= ROAD_READER_RUN,
      progress: {
        have: Math.min(clues.bestRun, ROAD_READER_RUN),
        need: ROAD_READER_RUN,
        unit: ["call in a row", "calls in a row"],
      },
      note: null,
    },
    {
      id: "climate-reader",
      group: "clues",
      name: "Climate reader",
      how: `Name the climate of all ${CLIMATE_PHOTOS} photos of a Which climate? game`,
      icon: "🌦️",
      earned: clues.bestClimate >= CLIMATE_PHOTOS,
      progress: {
        have: Math.min(clues.bestClimate, CLIMATE_PHOTOS),
        need: CLIMATE_PHOTOS,
        unit: ["photo right", "photos right"],
      },
      note:
        clues.bestClimate < CLIMATE_PHOTOS && climateRate !== null
          ? `Right on ${climateRate}% of the climates you've named`
          : null,
    },
    aheadStamp(
      "road-ahead",
      clues.road,
      "Road ahead of Atlas",
      `Read the side of the road better than Atlas over at least ${CLUE_PHOTOS} photos`,
      "🚗",
    ),
    aheadStamp(
      "climate-ahead",
      clues.climate,
      "Climate ahead of Atlas",
      `Read the climate better than Atlas over at least ${CLUE_PHOTOS} photos`,
      "🌡️",
    ),
  ];
}

/** Every stamp as the browser's records stand, before what was kept is added in. */
export function readStamps(sources: StampSources): Stamp[] {
  return [
    ...badgeStamps(sources),
    ...continentStamps(sources),
    ...dayStamps(sources),
    ...atlasStamps(sources),
    ...clueStamps(sources),
  ];
}

/**
 * What the clue games keep in this browser, for `StampSources.clues`: the free bests and the
 * days each daily keeps (only whole Which climate? days), and Your map's clue reading.
 */
export function loadClueSources(): ClueSources {
  const runs = Object.values(loadSideDays()).map((d) => d.streak);
  const games = Object.values(loadClimateDays())
    .filter((d) => d.results.length >= CLIMATE_PHOTOS)
    .map((d) => d.results.filter((r) => r.correct).length);
  const record = loadQuickRecord();
  return {
    bestRun: Math.max(loadBestLeftRight(), ...runs),
    bestClimate: Math.max(loadBestClimate(), ...games),
    road: record["left-right"].total,
    climate: record["which-climate"].total,
  };
}

/** Stamp ids with the UTC day each was first seen earned. */
export type KeptStamps = Partial<Record<StampId, string>>;

/** Read kept stamps back; junk reads as none, and a bad entry drops only itself. */
export function parseKeptStamps(raw: string | null): KeptStamps {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
  const out: KeptStamps = {};
  for (const [id, day] of Object.entries(data as Record<string, unknown>)) {
    if (isStampId(id) && isDayKey(day)) out[id] = day;
  }
  return out;
}

export interface Collected {
  stamps: Stamp[];
  kept: KeptStamps;
  /** Stamps earned since the stamps were last kept: new to this browser's collection. */
  fresh: StampId[];
}

/**
 * Join what the records show with what was kept: a stamp kept earlier stays earned even when
 * its proof has aged out, and a stamp earned now is kept from `today`. Pure.
 */
export function collectStamps(
  stamps: readonly Stamp[],
  kept: KeptStamps,
  today: string,
): Collected {
  const next: KeptStamps = { ...kept };
  const fresh: StampId[] = [];
  const out = stamps.map((s) => {
    if (kept[s.id]) return { ...s, earned: true };
    if (s.earned) {
      next[s.id] = today;
      fresh.push(s.id);
    }
    return s;
  });
  return { stamps: out, kept: next, fresh };
}

/**
 * The unearned stamp closest to done, by share of its progress, ties to the earlier stamp; null
 * when every stamp with progress is earned.
 */
export function nextStamp(stamps: readonly Stamp[]): Stamp | null {
  let best: Stamp | null = null;
  let share = -1;
  for (const s of stamps) {
    if (s.earned || !s.progress || s.progress.need <= 0) continue;
    const at = s.progress.have / s.progress.need;
    if (at > share) {
      best = s;
      share = at;
    }
  }
  return best;
}

/** Minimal storage surface, so tests can pass a fake (including one that throws). */
export type StampStore = Pick<Storage, "getItem" | "setItem">;

function browserStore(): StampStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadKeptStamps(store: StampStore | null = browserStore()): KeptStamps {
  if (!store) return {};
  try {
    return parseKeptStamps(store.getItem(STAMPS_KEY));
  } catch {
    return {};
  }
}

/** Collect against the stored stamps and keep any new ones, best effort. */
export function keepStamps(
  stamps: readonly Stamp[],
  today: string,
  store: StampStore | null = browserStore(),
): Collected {
  const collected = collectStamps(stamps, loadKeptStamps(store), today);
  if (collected.fresh.length > 0) {
    try {
      store?.setItem(STAMPS_KEY, JSON.stringify(collected.kept));
    } catch {
      // Quota or privacy mode: the page still shows the stamps of this visit.
    }
  }
  return collected;
}

/** The countries a set of photos was taken in, by continent, sorted; for `StampSources`. */
export function countriesByContinent(
  photoCountries: Iterable<string | null | undefined>,
): Partial<Record<Continent, string[]>> {
  const sets = new Map<Continent, Set<string>>();
  for (const code of photoCountries) {
    const c = code ? CONTINENT_OF.get(code) : undefined;
    if (!c || !code) continue;
    const s = sets.get(c) ?? new Set<string>();
    s.add(code);
    sets.set(c, s);
  }
  const out: Partial<Record<Continent, string[]>> = {};
  for (const [c, s] of sets) out[c] = [...s].sort();
  return out;
}
