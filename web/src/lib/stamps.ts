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
 *   reader for every photo right in a whole Which climate? game and a ground reader for every
 *   photo right in a whole What's on the ground? game (free or today's; a practice game of your
 *   mix-ups is dealt from fewer climates or covers and doesn't count), and one per clue (the
 *   road, the climate, the ground) for reading it better than Atlas over at least `CLUE_PHOTOS`
 *   photos, by Your map's clue reading (`lib/game/quickRecord.ts`), with Atlas's rate over the
 *   photos it read.
 * - Your album (`lib/album.ts`): a quarter, half and all of the album found, and one per
 *   continent for its page complete, read from the same history the album is, so the counts on
 *   a stamp and on the album always agree.
 * - The World Tour (`lib/tour.ts`): one per leg of the route, earned when the leg is cleared, and
 *   one for the whole tour with how many legs are left, read from the record the tour page reads.
 * - Bullseye (`lib/game/bullseye.ts`): five tight rings held in one whole game, free or today's,
 *   and your rings holding their photos more often than Atlas's over at least
 *   `BULLSEYE_CALIBRATION_PHOTOS` photos, by Your calibration on Your map.
 * - Spot the clue (`lib/game/spotClue.ts`): Mind reader for Atlas's most telling square found on
 *   all five photos of one whole game, free or today's, and a running count of the hottest
 *   squares found in any game toward `SPOT_FOUND_STAMP`, by your read of Atlas on Your map.
 * - Trust Atlas? (`lib/game/trustAtlas.ts`): Lie detector for every call right in one whole game,
 *   free or today's, and calling more right than Atlas's own rule over at least
 *   `TRUST_READ_PHOTOS` photos, by your trust on Your map.
 * - Which fooled Atlas? (`lib/game/fooledAtlas.ts`): Blind spot for a run of `FOOLED_RUN_STAMP`
 *   right picks, free or today's, and picking more pairs right than Atlas's own sureness over at
 *   least `FOOLED_READ_PAIRS` pairs, by what fools Atlas on Your map.
 *
 * The days every game keeps are the last `ARCHIVE_DAYS`, and the map's history is capped, so a
 * stamp could otherwise fade once its proof is gone. Each stamp is therefore written down under
 * `STAMPS_KEY` with the day it was first seen earned, and stays from then on, like a badge.
 * What comes back from storage is checked: unknown ids and malformed days are dropped.
 */

import { buildAlbum } from "@/lib/album";
import { BADGES, GLOBETROTTER_CONTINENTS, STREAK_DAYS, type BadgeId } from "@/lib/badges";
import { CONTINENT_OF, CONTINENTS, type Continent } from "@/lib/continents";
import { countryName } from "@/lib/countries";
import { isDayKey } from "@/lib/game/dailyArchive";
import { regionSlug } from "@/lib/game/regions";
import { formatDistance, formatPoints } from "@/lib/geo";
import { loadClimateDays } from "@/lib/game/climateDaily";
import { loadGroundDays } from "@/lib/game/groundDaily";
import { GROUND_PHOTOS, loadBestGround } from "@/lib/game/onTheGround";
import { loadBestLeftRight } from "@/lib/game/leftRight";
import { BULLSEYE_PHOTOS, loadBestTight, tightRingsHeld } from "@/lib/game/bullseye";
import {
  calibrationLeader,
  emptyCalibration,
  heldRate,
  loadCalibration,
  totals,
  type Calibration,
} from "@/lib/game/bullseyeCalibration";
import { loadBullseyeDays } from "@/lib/game/bullseyeDaily";
import { SPOT_PHOTOS, loadBestHottest, spotTotals } from "@/lib/game/spotClue";
import { loadSpotDays } from "@/lib/game/spotDaily";
import { loadSpotRead } from "@/lib/game/spotRead";
import { TRUST_PHOTOS, loadBestTrust, trustTotals } from "@/lib/game/trustAtlas";
import { loadTrustDays } from "@/lib/game/trustDaily";
import { loadBestFooled } from "@/lib/game/fooledAtlas";
import { loadFooledDays } from "@/lib/game/fooledDaily";
import {
  emptyFooledRead,
  fooledReadLeader,
  fooledReadTotals,
  loadFooledRead,
  type FooledRead,
} from "@/lib/game/fooledRead";
import {
  emptyTrustRead,
  loadTrustRead,
  trustReadLeader,
  trustReadTotals,
  type TrustRead,
} from "@/lib/game/trustRead";
import {
  clueReading,
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
import { clearedCount, TOUR_ROUTE, type TourRecord } from "@/lib/tour";
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
  "ground-reader",
  "road-ahead",
  "climate-ahead",
  "ground-ahead",
] as const;
export type ClueStampId = (typeof CLUE_STAMP_IDS)[number];

