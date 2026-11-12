/**
 * Which emoji squares a text share sends. Every share line is built in the classic set (🟩 🟨 🟧
 * 🟥, closest or right first) and `inSquares` swaps it into the player's set at the moment it is
 * sent, so one choice covers every game's share without each game knowing about it.
 *
 * The classic set is colour alone, and 🟩 and 🟥 come out nearly the same without red-green
 * vision. The colour-blind safe set swaps green for blue (🟦 🟨 🟧 🟥): every pair stays apart
 * for protanopia, deuteranopia and tritanopia (squares.test.ts measures them with
 * `lib/colorVision.ts`). The choice is kept in this browser under `whereabout:squares`.
 */
export type SquareSet = "classic" | "contrast";

export const SQUARE_SETS_ORDER: readonly SquareSet[] = ["classic", "contrast"];

export const SQUARES_KEY = "whereabout:squares";

/** Same-tab listeners: the storage event only fires in other tabs. */
export const SQUARES_CHANGED = "whereabout:squares-changed";

/** Each set's squares, closest band (or a right answer) first, in the order of DISTANCE_BANDS. */
export const SQUARE_SETS: Record<SquareSet, readonly [string, string, string, string]> = {
  classic: ["🟩", "🟨", "🟧", "🟥"],
  contrast: ["🟦", "🟨", "🟧", "🟥"],
};

/** The set's name, for the switch and anything that reads it out. */
export const SQUARE_SET_NAME: Record<SquareSet, string> = {
  classic: "Classic",
  contrast: "Colour-blind safe",
};

/**
 * Roughly how each square is filled where it is drawn from Twemoji (the open emoji set used by
 * Discord and others), for the colour-vision checks. Phones draw their own emoji, so these stand
 * in for "a typical rendering", not every one.
 */
export const SQUARE_FILL: Readonly<Record<string, string>> = {
  "🟩": "#78B159",
  "🟨": "#FDCB58",
  "🟧": "#F4900C",
  "🟥": "#DD2E44",
  "🟦": "#55ACEE",
};

/** The text with each classic square swapped for the same square of `set`. */
export function inSquares(text: string, set: SquareSet): string {
  if (set === "classic") return text;
  const to = SQUARE_SETS[set];
  return SQUARE_SETS.classic.reduce((out, square, i) => out.replaceAll(square, to[i]), text);
}

export type SquaresStore = Pick<Storage, "getItem" | "setItem">;

function browserStore(): SquaresStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null; // Touching localStorage itself can throw when storage is blocked.
  }
}

function isSquareSet(value: unknown): value is SquareSet {
  return value === "classic" || value === "contrast";
}

/** The set the player chose, else classic. */
export function readSquares(store: SquaresStore | null = browserStore()): SquareSet {
  try {
    const kept = store?.getItem(SQUARES_KEY);
    if (isSquareSet(kept)) return kept;
  } catch {
    // Blocked storage: classic.
  }
  return "classic";
}

/** The set chosen this visit when storage refused it. */
let sessionSquares: SquareSet | null = null;

/** Remember the choice and tell every preview on the page. Best effort if storage is blocked. */
export function setSquares(set: SquareSet, store: SquaresStore | null = browserStore()): void {
  sessionSquares = null;
  try {
    if (!store) throw new Error("no storage");
    store.setItem(SQUARES_KEY, set);
  } catch {
    // Blocked storage, quota or privacy mode: the change still applies for this visit.
    sessionSquares = set;
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SQUARES_CHANGED));
}

/** The set to share in right now: the choice made this visit, kept, or classic. */
export function currentSquares(): SquareSet {
  return sessionSquares ?? readSquares();
}
