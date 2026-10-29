/**
 * The page's side of the service worker (src/sw/sw.ts): register it, and hand it the photos and
 * records a game has dealt so all five are on the device before the player needs them. Both are best
 * effort: without service workers (old browsers, private modes, `next dev`) the game plays as
 * it always has, online.
 */

import { placeholderUrl, sources } from "@/lib/photoSources";

export interface KeepMessage {
  type: "keep";
  /** Wikimedia photo URLs and the site's own game-record paths. */
  urls: string[];
}

/** The most URLs one message may ask the worker to keep: a game's five photos, blurs and records. */
export const MAX_KEEP = 15;

function container(): ServiceWorkerContainer | null {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker;
}

/** Where the built worker is served, and the part of the site it looks after. */
export function workerUrl(basePath: string = process.env.NEXT_PUBLIC_BASE_PATH ?? ""): {
  script: string;
  scope: string;
} {
  const prefix = basePath.replace(/\/$/, "");
  return { script: `${prefix}/sw.js`, scope: `${prefix}/` };
}

/** Registers the worker once the page has loaded, so it never competes with the first photo. */
export function registerServiceWorker(): void {
  const sw = container();
  if (!sw || process.env.NODE_ENV !== "production") return;
  const { script, scope } = workerUrl();
  const go = () => {
    sw.register(script, { scope }).catch(() => {});
  };
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}

/** Asks the worker to keep these photos and records on the device (no-op without one). */
export function keepForOffline(urls: readonly string[]): void {
  const sw = container();
  if (!sw || urls.length === 0) return;
  const message: KeepMessage = { type: "keep", urls: [...new Set(urls)].slice(0, MAX_KEEP) };
  sw.ready.then((reg) => reg.active?.postMessage(message)).catch(() => {});
}

/**
 * The copies of a game's photos to keep: the size the photo frame asks for first and the tiny
 * blurred stand-in. Offline, the worker shows the kept size whatever width the screen wants.
 */
export function photoUrlsToKeep(photos: readonly { imageUrl: string; width?: number }[]): string[] {
  return photos.flatMap((p) => {
    const blur = placeholderUrl(p.imageUrl);
    return blur ? [sources(p).src, blur] : [sources(p).src];
  });
}
