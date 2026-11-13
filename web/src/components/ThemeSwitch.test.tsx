import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { THEME_CHANGED, THEME_KEY, setTheme } from "@/lib/theme";

import ThemeSwitch from "./ThemeSwitch";

afterEach(() => {
  act(() => setTheme("system"));
  localStorage.clear();
});

describe("ThemeSwitch", () => {
  it("starts on Auto, switches the page at once and keeps the choice", () => {
    render(
      <>
        <ThemeSwitch />
        <ThemeSwitch />
      </>,
    );
    const [auto, light] = [
      screen.getAllByRole("button", { name: "Auto" })[0],
      screen.getAllByRole("button", { name: "Light" })[0],
    ];
    expect(auto).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(light);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    // Every switch on the page follows.
    for (const b of screen.getAllByRole("button", { name: "Light" })) {
      expect(b).toHaveAttribute("aria-pressed", "true");
    }

    fireEvent.click(screen.getAllByRole("button", { name: "Dark" })[1]);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(auto).toHaveAttribute("aria-pressed", "false");
  });

  it("follows a choice another tab made, once the head script has applied it", () => {
    render(<ThemeSwitch />);
    act(() => {
      localStorage.setItem(THEME_KEY, "dark");
      window.dispatchEvent(new Event(THEME_CHANGED));
    });
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  });
});