/** The album's share stamps: a quarter, half and all of it found. */
export const ALBUM_SHARES = [
  { id: "album-quarter", name: "A quarter of the album", share: 1 / 4, icon: "🔖" },
  { id: "album-half", name: "Half the album", share: 1 / 2, icon: "📒" },
  { id: "album-whole", name: "The whole album", share: 1, icon: "📚" },
] as const;
export type AlbumShareStampId = (typeof ALBUM_SHARES)[number]["id"];
export type AlbumPageStampId = `album-${string}-page`;
export type TourLegStampId = `tour-${string}`;

/** Photos bet beside Atlas before holding your rings more often earns the calibration stamp. */
export const BULLSEYE_CALIBRATION_PHOTOS = 30;

export const BULLSEYE_STAMP_IDS = ["bullseye-five-tight", "bullseye-calibrated"] as const;
export type BullseyeStampId = (typeof BULLSEYE_STAMP_IDS)[number];

/** Atlas's hottest squares found, over every Spot the clue game, for the running-count stamp. */
export const SPOT_FOUND_STAMP = 25;

export const SPOT_STAMP_IDS = ["spot-mind-reader", "spot-found"] as const;
export type SpotStampId = (typeof SPOT_STAMP_IDS)[number];

/** Photos called in Trust Atlas? before calling more right than Atlas's own rule earns a stamp. */
export const TRUST_READ_PHOTOS = 50;

export const TRUST_STAMP_IDS = ["trust-lie-detector", "trust-second-opinion"] as const;
export type TrustStampId = (typeof TRUST_STAMP_IDS)[number];

/** Right picks in a row in one Which fooled Atlas? run that earn a stamp. */
export const FOOLED_RUN_STAMP = 10;

/** Pairs read in Which fooled Atlas? before picking more right than Atlas's sureness earns a stamp. */
export const FOOLED_READ_PAIRS = 50;

export const FOOLED_STAMP_IDS = ["fooled-blind-spot", "fooled-mind-over-model"] as const;
export type FooledStampId = (typeof FOOLED_STAMP_IDS)[number];

export type StampId =
  | BadgeId
  | ContinentStampId
  | "full-day"
  | "full-week"
  | AtlasStampId
  | ClueStampId
  | AlbumShareStampId
  | AlbumPageStampId
  | TourLegStampId
  | "tour-complete"
  | BullseyeStampId
  | SpotStampId
  | TrustStampId
  | FooledStampId;

export type StampGroup =
  | "badges"
  | "continents"
  | "days"
  | "atlas"
  | "clues"
  | "album"
  | "tour"
  | "bullseye"
  | "spot"
  | "trust"
  | "fooled";

