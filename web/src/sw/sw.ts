/**
 * The service worker: it makes the site installable and lets a started game keep going when the
 * connection drops. Built into out/sw.js by scripts/build-sw.mjs after `next build`, which fills
 * in the constants below. The rules it follows live in src/lib/offline/cacheRules.ts.
 */
import {
  CACHE_PREFIX,
  cacheNames,
  classify,
  pageFallback,
  photoStandIn,
  photosToDrop,
} from "@/lib/offline/cacheRules";
import { MAX_KEEP, type KeepMessage } from "@/lib/offline/register";

declare const __BUILD__: string;
declare const __BASE__: string;
declare const __RECORDS_VERSION__: string;
declare const __PRECACHE__: string[];

// The DOM library has no service-worker types; these are the few parts used here.
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  request: Request;
  respondWith(response: Promise<Response>): void;
}
interface ExtendableMessageEvent extends ExtendableEvent {
  data: unknown;
}
interface WorkerScope {
  location: Location;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: "install" | "activate", fn: (e: ExtendableEvent) => void): void;
  addEventListener(type: "fetch", fn: (e: FetchEvent) => void): void;
  addEventListener(type: "message", fn: (e: ExtendableMessageEvent) => void): void;
}
const sw = self as unknown as WorkerScope;

const CACHES = cacheNames(__BUILD__, __RECORDS_VERSION__);
const ORIGIN = sw.location.origin;
const PAGE_PATHS = __PRECACHE__.filter((u) => u.endsWith("/"));

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const [statics, pages] = await Promise.all([caches.open(CACHES.static), caches.open(CACHES.pages)]);
      await Promise.all(
        __PRECACHE__.map(async (url) => {
          const res = await fetch(url, { cache: "reload" });
          if (!res.ok) throw new Error(`precache ${url}: ${res.status}`);
          const kind = classify(new URL(url, ORIGIN), ORIGIN, __BASE__);
          await (kind === "page" ? pages : statics).put(url, res);
        }),
      );
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set(Object.values(CACHES));
      for (const name of await caches.keys()) {
        if (name.startsWith(CACHE_PREFIX) && !keep.has(name)) await caches.delete(name);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const kind = classify(url, ORIGIN, __BASE__);
  if (kind === "pass") return;
  if (kind === "photo") event.respondWith(photo(request));
  else if (kind === "page") event.respondWith(page(request, url));
  else event.respondWith(cacheFirst(request, kind === "record" ? CACHES.records : CACHES.static));
});

// The game hands over its five photos and records as soon as it has dealt them
// (keepForOffline in src/lib/offline/register.ts), so the rest of the game plays offline.
sw.addEventListener("message", (event) => {
  const data = event.data as Partial<KeepMessage> | null;
  if (data?.type !== "keep" || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter((u): u is string => typeof u === "string").slice(0, MAX_KEEP);
  event.waitUntil(
    Promise.all(
      urls.map((u) => {
        const url = new URL(u, ORIGIN);
        const kind = classify(url, ORIGIN, __BASE__);
        if (kind === "photo") return photo(new Request(url.href, { mode: "no-cors" })).catch(() => undefined);
        if (kind === "record") return cacheFirst(new Request(url.href), CACHES.records).catch(() => undefined);
        return undefined;
      }),
    ),
  );
});

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

async function page(request: Request, url: URL): Promise<Response> {
  const cache = await caches.open(CACHES.pages);
  try {
    const res = await fetch(request);
    // Only whole pages are kept for offline use, not Next's per-navigation data requests.
    if (res.ok && request.mode === "navigate" && url.search === "") await cache.put(url.pathname, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === "navigate") {
      const cached = (await cache.keys()).map((r) => new URL(r.url).pathname);
      const fallback = pageFallback(url, __BASE__, [...new Set([...PAGE_PATHS, ...cached])]);
      const shell = fallback ? await cache.match(fallback) : undefined;
      if (shell) return shell;
    }
    throw err;
  }
}

async function photo(request: Request): Promise<Response> {
  const cache = await caches.open(CACHES.photos);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    // Photos are hot-linked without CORS, so their responses are opaque (status 0).
    if (res.ok || res.type === "opaque") {
      await cache.put(request.url, res.clone());
      const keys = (await cache.keys()).map((r) => r.url);
      await Promise.all(photosToDrop(keys).map((u) => cache.delete(u)));
    }
    return res;
  } catch (err) {
    const standIn = photoStandIn(request.url, (await cache.keys()).map((r) => r.url));
    const res = standIn ? await cache.match(standIn) : undefined;
    if (res) return res;
    throw err;
  }
}
