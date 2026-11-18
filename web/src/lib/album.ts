/**
 * Your album: every photo the game deals, collected one by one as you play it, continent by
 * continent. A photo is in the album once a round of the five-photo game (any of its modes) has
 * been revealed on it, read from your map's history (`lib/playedMap.ts`), so nothing new is
 * kept: the album is another way of looking at what the browser already holds.
 *
 * Photos not yet found stay blank. The page knows only each dealt photo's id and continent, so
 * it can count what is left to find on a continent without showing where any of it is.
 */

import { CONTINENTS, type Continent } from "@/lib/continents";
import type { PlayedPhoto } from "@/lib/playedMap";

export interface AlbumContinent {
  continent: Continent;
  /** Photos the game deals on this continent. */
  total: number;
  /** Photos found here, newest first. */
  found: PlayedPhoto[];
}

export interface Album {
  total: number;
  found: number;
  /** Continents with at least one photo dealt, in the site's continent order. */
  continents: AlbumContinent[];
}

/**
 * The album from each dealt photo's continent and your map's history. A photo the site no
 * longer deals, or one with no continent, is left out of both counts, so the album never shows
 * more found than there are to find.
 */
export function buildAlbum(
  continents: Readonly<Record<string, Continent>>,
  history: readonly PlayedPhoto[],
): Album {
  const totals = new Map<Continent, number>();
  for (const c of Object.values(continents)) totals.set(c, (totals.get(c) ?? 0) + 1);

  const found = new Map<Continent, PlayedPhoto[]>();
  const seen = new Set<string>();
  // The history is newest last; walk it backwards so each continent's list is newest first.
  for (let i = history.length - 1; i >= 0; i--) {
    const p = history[i];
    const c = Object.hasOwn(continents, p.id) ? continents[p.id] : undefined;
    if (!c || seen.has(p.id)) continue;
    seen.add(p.id);
    const list = found.get(c) ?? [];
    list.push(p);
    found.set(c, list);
  }

  const rows: AlbumContinent[] = CONTINENTS.filter((c) => (totals.get(c) ?? 0) > 0).map((c) => ({
    continent: c,
    total: totals.get(c)!,
    found: found.get(c) ?? [],
  }));
  return {
    total: rows.reduce((n, r) => n + r.total, 0),
    found: seen.size,
    continents: rows,
  };
}

/** A share as a whole percent, never rounded up to 100 before the last photo is found. */
export function percentFound(found: number, total: number): number {
  if (total <= 0 || found <= 0) return 0;
  if (found >= total) return 100;
  return Math.min(99, Math.max(1, Math.round((found / total) * 100)));
}

/**
 * Run `task` over `items` with at most `limit` running at once, so an album of hundreds of
 * photos asks the static host for a few records at a time rather than all at once.
 */
export async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !isCancelled()) {
      const item = items[next++];
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

/** The photo `delta` places along a continent's page from `index`, held at either end. */
export function stepIn(length: number, index: number, delta: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, index + delta));
}

/** How far a finger must travel sideways for a swipe to turn the page, in CSS pixels. */
export const SWIPE_PX = 50;

/**
 * Which way a swipe turns the page: a finger moved left shows the next photo (+1), right the
 * one before (-1); a short or mostly vertical move (a scroll) turns nothing.
 */
export function swipeStep(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}