export const STAMP_GROUPS: readonly { id: StampGroup; title: string }[] = [
  { id: "badges", title: "Badges" },
  { id: "continents", title: "Continents cleared" },
  { id: "days", title: "Full days" },
  { id: "atlas", title: "Beat Atlas" },
  { id: "clues", title: "Reading the clues" },
  { id: "album", title: "Your album" },
  { id: "tour", title: "World Tour" },
  { id: "bullseye", title: "Bullseye" },
  { id: "spot", title: "Spot the clue" },
  { id: "trust", title: "Trust Atlas?" },
  { id: "fooled", title: "Which fooled Atlas?" },
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
  /**
   * Each photo the album holds, by id, with its continent (`bundledContinents`); the album is
   * read from it and `played`, as on the album page. No album stamps if not given or empty.
   */
  album?: Readonly<Record<string, Continent>>;
  /** The World Tour's route (`tourRoute`) and its record (`loadTour`); no tour stamps without. */
  tour?: { route: readonly Continent[]; record: TourRecord };
  /** What Bullseye keeps (`loadBullseyeSources`); none played if not given. */
  bullseye?: BullseyeSources;
  /** What Spot the clue keeps (`loadSpotSources`); none played if not given. */
  spot?: SpotSources;
  /** What Trust Atlas? keeps (`loadTrustSources`); none played if not given. */
  trust?: TrustSources;
  /** What Which fooled Atlas? keeps (`loadFooledSources`); none played if not given. */
  fooled?: FooledSources;
}

/** What Which fooled Atlas? keeps, for its stamps. */
export interface FooledSources {
  /** The longest run of right picks, free or today's. */
  bestRun: number;
  /** Every pair picked, by how far apart the misses were, as what fools Atlas reads it. */
  read: FooledRead;
}

/** What Trust Atlas? keeps, for its stamps. */
export interface TrustSources {
  /** The most calls right in one whole game, free or today's. */
  bestCorrect: number;
  /** Every call kept, by Atlas's sureness, as your trust on Your map reads it. */
  read: TrustRead;
}

/** What Spot the clue keeps, for its stamps. */
export interface SpotSources {
  /** The most of Atlas's hottest squares found in one whole game, free or today's. */
  bestHottest: number;
  /** Atlas's hottest squares found over every square locked in, as your read of Atlas counts. */
  found: number;
}

/** What Bullseye keeps, for its stamps. */
export interface BullseyeSources {
  /** The most 250 km rings held in one whole game, free or today's. */
  bestTight: number;
  /** Every ring bet and held, yours and Atlas's, as Your calibration counts them. */
  calibration: Calibration;
}

/** What the clue games keep, for the clue stamps. */
export interface ClueSources {
  /** The longest Left or right? run: the free runs' best or a day's run. */
  bestRun: number;
  /** Most photos right in one whole Which climate? game, free or today's. */
  bestClimate: number;
  /** Most photos right in one whole What's on the ground? game, free or today's. */
  bestGround: number;
  /** Your clue reading against Atlas's, free and daily, Clue mix included (`clueReading`). */
  road: Tally;
  climate: Tally;
  ground: Tally;
}

