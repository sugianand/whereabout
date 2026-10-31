import { describe, expect, it } from "vitest";

import {
  CONTROLS,
  ROUND_KEYS,
  SCREEN_TITLES,
  isShortcut,
  isTypingTarget,
  type HelpScreen,
} from "./controls";

const SCREENS = Object.keys(CONTROLS) as HelpScreen[];

function press(key: string, init: KeyboardEventInit = {}, target?: Element) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  let seen: KeyboardEvent | null = null;
  const node = target ?? document.body;
  node.addEventListener("keydown", (e) => (seen = e as KeyboardEvent), { once: true });
  node.dispatchEvent(event);
  return seen! as KeyboardEvent;
}

describe("CONTROLS", () => {
  it("gives every screen a title, a help row and unique control ids", () => {
    for (const screen of SCREENS) {
      expect(SCREEN_TITLES[screen]).toBeTruthy();
      const ids = CONTROLS[screen].flatMap((g) => g.controls.map((c) => c.id));
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain("help");
    }
  });

  it("says how to do every control with a mouse and a finger", () => {
    for (const screen of SCREENS) {
      for (const control of CONTROLS[screen].flatMap((g) => g.controls)) {
        expect(control.does, control.id).toBeTruthy();
        expect(control.mouse, control.id).toBeTruthy();
        expect(control.touch, control.id).toBeTruthy();
        for (const key of control.keys) {
          expect(key.label).toBeTruthy();
          expect(key.press).toBeTruthy();
        }
      }
    }
  });

  it("lists the round's own shortcuts", () => {
    const keys = CONTROLS.round
      .flatMap((g) => g.controls)
      .flatMap((c) => c.keys.map((k) => k.press));
    expect(keys).toContain(ROUND_KEYS.hint);
    expect(keys).toContain(ROUND_KEYS.guess);
  });

  it("lists a pick key for every photo of the quick games", () => {
    const picks = (screen: HelpScreen) =>
      CONTROLS[screen]
        .flatMap((g) => g.controls)
        .find((c) => c.id === "pick")!
        .keys.map((k) => k.press);
    expect(picks("further-north")).toEqual(["1", "2"]);
    expect(picks("odd-one-out")).toEqual(["1", "2", "3", "4"]);
  });
});

describe("isShortcut", () => {
  it("takes a bare key press, with or without Shift", () => {
    expect(isShortcut(press("h"))).toBe(true);
    expect(isShortcut(press("?", { shiftKey: true }))).toBe(true);
  });

  it("leaves browser and system shortcuts alone", () => {
    expect(isShortcut(press("h", { ctrlKey: true }))).toBe(false);
    expect(isShortcut(press("h", { metaKey: true }))).toBe(false);
    expect(isShortcut(press("h", { altKey: true }))).toBe(false);
  });

  it("ignores a held-down key and one already handled", () => {
    expect(isShortcut(press("g", { repeat: true }))).toBe(false);
    const handled = new KeyboardEvent("keydown", { key: "g", cancelable: true });
    handled.preventDefault();
    expect(isShortcut(handled)).toBe(false);
  });

  it("never fires while the player types or chooses in a field", () => {
    for (const tag of ["input", "textarea", "select"]) {
      const field = document.createElement(tag);
      document.body.append(field);
      expect(isTypingTarget(field)).toBe(true);
      expect(isShortcut(press("g", {}, field))).toBe(false);
      field.remove();
    }
    const button = document.createElement("button");
    document.body.append(button);
    expect(isShortcut(press("g", {}, button))).toBe(true);
    button.remove();
    expect(isTypingTarget(null)).toBe(false);
  });

  it("still fires on a slider, which takes only arrow and paging keys", () => {
    const slider = document.createElement("input");
    slider.type = "range";
    document.body.append(slider);
    expect(isTypingTarget(slider)).toBe(false);
    expect(isShortcut(press("?", { shiftKey: true }, slider))).toBe(true);
    slider.remove();
  });
});
