/**
 * Every control of each screen, as the help sheet lists it (`ControlsHelp`): what it does, the
 * keys that do it on a keyboard, and the click or gesture that does it with a mouse or a finger.
 *
 * The lists are the single source for the sheet and for the e2e check that presses every key
 * listed, so a key only appears here once it works (e2e/help.spec.ts).
 */

import { POINTS, POINT_KEYS } from "@/lib/game/whichWay";

/** One key as shown (`label`) and as a test presses it (`press`, a Playwright key name). */
export type Key = { label: string; press: string };

export type Control = {
  /** Stable id, so tests can check each control by name. */
  id: string;
  does: string;
  /** Alternatives: any one of these keys does it. Empty when only a click or tap can. */
  keys: readonly Key[];
  mouse: string;
  touch: string;
};

export type ControlGroup = {
  title: string;
  /** Where keyboard focus has to be for the group's keys, when it isn't anywhere. */
  focus?: string;
  controls: readonly Control[];
};

export type HelpScreen =
  | "round"
  | "further-north"
  | "odd-one-out"
  | "how-far"
  | "which-way"
  | "hot-cold"
  | "name-country"
  | "line-up"
  | "close-up"
  | "left-right"
  | "which-climate"
  | "clue-mix";

const k = (label: string, press = label): Key => ({ label, press });

const PLUS = k("+");
const MINUS = k("−", "-");
const ARROWS = [k("←", "ArrowLeft"), k("→", "ArrowRight"), k("↑", "ArrowUp"), k("↓", "ArrowDown")];

const HELP: Control = {
  id: "help",
  does: "Open this list of controls",
  keys: [k("?")],
  mouse: "The ? button",
  touch: "The ? button",
};

/** Keys that work wherever focus is, as long as it isn't in a text field (`isTypingTarget`). */
export const ROUND_KEYS = { hint: "h", guess: "g" } as const;

const PHOTO_CONTROLS: ControlGroup = {
  title: "The photo",
  focus: "Tab to the photo first",
  controls: [
    {
      id: "photo-zoom",
      does: "Zoom in and out",
      keys: [PLUS, MINUS],
      mouse: "Click the photo, or scroll",
      touch: "Tap the photo, or pinch",
    },
    {
      id: "photo-pan",
      does: "Look around a zoomed photo",
      keys: ARROWS,
      mouse: "Drag",
      touch: "Drag",
    },
    {
      id: "photo-reset",
      does: "Back to the whole photo",
      keys: [k("0"), k("Esc", "Escape")],
      mouse: "Click again",
      touch: "Tap again",
    },
  ],
};

const GLOBE_CONTROLS: ControlGroup = {
  title: "The globe",
  focus: "Tab to the globe first",
  controls: [
    {
      id: "globe-pin",
      does: "Drop your pin",
      keys: [k("Enter")],
      mouse: "Click the globe",
      touch: "Tap the globe",
    },
    {
      id: "globe-move",
      does: "Move your pin (hold Shift for bigger steps)",
      keys: ARROWS,
      mouse: "Click somewhere else",
      touch: "Tap somewhere else",
    },
    {
      id: "globe-zoom",
      does: "Zoom the globe",
      keys: [PLUS, MINUS],
      mouse: "Scroll, or the + and − buttons",
      touch: "Pinch, or the + and − buttons",
    },
    {
      id: "globe-spin",
      does: "Spin the globe",
      keys: [],
      mouse: "Drag",
      touch: "Drag with one finger",
    },
  ],
};

