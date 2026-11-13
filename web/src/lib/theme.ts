/**
 * Light or dark: the site follows the system's setting unless the player picks one, and the pick
 * is kept in this browser under `whereabout:theme`.
 *
 * The colours themselves are CSS variables (globals.css): the night chart is the default set, and
 * a daylight set replaces it when `<html data-theme="light">` is set, or when the system asks for
 * light and no theme is set. The globe and everything drawn over it or over a photo keeps the
 * night chart in both (`.wb-night` in globals.css), because MapLibre paints the sea and land in
 * literal colours and words over a photo need a dark scrim.
 *
 * `THEME_SCRIPT` runs in the page's <head> before anything paints, so a kept choice never flashes
 * the other theme first; it also follows a choice made in another tab.
 */
export type ThemeChoice = "system" | "light" | "dark";

export const THEME_ORDER: readonly ThemeChoice[] = ["system", "light", "dark"];

export const THEME_NAME: Record<ThemeChoice, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};

export const THEME_KEY = "whereabout:theme";

/** Same-tab listeners: the storage event only fires in other tabs. */
export const THEME_CHANGED = "whereabout:theme-changed";

/** The browser bar's colour in each theme: each set's page background (`ocean`). */
export const THEME_COLOR = { light: "#e9f0ee", dark: "#0d3346" } as const;

export type ThemeStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStore(): ThemeStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // Touching localStorage itself can throw when storage is blocked.
  }
}

function isExplicit(value: unknown): value is "light" | "dark" {
  return value === "light" || value === "dark";
}

/** The theme the player picked, else following the system. */
export function readTheme(store: ThemeStore | null = browserStore()): ThemeChoice {
  try {
    const kept = store?.getItem(THEME_KEY);
    if (isExplicit(kept)) return kept;
  } catch {
    // Blocked storage: follow the system.
  }
  return "system";
}

/** The choice made this visit when storage refused it. */
let sessionTheme: ThemeChoice | null = null;

/** The theme to show right now: the choice made this visit, kept, or the system's. */
export function currentTheme(): ThemeChoice {
  return sessionTheme ?? readTheme();
}

/**
 * Put a choice on the page: `data-theme` for an explicit pick (none to follow the system), and
 * the browser bar's colour to match. The <meta name="theme-color"> tags carry a media query each,
 * so following the system puts each back to its own scheme's colour.
 */
export function applyTheme(choice: ThemeChoice, doc: Document = document): void {
  const root = doc.documentElement;
  if (isExplicit(choice)) root.dataset.theme = choice;
  else delete root.dataset.theme;
  doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const own = /light/.test(meta.media) ? THEME_COLOR.light : THEME_COLOR.dark;
    meta.content = isExplicit(choice) ? THEME_COLOR[choice] : own;
  });
}

/** Remember the choice, apply it and tell every switch on the page. Best effort if storage is blocked. */
export function setTheme(choice: ThemeChoice, store: ThemeStore | null = browserStore()): void {
  sessionTheme = null;
  try {
    if (!store) throw new Error("no storage");
    if (choice === "system") store.removeItem(THEME_KEY);
    else store.setItem(THEME_KEY, choice);
  } catch {
    // Blocked storage, quota or privacy mode: the change still applies for this visit.
    sessionTheme = choice;
  }
  if (typeof document !== "undefined") applyTheme(choice);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(THEME_CHANGED));
}

/**
 * The inline <head> script: applies the kept choice before the first paint and follows another
 * tab's choice. It must stay self-contained (no imports), and mirrors `applyTheme`; theme.test.ts
 * runs it against the same cases.
 */
export const THEME_SCRIPT = `(function(){var K=${JSON.stringify(THEME_KEY)},C=${JSON.stringify(
  THEME_COLOR,
)};function apply(){var t=null;try{t=localStorage.getItem(K)}catch(e){}var x=t==="light"||t==="dark";var r=document.documentElement;if(x)r.setAttribute("data-theme",t);else r.removeAttribute("data-theme");var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++){m[i].setAttribute("content",x?C[t]:/light/.test(m[i].media)?C.light:C.dark)}}apply();document.addEventListener("DOMContentLoaded",apply);window.addEventListener("storage",function(e){if(e.key===K||e.key===null){apply();window.dispatchEvent(new Event(${JSON.stringify(
  THEME_CHANGED,
)}))}})})();`;
