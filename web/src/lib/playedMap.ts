/**
 * Your map: every photo you've played, where it was taken and how close your pin landed, kept
 * only in this browser (localStorage) so the `/map` page can put them all on the globe.
 *
 * Each revealed round adds one entry. A photo played again replaces its earlier entry and moves
 * to the newest end, so the map shows your latest try on each photo, never duplicate dots. The
 * history is capped at `MAX_PLAYED` photos; the oldest leave first.
 *
 * Like the record (`lib/playerRecord.ts`) this is best effort: blocked or full storage never
 * stops a game, and what comes back from storage goes through `parsePlayed`, which drops any
 * entry that is malformed rather than trusting it (the rest of the history survives).
 */

import { CONTINENTS, continentOf, type Continent } from "@/lib/continents";
import { closenessOf, type Closeness } from "@/lib/feel";
import { MAX_POINTS } from "@/lib/geo";

export const PLAYED_KEY = "whereabout:played";

/** How many photos the history keeps; a few hundred entries are a few tens of kB. */
export const MAX_PLAYED = 400;

export interface PlayedPhoto {
  /** The catalog photo id, e.g. "wm042". */
  id: string;
  /** Where the photo was taken. */
  lng: number;
  lat: number;
  place: string;
  /** ISO 3166-1 alpha-2 code of the answer's country, or null when the catalog has none. */
  country: string | null;
  /** How far the pin was from the answer, or null when a Blitz clock ran out with no pin. */
  km: number | null;
  score: number;
  /** The UTC day the round was played, "YYYY-MM-DD". */
  day: string;
}

/** The closenesses in order from best to worst, as the map's legend lists them. */
export const BANDS: readonly Closeness[] = ["bullseye", "close", "near", "far"];

/** Add one played round to the history. Pure: returns a new array, newest last. */
export function addPlayed(
  history: readonly PlayedPhoto[],
  entry: PlayedPhoto,
  max = MAX_PLAYED,
): PlayedPhoto[] {
  const rest = history.filter((p) => p.id !== entry.id);
  rest.push(entry);
  return rest.slice(Math.max(0, rest.length - max));
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY = /^[A-Z]{2}$/;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function parseEntry(v: unknown): PlayedPhoto | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const e = v as Record<string, unknown>;
  const ok =
    typeof e.id === "string" &&
    e.id.length > 0 &&
    e.id.length <= 64 &&
    finite(e.lng) &&
    e.lng >= -180 &&
    e.lng <= 180 &&
    finite(e.lat) &&
    e.lat >= -90 &&
    e.lat <= 90 &&
    typeof e.place === "string" &&
    e.place.length <= 200 &&
    (e.country === null || (typeof e.country === "string" && COUNTRY.test(e.country))) &&
    (e.km === null || (finite(e.km) && e.km >= 0 && e.km <= 20_100)) &&
    Number.isInteger(e.score) &&
    (e.score as number) >= 0 &&
    (e.score as number) <= MAX_POINTS &&
    typeof e.day === "string" &&
    DAY.test(e.day);
  if (!ok) return null;
  return {
    id: e.id as string,
    lng: e.lng as number,
    lat: e.lat as number,
    place: e.place as string,
    country: e.country as string | null,
    km: e.km as number | null,
    score: e.score as number,
    day: e.day as string,
  };
}

/**
 * Read the stored history back. Anything that is not a list reads as empty; a malformed entry
 * is dropped on its own; a photo listed twice keeps its later entry; the cap still applies.
 */
export function parsePlayed(raw: string | null, max = MAX_PLAYED): PlayedPhoto[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  let out: PlayedPhoto[] = [];
  for (const v of data) {
    const entry = parseEntry(v);
    if (entry) out = addPlayed(out, entry, max);
  }
  return out;
}

export interface CountrySeen {
  code: string;
  photos: number;
}

export interface PlayedSummary {
  photos: number;
  /** Countries with at least one photo, most photos first, then by code. */
  countries: CountrySeen[];
  /** Continents with at least one photo, in `CONTINENTS` order. */
  continents: Continent[];
  /** Photos in each closeness band (no pin counts as far, as on the reveal). */
  bands: Record<Closeness, number>;
}

export function summarizePlayed(history: readonly PlayedPhoto[]): PlayedSummary {
  const byCountry = new Map<string, number>();
  const continents = new Set<Continent>();
  const bands: Record<Closeness, number> = { bullseye: 0, close: 0, near: 0, far: 0 };
  for (const p of history) {
    bands[closenessOf(p.km)] += 1;
    if (!p.country) continue;
    byCountry.set(p.country, (byCountry.get(p.country) ?? 0) + 1);
    const c = continentOf(p.country);
    if (c) continents.add(c);
  }
  const countries = [...byCountry]
    .map(([code, photos]) => ({ code, photos }))
    .sort((a, b) => b.photos - a.photos || a.code.localeCompare(b.code));
  return {
    photos: history.length,
    countries,
    continents: CONTINENTS.filter((c) => continents.has(c)),
    bands,
  };
}

/** The history as GeoJSON points for the map, each tagged with its closeness band. */
export function playedFeatures(history: readonly PlayedPhoto[]) {
  return {
    type: "FeatureCollection" as const,
    features: history.map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      properties: { id: p.id, band: closenessOf(p.km) },
    })),
  };
}

/** Minimal storage surface, so tests can pass a fake (including one that throws). */
export type PlayedStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStore(): PlayedStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadPlayed(store: PlayedStore | null = browserStore()): PlayedPhoto[] {
  if (!store) return [];
  try {
    return parsePlayed(store.getItem(PLAYED_KEY));
  } catch {
    return [];
  }
}

/** Add a played round to the stored history, best effort; returns the new history. */
export function keepOnMap(
  entry: PlayedPhoto,
  store: PlayedStore | null = browserStore(),
): PlayedPhoto[] {
  const next = addPlayed(loadPlayed(store), entry);
  try {
    store?.setItem(PLAYED_KEY, JSON.stringify(next));
  } catch {
    // Quota or privacy mode: the game plays on; this round just won't be on the map.
  }
  return next;
}

/** Forget the map's history in this browser. */
export function forgetPlayed(store: PlayedStore | null = browserStore()): void {
  try {
    store?.removeItem(PLAYED_KEY);
  } catch {
    // Nothing we could reach; the page shows an empty map either way.
  }
}