export const NO_CLUES: ClueSources = {
  bestRun: 0,
  bestClimate: 0,
  bestGround: 0,
  road: { runs: 0, rounds: 0, right: 0, atlasPlayed: 0, atlasRight: 0 },
  climate: { runs: 0, rounds: 0, right: 0, atlasPlayed: 0, atlasRight: 0 },
  ground: { runs: 0, rounds: 0, right: 0, atlasPlayed: 0, atlasRight: 0 },
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

export function albumPageStampId(c: Continent): AlbumPageStampId {
  return `album-${regionSlug(c)}-page`;
}

export function tourLegStampId(c: Continent): TourLegStampId {
  return `tour-${regionSlug(c)}`;
}

/** Every stamp id there can be, in the order the page lists them. */
export const STAMP_IDS: readonly StampId[] = [
  ...BADGES.map((b) => b.id),
  ...GLOBETROTTER_CONTINENTS.map(continentStampId),
  "full-day",
  "full-week",
  ...VERSUS_GAMES.map((g) => atlasStampId(g.id)),
  ...CLUE_STAMP_IDS,
  ...ALBUM_SHARES.map((a) => a.id),
  ...CONTINENTS.map(albumPageStampId),
  ...TOUR_ROUTE.map(tourLegStampId),
  "tour-complete",
  ...BULLSEYE_STAMP_IDS,
  ...SPOT_STAMP_IDS,
  ...TRUST_STAMP_IDS,
  ...FOOLED_STAMP_IDS,
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

/**
 * Every photo right in one whole game of five: `best` is the most right in a whole game kept,
 * and until the stamp is earned the note gives the rate over every call of that clue so far.
 */
function wholeGameStamp(
  id: ClueStampId,
  best: number,
  need: number,
  tally: Tally,
  name: string,
  how: string,
  icon: string,
  named: string,
): Stamp {
  const rate = percent(tally.right, tally.rounds);
  return {
    id,
    group: "clues",
    name,
    how,
    icon,
    earned: best >= need,
    progress: { have: Math.min(best, need), need, unit: ["photo right", "photos right"] },
    note: best < need && rate !== null ? `Right on ${rate}% of the ${named} you've named` : null,
  };
}

function clueStamps({ clues = NO_CLUES }: StampSources): Stamp[] {
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
    wholeGameStamp(
      "climate-reader",
      clues.bestClimate,
      CLIMATE_PHOTOS,
      clues.climate,
      "Climate reader",
      `Name the climate of all ${CLIMATE_PHOTOS} photos of a Which climate? game`,
      "🌦️",
      "climates",
    ),
    wholeGameStamp(
      "ground-reader",
      clues.bestGround,
      GROUND_PHOTOS,
      clues.ground,
      "Ground reader",
      `Name the ground of all ${GROUND_PHOTOS} photos of a What's on the ground? game`,
      "🌱",
      "covers",
    ),
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
    aheadStamp(
      "ground-ahead",
      clues.ground,
      "Ground ahead of Atlas",
      `Read what covers the ground better than Atlas over at least ${CLUE_PHOTOS} photos`,
      "🌳",
    ),
  ];
}

/** Photos found before a share of the album is reached: never zero, so no stamp comes free. */
export function albumShareNeed(total: number, share: number): number {
  return Math.max(1, Math.ceil(total * share));
}

/**
 * The album's stamps, from the album as its page builds it (`buildAlbum`): a quarter, half and
 * all of it found, then one per continent the album has a page for, in the album's order. They
 * count photos only, never which ones, so a stamp gives nothing away the album doesn't.
 */
function albumStamps({ album: continents, played }: StampSources): Stamp[] {
  if (!continents) return [];
  const album = buildAlbum(continents, played);
  if (album.total === 0) return [];
  const unit = ["photo found", "photos found"] as const;
  const shares = ALBUM_SHARES.map((a): Stamp => {
    const need = albumShareNeed(album.total, a.share);
    return {
      id: a.id,
      group: "album",
      name: a.name,
      how:
        a.share === 1
          ? `Find all ${album.total} photos the game deals, on every continent`
          : `Find ${need} of the ${album.total} photos the game deals`,
      icon: a.icon,
      earned: album.found >= need,
      progress: { have: Math.min(album.found, need), need, unit },
      note: null,
    };
  });
  const pages = album.continents.map((row): Stamp => {
    const have = row.found.length;
    return {
      id: albumPageStampId(row.continent),
      group: "album",
      name: `${row.continent}'s page`,
      how: `Find all ${row.total} ${row.total === 1 ? "photo" : "photos"} the game deals in ${row.continent}`,
      icon: "📖",
      earned: have >= row.total,
      progress: { have, need: row.total, unit },
      note: null,
    };
  });
  return [...shares, ...pages];
}

/**
 * The World Tour's stamps: one per leg in route order, earned once the leg is cleared, then the
 * whole tour with the legs cleared counted. A leg played but not cleared notes its best game
 * against Atlas, the same lead or deficit the tour page shows, so a near miss says how near.
 */
function tourStamps({ tour }: StampSources): Stamp[] {
  if (!tour || tour.route.length === 0) return [];
  const { route, record } = tour;
  const legs = route.map((c): Stamp => {
    const leg = record[c];
    const earned = Boolean(leg?.cleared);
    return {
      id: tourLegStampId(c),
      group: "tour",
      name: `${c} leg`,
      how: `Outscore Atlas over a five-photo game in ${c}`,
      icon: "🚩",
      earned,
      progress: null,
      note:
        !earned && leg
          ? closestWords({ you: leg.best.you, atlas: leg.best.atlas, unit: "points" })
          : null,
    };
  });
  const cleared = clearedCount(route, record);
  const whole: Stamp = {
    id: "tour-complete",
    group: "tour",
    name: "The whole tour",
    how: `Clear all ${route.length} legs of the World Tour`,
    icon: "🗺️",
    earned: cleared >= route.length,
    progress: { have: cleared, need: route.length, unit: ["leg", "legs"] },
    note: null,
  };
  return [...legs, whole];
}

const pct = (rate: number | null) => `${Math.round((rate ?? 0) * 100)}%`;

/**
 * Bullseye's stamps. Five tight rings in one game counts the most held in a whole game kept.
 * Rings held more often than Atlas is earned once Atlas has bet on `BULLSEYE_CALIBRATION_PHOTOS`
 * photos beside you (it only bets on photos you bet on too) and your rings hold their photos more
 * often than its do, by the same comparison as Your calibration, so the stamp and Your map agree.
 */
function bullseyeStamps({ bullseye }: StampSources): Stamp[] {
  const bestTight = bullseye?.bestTight ?? 0;
  const cal = bullseye?.calibration ?? emptyCalibration();
  const you = totals(cal.you);
  const atlas = totals(cal.atlas);
  const photos = Math.min(you.bet, atlas.bet);
  const enough = photos >= BULLSEYE_CALIBRATION_PHOTOS;
  const leader = calibrationLeader(cal);
  const calibrated = enough && leader === "you";
  const rates = `yours ${pct(heldRate(you))}, Atlas's ${pct(heldRate(atlas))}`;
  let note: string | null = null;
  if (!calibrated && enough) note = `Rings held: ${rates}. Bet on to pull ahead.`;
  else if (!calibrated && leader !== null) note = `Rings held so far: ${rates}`;
  return [
    {
      id: "bullseye-five-tight",
      group: "bullseye",
      name: "Five tight rings",
      how: `Bet the tightest ring on all ${BULLSEYE_PHOTOS} photos of a Bullseye game and hold every one`,
      icon: "🏹",
      earned: bestTight >= BULLSEYE_PHOTOS,
      progress: {
        have: Math.min(bestTight, BULLSEYE_PHOTOS),
        need: BULLSEYE_PHOTOS,
        unit: ["tight ring in a game", "tight rings in a game"],
      },
      note: null,
    },
    {
      id: "bullseye-calibrated",
      group: "bullseye",
      name: "Surer than Atlas",
      how: `Hold your Bullseye rings more often than Atlas holds its over at least ${BULLSEYE_CALIBRATION_PHOTOS} photos`,
      icon: "⚖️",
      earned: calibrated,
      progress: enough
        ? null
        : {
            have: photos,
            need: BULLSEYE_CALIBRATION_PHOTOS,
            unit: ["photo bet with Atlas", "photos bet with Atlas"],
          },
      note,
    },
  ];
}

/**
 * Spot the clue's stamps. Mind reader counts the most of Atlas's hottest squares found in a whole
 * game kept; the running count is every square that was one of them, in any game, as your read
 * of Atlas on Your map counts them.
 */
function spotStamps({ spot }: StampSources): Stamp[] {
  const bestHottest = Math.min(spot?.bestHottest ?? 0, SPOT_PHOTOS);
  const found = spot?.found ?? 0;
  return [
    {
      id: "spot-mind-reader",
      group: "spot",
      name: "Mind reader",
      how: `Find Atlas's most telling square on all ${SPOT_PHOTOS} photos of a Spot the clue game`,
      icon: "🔮",
      earned: bestHottest >= SPOT_PHOTOS,
      progress: {
        have: bestHottest,
        need: SPOT_PHOTOS,
        unit: ["hottest square in a game", "hottest squares in a game"],
      },
      note: null,
    },
    {
      id: "spot-found",
      group: "spot",
      name: "Sharp eye",
      how: `Find Atlas's most telling square ${SPOT_FOUND_STAMP} times, in any Spot the clue game`,
      icon: "👁️",
      earned: found >= SPOT_FOUND_STAMP,
      progress:
        found >= SPOT_FOUND_STAMP
          ? null
          : { have: found, need: SPOT_FOUND_STAMP, unit: ["square found", "squares found"] },
      note: found >= SPOT_FOUND_STAMP ? `${found} found so far` : null,
    },
  ];
}

/**
 * Trust Atlas?'s stamps. Lie detector counts the most calls right in a whole game kept; Second
 * opinion compares your calls with Atlas's own rule on the same photos, by `trustReadLeader`, so
 * the stamp and your trust on Your map always agree.
 */
function trustStamps({ trust }: StampSources): Stamp[] {
  const bestCorrect = Math.min(trust?.bestCorrect ?? 0, TRUST_PHOTOS);
  const read = trust?.read ?? emptyTrustRead();
  const { photos, you, rule } = trustReadTotals(read);
  const enough = photos >= TRUST_READ_PHOTOS;
  const leader = trustReadLeader(read);
  const ahead = enough && leader === "you";
  const counts = `yours ${you}, Atlas's own rule ${rule}`;
  let note: string | null = null;
  if (ahead) note = `Calls right over ${photos} photos: ${counts}`;
  else if (enough) note = `Calls right over ${photos} photos: ${counts}. Call on to pull ahead.`;
  else if (leader !== null) note = `Calls right so far: ${counts}`;
  return [
    {
      id: "trust-lie-detector",
      group: "trust",
      name: "Lie detector",
      how: `Call all ${TRUST_PHOTOS} photos of a Trust Atlas? game right`,
      icon: "🕵️",
      earned: bestCorrect >= TRUST_PHOTOS,
      progress: {
        have: bestCorrect,
        need: TRUST_PHOTOS,
        unit: ["call right in a game", "calls right in a game"],
      },
      note: null,
    },
    {
      id: "trust-second-opinion",
      group: "trust",
      name: "Second opinion",
      how: `Call more Trust Atlas? photos right than Atlas's own sureness does, over at least ${TRUST_READ_PHOTOS} photos`,
      icon: "🧐",
      earned: ahead,
      progress: enough
        ? null
        : { have: photos, need: TRUST_READ_PHOTOS, unit: ["photo called", "photos called"] },
      note,
    },
  ];
}

/**
 * Which fooled Atlas?'s stamps. Blind spot counts the longest run kept; Mind over model compares
 * your picks with Atlas's own sureness on the same pairs, by `fooledReadLeader`, so the stamp and
 * what fools Atlas on Your map always agree. Dead heats are left out of both counts there, so
 * they are here too.
 */
function fooledStamps({ fooled }: StampSources): Stamp[] {
  const bestRun = Math.min(fooled?.bestRun ?? 0, FOOLED_RUN_STAMP);
  const read = fooled?.read ?? emptyFooledRead();
  const { pairs, you, atlas } = fooledReadTotals(read);
  const enough = pairs >= FOOLED_READ_PAIRS;
  const leader = fooledReadLeader(read);
  const ahead = enough && leader === "you";
  const counts = `yours ${you}, Atlas's own sureness ${atlas}`;
  let note: string | null = null;
  if (ahead) note = `Pairs right over ${pairs} pairs: ${counts}`;
  else if (enough) note = `Pairs right over ${pairs} pairs: ${counts}. Pick on to pull ahead.`;
  else if (leader !== null) note = `Pairs right so far: ${counts}`;
  return [
    {
      id: "fooled-blind-spot",
      group: "fooled",
      name: "Blind spot",
      how: `Pick ${FOOLED_RUN_STAMP} pairs right in a row in one Which fooled Atlas? run`,
      icon: "🙈",
      earned: bestRun >= FOOLED_RUN_STAMP,
      progress: {
        have: bestRun,
        need: FOOLED_RUN_STAMP,
        unit: ["pick in a row", "picks in a row"],
      },
      note: null,
    },
    {
      id: "fooled-mind-over-model",
      group: "fooled",
      name: "Mind over model",
      how: `Pick more Which fooled Atlas? pairs right than Atlas's own sureness does, over at least ${FOOLED_READ_PAIRS} pairs`,
      icon: "🧠",
      earned: ahead,
      progress: enough
        ? null
        : { have: pairs, need: FOOLED_READ_PAIRS, unit: ["pair read", "pairs read"] },
      note,
    },
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
    ...albumStamps(sources),
    ...tourStamps(sources),
    ...bullseyeStamps(sources),
    ...spotStamps(sources),
    ...trustStamps(sources),
    ...fooledStamps(sources),
  ];
}

/**
 * What Bullseye keeps in this browser, for `StampSources.bullseye`: the most tight rings held in
 * a whole free game, or in one of today's games played out, and every bet as Your calibration
 * counts them. A friend's challenge counts toward the calibration but not the five tight rings,
 * as it never counts toward the best either.
 */
export function loadBullseyeSources(): BullseyeSources {
  const days = Object.values(loadBullseyeDays())
    .filter((d) => d.results.length >= BULLSEYE_PHOTOS)
    .map((d) => tightRingsHeld(d.results));
  return { bestTight: Math.max(loadBestTight(), ...days), calibration: loadCalibration() };
}

/**
 * What Spot the clue keeps in this browser, for `StampSources.spot`: the most of Atlas's hottest
 * squares found in a whole free game, or in one of today's games played out, and every one found
 * as your read of Atlas counts them. A friend's challenge counts toward the running count but not
 * Mind reader, as it never counts toward the best either.
 */
export function loadSpotSources(): SpotSources {
  const days = Object.values(loadSpotDays())
    .filter((d) => d.results.length >= SPOT_PHOTOS)
    .map((d) => spotTotals(d.results).hottest);
  return { bestHottest: Math.max(loadBestHottest(), ...days), found: loadSpotRead().hottest };
}

/**
 * What Trust Atlas? keeps in this browser, for `StampSources.trust`: the most calls right in a
 * whole free game, or in one of today's games played out, and every call as your trust on Your
 * map counts them. A friend's challenge counts toward the calls but not Lie detector, as it
 * never counts toward the best either.
 */
export function loadTrustSources(): TrustSources {
  const days = Object.values(loadTrustDays())
    .filter((d) => d.results.length >= TRUST_PHOTOS)
    .map((d) => trustTotals(d.results).correct);
  return { bestCorrect: Math.max(loadBestTrust(), ...days), read: loadTrustRead() };
}

/**
 * What Which fooled Atlas? keeps in this browser, for `StampSources.fooled`: the longest free run
 * (kept after every right pick, so a run left midway counts as far as it got), or the longest of
 * today's runs kept, and every pair as what fools Atlas counts them. A friend's challenge counts
 * toward the pairs but not Blind spot, as it never counts toward the best either.
 */
export function loadFooledSources(): FooledSources {
  const days = Object.values(loadFooledDays()).map((d) => d.streak);
  return { bestRun: Math.max(loadBestFooled(), ...days), read: loadFooledRead() };
}

/**
 * What the clue games keep in this browser, for `StampSources.clues`: the free bests and the
 * days each daily keeps (only whole Which climate? and What's on the ground? days), and Your
 * map's clue reading. A practice game of your mix-ups keeps its best under its own key, so it
 * is never read here.
 */
export function loadClueSources(): ClueSources {
  const runs = Object.values(loadSideDays()).map((d) => d.streak);
  const games = Object.values(loadClimateDays())
    .filter((d) => d.results.length >= CLIMATE_PHOTOS)
    .map((d) => d.results.filter((r) => r.correct).length);
  const grounds = Object.values(loadGroundDays())
    .filter((d) => d.results.length >= GROUND_PHOTOS)
    .map((d) => d.results.filter((r) => r.correct).length);
  // The same figures as Your map's clue reading: Clue mix's calls count with each clue's game.
  const reading = clueReading(loadQuickRecord());
  return {
    bestRun: Math.max(loadBestLeftRight(), ...runs),
    bestClimate: Math.max(loadBestClimate(), ...games),
    bestGround: Math.max(loadBestGround(), ...grounds),
    road: reading.road.total,
    climate: reading.climate.total,
    ground: reading.ground.total,
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
