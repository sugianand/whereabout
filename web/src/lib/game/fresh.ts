/**
 * Fresh games: every visit opens on five photos the player has not seen recently.
 *
 * The browser remembers the ids of recently played photos (localStorage, best effort) and new
 * games are drawn from the rest of the catalog first. The memory is capped so there are always
 * enough unseen photos for a full game, which means a player cycles through the whole catalog
 * before any photo comes back.
 */

import { seededShuffle } from "./daily";

export const RECENT_KEY = "whereabout:recent-photos";

type HasId = { id: string };

/**
 * Pick `count` photos, preferring ones not in `recent`. When fewer than `count` unseen photos
 * are left, the game is topped up with the photos seen longest ago.
 */
export function pickFresh<T extends HasId>(
  catalog: readonly T[],
  recent: readonly string[],
  count = 5,
  random: () => number = Math.random,
): T[] {
  const shuffled = seededShuffle(catalog, Math.floor(random() * 2 ** 32));
  const seen = new Map(recent.map((id, i) => [id, i]));
  const unseen = shuffled.filter((p) => !seen.has(p.id));
  if (unseen.length >= count) return unseen.slice(0, count);
  // Oldest first: `recent` is ordered oldest to newest.
  const stale = shuffled
    .filter((p) => seen.has(p.id))
    .sort((a, b) => seen.get(a.id)! - seen.get(b.id)!);
  return [...unseen, ...stale].slice(0, count);
}

/**
 * Append the ids just played to the memory, newest last, without duplicates, keeping at most
 * `limit` ids. Pick `limit` as catalog size minus game length so a full unseen game always
 * exists.
 */
export function rememberPlayed(
  recent: readonly string[],
  played: readonly string[],
  limit: number,
): string[] {
  const playedSet = new Set(played);
  const merged = [...recent.filter((id) => !playedSet.has(id)), ...played];
  return limit > 0 ? merged.slice(-limit) : [];
}

/** Minimal storage surface, so tests can pass a fake and private windows can fail safely. */
export type RecentStore = Pick<Storage, "getItem" | "setItem">;

function browserStore(): RecentStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // Storage blocked (privacy settings, sandboxed iframe).
  }
}

export function loadRecent(store: RecentStore | null = browserStore()): string[] {
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveRecent(ids: readonly string[], store: RecentStore | null = browserStore()) {
  if (!store) return;
  try {
    store.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    // Quota or privacy mode: fresh games still work, they just can't avoid repeats.
  }
}
