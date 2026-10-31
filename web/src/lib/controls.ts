/**
 * Every control of each screen, as the help sheet lists it (`ControlsHelp`): what it does, the
 * keys that do it on a keyboard, and the click or gesture that does it with a mouse or a finger.
 *
 * The lists are the single source for the sheet and for the e2e check that presses every key
 * listed, so a key only appears here once it works (e2e/help.spec.ts).
 */

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

export type HelpScreen = "round" | "further-north" | "odd-one-out" | "how-far";

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

export const CONTROLS: Record<HelpScreen, readonly ControlGroup[]> = {
  round: [
    {
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
    },
    {
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
    },
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
};

/** The sheet's title for each screen. */
export const SCREEN_TITLES: Record<HelpScreen, string> = {
  round: "Controls for a round",
  "further-north": "Controls for Further North",
  "odd-one-out": "Controls for Odd one out",
  "how-far": "Controls for How far apart?",
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
