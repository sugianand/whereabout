/**
 * Badges: milestones earned from real play, kept in the player's record in this browser
 * (`lib/playerRecord.ts`). Three follow from the record's own totals (a first round won against
 * Atlas, a five-day Daily Five streak, a round on every inhabited continent), so records saved
 * before badges existed get those back on load. The other two need the game that earned them (a
 * pin within 25 km, a Hard game won against Atlas) and are noted when that game joins the record.
 *
 * A badge, once earned, stays: losing a streak later never takes "Five-day streak" away.
 */

import type { Continent } from "@/lib/continents";
import type { RoundResult } from "@/lib/game/state";
import type { FinishedGame, PlayerRecord } from "@/lib/playerRecord";

export const BADGE_IDS = [
  "first-win",
  "bullseye",
  "daily-five",
  "globetrotter",
  "hard-won",
] as const;

export type BadgeId = (typeof BADGE_IDS)[number];

export interface Badge {
  id: BadgeId;
  name: string;
  /** How it is earned, shown whether or not it has been. */
  how: string;
}

/** How close a pin must land for "Bullseye". */
export const BULLSEYE_KM = 25;

/** Daily Five puzzle days in a row for "Five-day streak". */
export const STREAK_DAYS = 5;

/**
 * The continents "Globetrotter" asks for. Antarctica is left out: the catalog has a single photo
 * there, so a badge needing it would be luck, not travel.
 */
export const GLOBETROTTER_CONTINENTS: readonly Continent[] = [
  "Africa",
  "Asia",
  "Europe",
  "North America",
  "South America",
  "Oceania",
];

export const BADGES: readonly Badge[] = [
  { id: "first-win", name: "First win", how: "Score more than Atlas on a photo" },
  {
    id: "bullseye",
    name: "Bullseye",
    how: `Drop a pin within ${BULLSEYE_KM} km of where a photo was taken`,
  },
  {
    id: "daily-five",
    name: "Five-day streak",
    how: `Play the Daily Five ${STREAK_DAYS} days in a row`,
  },
  {
    id: "globetrotter",
    name: "Globetrotter",
    how: "Play a photo from each of the six inhabited continents",
  },
  { id: "hard-won", name: "Hard won", how: "Outscore Atlas over a whole Hard game" },
];

const KNOWN: ReadonlySet<string> = new Set(BADGE_IDS);

export const isBadgeId = (v: unknown): v is BadgeId => typeof v === "string" && KNOWN.has(v);

/** What a finished game tells the badges beyond the record's totals. */
export type GameFeats = Pick<FinishedGame, "closestKm" | "hardWon">;

/**
 * The feats of one finished game: its closest pin (null if no round had a pin), and whether it
 * was a Hard game won against Atlas, which means scoring more than Atlas over the rounds it
 * guessed, exactly as the summary's totals compare the two.
 */
export function gameFeats(
  results: readonly Pick<RoundResult, "reveal" | "atlas">[],
  hard: boolean,
): GameFeats {
  const distances = results
    .map((r) => r.reveal.distanceKm)
    .filter((d): d is number => d !== null && Number.isFinite(d));
  const vsAtlas = results.filter((r) => r.atlas);
  const player = vsAtlas.reduce((s, r) => s + r.reveal.score, 0);
  const atlas = vsAtlas.reduce((s, r) => s + (r.atlas?.score ?? 0), 0);
  return {
    closestKm: distances.length ? Math.min(...distances) : null,
    hardWon: hard && vsAtlas.length > 0 && player > atlas,
  };
}

/** The badges a record's totals (and, if given, the game just added) have earned. */
export function earnedBadges(record: PlayerRecord, game?: GameFeats | null): Set<BadgeId> {
  const out = new Set<BadgeId>();
  if (record.roundsWon > 0) out.add("first-win");
  if (record.bestStreak >= STREAK_DAYS) out.add("daily-five");
  if (GLOBETROTTER_CONTINENTS.every((c) => (record.continents[c]?.rounds ?? 0) > 0)) {
    out.add("globetrotter");
  }
  if (game?.closestKm != null && game.closestKm <= BULLSEYE_KM) out.add("bullseye");
  if (game?.hardWon) out.add("hard-won");
  return out;
}

/** Both lists merged, in `BADGE_IDS` order, each badge once. */
export function mergeBadges(...lists: Iterable<BadgeId>[]): BadgeId[] {
  const all = new Set<BadgeId>();
  for (const l of lists) for (const id of l) all.add(id);
  return BADGE_IDS.filter((id) => all.has(id));
}

/** The badges in `after` that `before` didn't have: the ones this game earned. */
export function newBadges(before: readonly BadgeId[], after: readonly BadgeId[]): BadgeId[] {
  const had = new Set(before);
  return after.filter((id) => !had.has(id));
}
