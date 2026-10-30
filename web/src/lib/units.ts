/**
 * Kilometres or miles for every distance a player reads: the reveal, the results, the map and
 * the share picture. The first visit follows the browser's language region (miles where road
 * signs use them), and a tap on a distance flips it, remembered in this browser under
 * `whereabout:units`. Scoring, bands and everything stored stay in kilometres; only the words
 * change. The Atlas research page keeps kilometres, the unit its benchmarks are reported in.
 */
export type Units = "km" | "mi";

export const UNITS_KEY = "whereabout:units";
export const KM_PER_MILE = 1.609344;

/** Regions whose road signs give distances in miles: the US and its territories, the UK, Liberia, Myanmar. */
const MILES_REGIONS: ReadonlySet<string> = new Set([
  "US",
  "PR",
  "GU",
  "VI",
  "AS",
  "MP",
  "UM",
  "GB",
  "LR",
  "MM",
]);

/** Same-tab listeners: the storage event only fires in other tabs. */
export const UNITS_CHANGED = "whereabout:units-changed";

export type UnitsStore = Pick<Storage, "getItem" | "setItem">;

function browserStore(): UnitsStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // Touching localStorage itself can throw when storage is blocked.
  }
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language ?? ""];
}

/**
 * Miles when the first language that names a region names a miles region ("en-US", "en-GB"),
 * kilometres otherwise, including for a language with no region at all ("en").
 */
export function defaultUnits(languages: readonly string[]): Units {
  for (const tag of languages) {
    let region: string | undefined;
    try {
      region = new Intl.Locale(tag).region;
    } catch {
      continue; // Not a language tag.
    }
    if (region) return MILES_REGIONS.has(region.toUpperCase()) ? "mi" : "km";
  }
  return "km";
}

/** The player's choice if they made one, else the default for their language. */
export function readUnits(
  store: UnitsStore | null = browserStore(),
  languages: readonly string[] = browserLanguages(),
): Units {
  try {
    const kept = store?.getItem(UNITS_KEY);
    if (kept === "km" || kept === "mi") return kept;
  } catch {
    // Blocked storage: fall back to the language default.
  }
  return defaultUnits(languages);
}

/** The unit chosen this visit when storage refused it. */
let sessionUnits: Units | null = null;

/** Remember the choice and tell every distance on the page. Best effort if storage is blocked. */
export function setUnits(units: Units, store: UnitsStore | null = browserStore()): void {
  sessionUnits = null;
  try {
    if (!store) throw new Error("no storage");
    store.setItem(UNITS_KEY, units);
  } catch {
    // Blocked storage, quota or privacy mode: the change still applies for this visit.
    sessionUnits = units;
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(UNITS_CHANGED));
}

/** The units to show right now: the choice made this visit, kept, or the language default. */
export function currentUnits(): Units {
  return sessionUnits ?? readUnits();
}

/** The unit's name for a button that switches to it. */
export function unitsName(units: Units): string {
  return units === "km" ? "kilometres" : "miles";
}
