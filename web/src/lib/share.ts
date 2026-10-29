/**
 * The spoiler-free share card: what a player sends a friend after a game. It is built only from
 * numbers (distance bands, scores, who got closer, hints taken) and fixed words, so it can never
 * carry a place, a country, a photo or a coordinate. The tests in share.test.ts hold it to that
 * against every photo in the catalog.
 */
import { isDayKey } from "@/lib/game/dailyArchive";
import { ROUNDS_PER_GAME, totals, type RoundResult } from "@/lib/game/state";
import { MAX_POINTS, formatPoints } from "@/lib/geo";

export interface DistanceBand {
  /** Upper bound of the band in km (inclusive); Infinity for the last band. */
  maxKm: number;
  square: string;
  label: string;
}

/** Four coarse bands, so a distance never narrows down where a photo was. */
export const DISTANCE_BANDS: readonly DistanceBand[] = [
  { maxKm: 25, square: "🟩", label: "within 25 km" },
  { maxKm: 750, square: "🟨", label: "within 750 km" },
  { maxKm: 2500, square: "🟧", label: "within 2,500 km" },
  { maxKm: Infinity, square: "🟥", label: "over 2,500 km" },
];

/** The band a guess falls in; no pin at all (a Blitz clock ran out) is the farthest band. */
export function distanceBand(km: number | null): DistanceBand {
  if (km === null) return DISTANCE_BANDS[DISTANCE_BANDS.length - 1];
  return DISTANCE_BANDS.find((b) => km <= b.maxKm) ?? DISTANCE_BANDS[DISTANCE_BANDS.length - 1];
}

/** How a round went against Atlas. "none" when Atlas had no guess for the photo. */
export type Versus = "won" | "lost" | "tied" | "none";

export const VERSUS_MARK: Record<Versus, string> = {
  won: "✅",
  lost: "❌",
  tied: "🤝",
  none: "▫️",
};

export const VERSUS_LABEL: Record<Versus, string> = {
  won: "beat Atlas",
  lost: "Atlas got closer",
  tied: "tied with Atlas",
  none: "Atlas sat this one out",
};

export function versus(r: RoundResult): Versus {
  if (!r.atlas) return "none";
  if (r.reveal.score > r.atlas.score) return "won";
  if (r.reveal.score < r.atlas.score) return "lost";
  return "tied";
}

export interface ShareRound {
  band: DistanceBand;
  versus: Versus;
  hintsUsed: number;
}

export interface ShareCard {
  title: string;
  score: number;
  maxScore: number;
  rounds: ShareRound[];
  /** Rounds Atlas played, and how many of them the player won. */
  atlasRounds: number;
  playerWins: number;
  hintsUsed: number;
  url: string;
}

/**
 * The address to share: the game page itself, keeping only `?daily` so a friend lands on the
 * same Daily Five, with its day when it was a past one from the archive (`?daily=2026-10-20`).
 * Anything else in the query or hash is dropped, whatever ends up there later.
 */
export function shareUrl(href: string): string {
  const url = new URL(href);
  const daily = url.searchParams.get("daily");
  const query = daily === null ? "" : isDayKey(daily) ? `?daily=${daily}` : "?daily";
  return `${url.origin}${url.pathname}${query}`;
}

export function shareCard(title: string, results: readonly RoundResult[], href: string): ShareCard {
  const t = totals(results);
  return {
    title,
    score: t.player,
    maxScore: MAX_POINTS * ROUNDS_PER_GAME,
    rounds: results.map((r) => ({
      band: distanceBand(r.reveal.distanceKm),
      versus: versus(r),
      hintsUsed: r.reveal.hintsUsed,
    })),
    atlasRounds: t.atlasRounds,
    playerWins: t.playerWins,
    hintsUsed: results.reduce((sum, r) => sum + r.reveal.hintsUsed, 0),
    url: shareUrl(href),
  };
}

/** The card as plain text, for a chat message or the clipboard. */
export function shareText(card: ShareCard): string {
  const lines = [
    `Whereabout: ${card.title}`,
    `${formatPoints(card.score)} / ${formatPoints(card.maxScore)}`,
    card.rounds.map((r) => r.band.square).join(""),
  ];
  if (card.atlasRounds > 0) {
    lines.push(card.rounds.map((r) => VERSUS_MARK[r.versus]).join(""));
    lines.push(`Beat Atlas in ${card.playerWins} of ${card.atlasRounds} rounds`);
  }
  if (card.hintsUsed > 0) {
    lines.push(`${card.hintsUsed} ${card.hintsUsed === 1 ? "hint" : "hints"} taken`);
  }
  lines.push(card.url);
  return lines.join("\n");
}

export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

/** The parts of `navigator` sharing needs, so tests can stand in for the browser. */
export interface ShareTarget {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

/**
 * Send the card with the Web Share API where the browser offers it (phones, mostly), else copy
 * it. Closing the share sheet is not an error; a share that fails for another reason falls back
 * to the clipboard.
 */
export async function sendShare(text: string, target: ShareTarget): Promise<ShareOutcome> {
  const data: ShareData = { title: "Whereabout", text };
  if (typeof target.share === "function" && (target.canShare?.(data) ?? true)) {
    try {
      await target.share(data);
      return "shared";
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "AbortError") return "cancelled";
    }
  }
  try {
    if (!target.clipboard) return "failed";
    await target.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
