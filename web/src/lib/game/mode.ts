import type { Continent } from "@/lib/continents";

import { encodeChallenge, type Challenge } from "./challenge";
import type { Tier } from "./tiers";

/**
 * A fresh game is five photos the player hasn't seen lately; the Daily Five is shared by all; a
 * tier game is a fresh game drawn from one difficulty third (./tiers.ts), and a continent game
 * one drawn from the photos taken on one continent (./regions.ts). A challenge replays the five
 * photos a friend's link names (./challenge.ts). Blitz is a fresh game against a 30-second clock
 * on each photo (./blitz.ts). A Daily Five with `archive` is a past day's, played from the
 * archive (./dailyArchive.ts): it never counts toward the streak. `game` counts games of that kind in one visit, so each new one is
 * a new value even when nothing else changes.
 */
export type GameMode =
  | { kind: "daily"; day: string; archive?: boolean }
  | { kind: "fresh"; game: number }
  | { kind: "tier"; tier: Tier; game: number }
  | { kind: "region"; region: Continent; game: number }
  | { kind: "challenge"; challenge: Challenge }
  | { kind: "blitz"; game: number };

/**
 * True when two modes ask for the same kind of game: the same day's Daily Five, the same tier,
 * the same continent or the same challenge. The visit counter is ignored.
 */
export function sameKindOfGame(a: GameMode, b: GameMode): boolean {
  switch (a.kind) {
    case "daily":
      return b.kind === "daily" && a.day === b.day;
    case "tier":
      return b.kind === "tier" && a.tier === b.tier;
    case "region":
      return b.kind === "region" && a.region === b.region;
    case "challenge":
      return (
        b.kind === "challenge" && encodeChallenge(a.challenge) === encodeChallenge(b.challenge)
      );
    case "fresh":
    case "blitz":
      return a.kind === b.kind;
  }
}
