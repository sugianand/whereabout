/**
 * What the service worker (src/sw/sw.ts) keeps, and how it answers each request, as pure
 * functions so the rules are unit-tested without a browser. The worker itself only wires these
 * to the Cache API.
 *
 * Four kinds of request:
 *   - "static": the build's hashed scripts and styles, the MapLibre worker, icons. They never
 *     change under the same URL, so the cache answers first and the network only fills it.
 *   - "record": a photo's game record (game-data/<version>/<id>.json); versioned the same way.
 *   - "page": the HTML pages and everything else of the site. The network answers first so a
 *     new build shows up at once; the cache answers when the network does not.
 *   - "photo": a Wikimedia photo. Cache first; offline, any size of the same photo will do.
 * Anything else (other sites, Pocket Atlas's 3 MB index and model) passes straight through.
 */

export const CACHE_PREFIX = "whereabout-";
/** Photos are kept across builds; the oldest go once there are more than this many. */
export const MAX_PHOTOS = 60;

export const cacheNames = (build: string, recordsVersion: string) => ({
  static: `${CACHE_PREFIX}static-${build}`,
  pages: `${CACHE_PREFIX}pages-${build}`,
  records: `${CACHE_PREFIX}records-${recordsVersion}`,
  photos: `${CACHE_PREFIX}photos`,
});

export type RequestKind = "static" | "record" | "page" | "photo" | "pass";

/** `base` is the site's path prefix ("/whereabout" on GitHub Pages, "" elsewhere). */
export function classify(url: URL, origin: string, base: string): RequestKind {
  if (url.origin !== origin) return photoKey(url.href) ? "photo" : "pass";
  const prefix = base.replace(/\/$/, "");
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return "pass";
  const path = url.pathname.slice(prefix.length) || "/";
  if (path === "/sw.js" || path.startsWith("/pocket-atlas/")) return "pass";
  if (path.startsWith("/game-data/")) return "record";
  if (
    path.startsWith("/_next/static/") ||
    path.startsWith("/vendor/") ||
    path.startsWith("/icons/") ||
    path === "/icon.svg" ||
    path === "/apple-icon.png" ||
    path === "/manifest.webmanifest"
  ) {
    return "static";
  }
  return "page";
}

const COMMONS = /^https:\/\/(?:thumb|upload)\.wikimedia\.org\/wikipedia\/commons\//;
const THUMB = /^thumb\/([0-9a-f]\/[0-9a-f]{2}\/[^/]+)\/(\d+)px-[^/]+$/;
const ORIGINAL = /^([0-9a-f]\/[0-9a-f]{2}\/[^/]+)$/;

/**
 * The file a Wikimedia photo URL shows, whatever its size ("a/ab/Name.jpg"), or null for any
 * other URL. Two URLs with the same key are the same photo at different widths.
 */
export function photoKey(href: string): string | null {
  const m = COMMONS.exec(href);
  if (!m) return null;
  const rest = href.slice(m[0].length).split(/[?#]/)[0];
  return THUMB.exec(rest)?.[1] ?? ORIGINAL.exec(rest)?.[1] ?? null;
}

/** The pixel width a Wikimedia URL asks for: its thumbnail width, or Infinity for an original. */
export function photoWidth(href: string): number {
  const m = /\/(\d+)px-[^/]*$/.exec(href.split(/[?#]/)[0]);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

/**
 * Offline, the cached copy to show for a photo nobody cached at this size: the widest cached
 * copy of the same file (a sharper photo than asked for is better than none). Null if none.
 */
export function photoStandIn(wanted: string, cached: readonly string[]): string | null {
  const key = photoKey(wanted);
  if (!key) return null;
  let best: string | null = null;
  for (const href of cached) {
    if (photoKey(href) !== key) continue;
    if (best === null || photoWidth(href) > photoWidth(best)) best = href;
  }
  return best;
}

/** The oldest cached photos to drop so at most `max` remain (`cached` in insertion order). */
export function photosToDrop(cached: readonly string[], max: number = MAX_PHOTOS): string[] {
  return cached.slice(0, Math.max(0, cached.length - max));
}

/**
 * Offline, the cached page to show for a navigation: the same page whatever its query
 * (`?daily`, `?region=europe` are read by the page itself), else the home page, which can start
 * any game. `pages` are the cached page URLs' paths.
 */
export function pageFallback(url: URL, base: string, pages: readonly string[]): string | null {
  const prefix = base.replace(/\/$/, "");
  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
  if (pages.includes(path)) return path;
  const home = `${prefix}/`;
  return pages.includes(home) ? home : null;
}

/** What a page's HTML loads that belongs in the app shell (icons carry a cache-busting query). */
const SHELL_REFS = ["/_next/static/", "/icon.svg", "/apple-icon.png"];

/**
 * What to fetch when the worker installs, from the exported site: each page (as its directory
 * URL) and the scripts, styles and fonts its HTML loads. `htmlByPage` maps a page path such as
 * "/streak/" to that page's HTML; `extra` are further site paths (icons, the MapLibre worker).
 */
export function precacheList(
  htmlByPage: Record<string, string>,
  base: string,
  extra: readonly string[] = [],
): string[] {
  const prefix = base.replace(/\/$/, "");
  const urls = new Set<string>();
  for (const [page, html] of Object.entries(htmlByPage)) {
    urls.add(`${prefix}${page}`);
    for (const m of html.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
      const ref = m[1].replace(/&amp;/g, "&");
      if (SHELL_REFS.some((p) => ref.startsWith(`${prefix}${p}`))) urls.add(ref.split("#")[0]);
    }
  }
  for (const path of extra) urls.add(`${prefix}${path}`);
  return [...urls].sort();
}