export const CONTROLS: Record<HelpScreen, readonly ControlGroup[]> = {
  round: [
    PHOTO_CONTROLS,
    GLOBE_CONTROLS,
    {
      title: "The round",
      controls: [
        {
          id: "round-hint",
          does: "Take a hint (the round is then worth less)",
          keys: [k("H", ROUND_KEYS.hint)],
          mouse: "The Hint button",
          touch: "The Hint button",
        },
        {
          id: "round-guess",
          does: "Guess where your pin is",
          keys: [k("G", ROUND_KEYS.guess)],
          mouse: "Guess here",
          touch: "Guess here",
        },
        {
          id: "round-next",
          does: "Next photo, from the answer",
          keys: [k("Enter")],
          mouse: "Next photo",
          touch: "Next photo",
        },
        HELP,
      ],
    },
  ],
  "further-north": [
    {
      title: "Further North",
      controls: [
        {
          id: "pick",
          does: "Pick the photo taken further north",
          keys: [k("1"), k("2")],
          mouse: "Click a photo",
          touch: "Tap a photo",
        },
        {
          id: "next",
          does: "Next pair, from the answer",
          keys: [k("Enter")],
          mouse: "Next pair",
          touch: "Next pair",
        },
        HELP,
      ],
    },
  ],
  "odd-one-out": [
    {
      title: "Odd one out",
      controls: [
        {
          id: "pick",
          does: "Pick the photo from another continent",
          keys: [k("1"), k("2"), k("3"), k("4")],
          mouse: "Click a photo",
          touch: "Tap a photo",
        },
        {
          id: "next",
          does: "Next four, from the answer",
          keys: [k("Enter")],
          mouse: "Next four",
          touch: "Next four",
        },
        HELP,
      ],
    },
  ],
  "how-far": [
    {
      title: "The slider",
      focus: "Tab to the slider first",
      controls: [
        {
          id: "distance",
          does: "Set how far apart the photos were taken",
          keys: [k("←", "ArrowLeft"), k("→", "ArrowRight")],
          mouse: "Drag the slider",
          touch: "Drag the slider",
        },
        {
          id: "lock",
          does: "Lock in your estimate",
          keys: [k("Enter")],
          mouse: "Lock it in",
          touch: "Lock it in",
        },
      ],
    },
    {
      title: "The answer",
      controls: [
        {
          id: "next",
          does: "Next pair, from the answer",
          keys: [k("Enter")],
          mouse: "Next pair",
          touch: "Next pair",
        },
        HELP,
      ],
    },
  ],
  "which-way": [
    {
      title: "Which way?",
      controls: [
        {
          id: "pick",
          does: "Pick the way from photo 1 to photo 2 (keys laid out like a number pad: 8 is north)",
          keys: POINTS.map((p) => k(POINT_KEYS[p])),
          mouse: "Click a compass point",
          touch: "Tap a compass point",
        },
        {
          id: "next",
          does: "Travel on, from the answer",
          keys: [k("Enter")],
          mouse: "Travel on",
          touch: "Travel on",
        },
        HELP,
      ],
    },
  ],
  "hot-cold": [
    PHOTO_CONTROLS,
    GLOBE_CONTROLS,
    {
      title: "The photo's pins",
      controls: [
        {
          id: "drop",
          does: "Drop this pin: a miss says how far off it was and which way to head",
          keys: [k("G", ROUND_KEYS.guess)],
          mouse: "Drop pin",
          touch: "Drop pin",
        },
        {
          id: "next",
          does: "Next photo, from the answer",
          keys: [k("Enter")],
          mouse: "Next photo",
          touch: "Next photo",
        },
        HELP,
      ],
    },
  ],
  "name-country": [
    PHOTO_CONTROLS,
    {
      title: "The names",
      controls: [
        {
          id: "pick",
          does: "Name the country",
          keys: [k("1"), k("2"), k("3"), k("4")],
          mouse: "Click a name",
          touch: "Tap a name",
        },
        {
          id: "next",
          does: "Next photo, from the answer",
          keys: [k("Enter")],
          mouse: "Next photo",
          touch: "Next photo",
        },
        HELP,
      ],
    },
  ],
  "line-up": [
    {
      title: "The row",
      controls: [
        {
          id: "pick",
          does: "Pick a place up, then put it on another to swap the two",
          keys: [k("1"), k("2"), k("3"), k("4")],
          mouse: "Click two photos, or drag one",
          touch: "Tap two photos, or drag one",
        },
        {
          id: "drop",
          does: "Put the picked place back down",
          keys: [k("Esc", "Escape")],
          mouse: "Click it again",
          touch: "Tap it again",
        },
        {
          id: "next",
          does: "Lock the row in, then go to the next",
          keys: [k("Enter")],
          mouse: "Lock it in, Next row",
          touch: "Lock it in, Next row",
        },
        HELP,
      ],
    },
  ],
  "close-up": [
    {
      title: "The names",
      controls: [
        {
          id: "pick",
          does: "Name the country",
          keys: [k("1"), k("2"), k("3"), k("4")],
          mouse: "Click a name",
          touch: "Tap a name",
        },
        {
          id: "next",
          does: "Next photo, from the answer",
          keys: [k("Enter")],
          mouse: "Next photo",
          touch: "Next photo",
        },
        HELP,
      ],
    },
  ],
  "left-right": [
    {
      title: "The call",
      controls: [
        {
          id: "pick",
          does: "Call the side of the road they drive on",
          keys: [k("←", "ArrowLeft"), k("→", "ArrowRight")],
          mouse: "Click Left or Right, or drag the photo to a side",
          touch: "Tap Left or Right, or swipe the photo to a side",
        },
        {
          id: "next",
          does: "Next photo, from the answer",
          keys: [k("Enter")],
          mouse: "Next photo",
          touch: "Next photo",
        },
        HELP,
      ],
    },
  ],
  "which-climate": [
    {
      title: "The climates",
      controls: [
        {
          id: "pick",
          does: "Name the climate: tropical, arid, temperate, continental or polar",
          keys: [k("1"), k("2"), k("3"), k("4"), k("5")],
          mouse: "Click a climate",
          touch: "Tap a climate",
        },
        {
          id: "next",
          does: "Next photo, from the answer",
          keys: [k("Enter")],
          mouse: "Next photo",
          touch: "Next photo",
        },
        HELP,
      ],
    },
  ],
  "clue-mix": [
    {
      title: "The clues",
      controls: [
        {
          id: "pick-road",
          does: "Call the side of the road, when a photo asks it",
          keys: [k("←", "ArrowLeft"), k("→", "ArrowRight")],
          mouse: "Click Left or Right",
          touch: "Tap Left or Right",
        },
        {
          id: "pick",
          does: "Name the climate or the continent, by its number, when a photo asks it",
          keys: [k("1"), k("2"), k("3"), k("4"), k("5"), k("6"), k("7")],
          mouse: "Click a climate or a continent",
          touch: "Tap a climate or a continent",
        },
        {
          id: "next",
          does: "Next photo, from the answer",
          keys: [k("Enter")],
          mouse: "Next photo",
          touch: "Next photo",
        },
        HELP,
      ],
    },
  ],
};

/** The sheet's title for each screen. */
export const SCREEN_TITLES: Record<HelpScreen, string> = {
  round: "Controls for a round",
  "further-north": "Controls for Further North",
  "odd-one-out": "Controls for Odd one out",
  "how-far": "Controls for How far apart?",
  "which-way": "Controls for Which way?",
  "hot-cold": "Controls for Hot and cold",
  "name-country": "Controls for Name the country",
  "line-up": "Controls for Line them up",
  "close-up": "Controls for Close-up",
  "left-right": "Controls for Left or right?",
  "which-climate": "Controls for Which climate?",
  "clue-mix": "Controls for Clue mix",
};

/**
 * True when a key press is going into something the player types or chooses in. A slider only
 * takes arrow and paging keys, so a shortcut like `?` still works while it has focus.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  return !!el.closest("input:not([type='range']), textarea, select, [contenteditable='true']");
}

/** True for a bare key press (no Ctrl, Alt or Cmd) that isn't typing into a field. */
export function isShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat) return false;
  if (event.ctrlKey || event.altKey || event.metaKey) return false;
  return !isTypingTarget(event.target);
}
