/**
 * The first-visit card: "Guess where this was taken. Atlas, our AI, is guessing too. Beat it."
 *
 * It shows once per browser, over the first photo, and goes away on the player's first tap on
 * the photo or the globe. Whether it has been seen lives in localStorage, best effort: when
 * storage is blocked or throws (private windows, sandboxed iframes, a full quota) the card simply
 * shows on each visit and the game plays exactly the same.
 */

export const INTRO_KEY = "whereabout:intro-seen";

export const INTRO_TEXT = {
  title: "Guess where this was taken.",
  body: "Atlas, our AI, is guessing too. Beat it.",
} as const;

/** Minimal storage surface, so tests can pass a fake (including one that throws). */
export type IntroStore = Pick<Storage, "getItem" | "setItem">;

function browserStore(): IntroStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // Touching localStorage itself can throw when storage is blocked.
  }
}

/** True when this browser has already dismissed the card. Unknown counts as not seen. */
export function hasSeenIntro(store: IntroStore | null = browserStore()): boolean {
  if (!store) return false;
  try {
    return store.getItem(INTRO_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remember that the card was dismissed, so it never comes back in this browser. */
export function markIntroSeen(store: IntroStore | null = browserStore()): void {
  if (!store) return;
  try {
    store.setItem(INTRO_KEY, "1");
  } catch {
    // Quota or privacy mode: the card will show again next visit, nothing else changes.
  }
}
