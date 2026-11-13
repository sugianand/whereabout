import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BEST_NORTH_KEY } from "@/lib/game/furtherNorth";
import { rememberNorthDay } from "@/lib/game/northDaily";
import { todayGames } from "@/lib/game/today";

import GamesMenu from "./GamesMenu";

afterEach(() => localStorage.clear());

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "Games" }));
  return screen.getByRole("dialog", { name: "Ways to play" });
}

describe("GamesMenu", () => {
  it("leads to Today, counting the day's games already played", async () => {
    const day = new Date().toISOString().slice(0, 10);
    rememberNorthDay(day, { streak: 2, atlasRight: 0, atlasPlayed: 0, ended: "miss" });
    render(<GamesMenu screen="round" streakHref="/streak" />);
    const link = within(openMenu()).getByRole("link", { name: /^Today/ });
    expect(link).toHaveAttribute("href", "/today");
    expect(link).toHaveTextContent(`1 of ${todayGames(day, []).length} played`);
  });

  it("counts only the games dealt today, not one that joins Today on a later day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      // Which climate? joins Today on 2026-11-14.
      vi.setSystemTime(new Date("2026-11-13T23:30:00Z"));
      const { unmount } = render(<GamesMenu screen="round" streakHref="/streak" />);
      expect(within(openMenu()).getByRole("link", { name: /^Today/ })).toHaveTextContent(
        "10 daily games",
      );
      unmount();
      vi.setSystemTime(new Date("2026-11-14T00:30:00Z"));
      render(<GamesMenu screen="round" streakHref="/streak" />);
      expect(within(openMenu()).getByRole("link", { name: /^Today/ })).toHaveTextContent(
        "11 daily games",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks Today as the current screen when opened from it", () => {
    render(<GamesMenu screen="today" streakHref="/streak" />);
    const sheet = openMenu();
    expect(within(sheet).queryByRole("link", { name: /^Today/ })).toBeNull();
    expect(within(sheet).getByText("You're here")).toBeVisible();
  });

  it("lists every way to play from a quick game, marking the one being played", async () => {
    localStorage.setItem(BEST_NORTH_KEY, "7");
    render(<GamesMenu screen="further-north" streakHref="/streak" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    const sheet = openMenu();

    expect(within(sheet).getByRole("link", { name: /^Five rounds/ })).toHaveAttribute("href", "/");
    // Away from the five-round game, Blitz opens it in Blitz mode.
    expect(within(sheet).getByRole("link", { name: /^Blitz/ })).toHaveAttribute("href", "/?blitz");
    expect(within(sheet).getByRole("link", { name: /^Country Streak/ })).toHaveAttribute(
      "href",
      "/streak",
    );
    expect(within(sheet).getByRole("link", { name: /^Survival/ })).toHaveAttribute(
      "href",
      "/survival",
    );
    expect(within(sheet).getByRole("link", { name: /^Odd one out/ })).toHaveAttribute(
      "href",
      "/odd-one-out",
    );
    expect(within(sheet).getByRole("link", { name: /^How far apart\?/ })).toHaveAttribute(
      "href",
      "/how-far",
    );
    expect(within(sheet).getByRole("link", { name: /^Which way\?/ })).toHaveAttribute(
      "href",
      "/which-way",
    );
    expect(within(sheet).getByRole("link", { name: /^Pass and play/ })).toHaveAttribute(
      "href",
      "/pass-and-play",
    );
    // The screen's own mode is no link to itself, and still shows its best.
    expect(within(sheet).queryByRole("link", { name: /^Further North/ })).toBeNull();
    const here = sheet.querySelector('[aria-current="page"]')!;
    expect(here).toHaveTextContent(/Further North\s*Playing now/);
    expect(await within(sheet).findByText("Best: 7 in a row")).toBeVisible();
  });

  it("on a five-round game starts Blitz itself and closes, and marks the game of five", () => {
    const onPlayBlitz = vi.fn();
    render(<GamesMenu screen="round" onPlayBlitz={onPlayBlitz} streakHref="/streak?region=asia" />);
    const sheet = openMenu();
    expect(sheet.querySelector('[aria-current="page"]')).toHaveTextContent(/Five rounds/);
    expect(within(sheet).getByRole("link", { name: /^Country Streak/ })).toHaveAttribute(
      "href",
      "/streak?region=asia",
    );
    fireEvent.click(within(sheet).getByRole("button", { name: /^Blitz/ }));
    expect(onPlayBlitz).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("from a Blitz deals an untimed game of five on the spot", () => {
    const onPlayRound = vi.fn();
    render(<GamesMenu screen="blitz" onPlayBlitz={() => {}} onPlayRound={onPlayRound} />);
    const sheet = openMenu();
    expect(within(sheet).queryByRole("button", { name: /^Blitz/ })).toBeNull();
    expect(sheet.querySelector('[aria-current="page"]')).toHaveTextContent(/Blitz\s*Playing now/);
    fireEvent.click(within(sheet).getByRole("button", { name: /^Five rounds/ }));
    expect(onPlayRound).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves out what this build can't play", () => {
    render(<GamesMenu screen="round" blitz={false} />);
    const sheet = openMenu();
    expect(within(sheet).queryByText("Blitz")).toBeNull();
    expect(within(sheet).queryByText("Country Streak")).toBeNull();
    expect(within(sheet).getByRole("link", { name: /^Survival/ })).toBeVisible();
  });

  it("holds focus and keys inside the sheet, and Esc gives focus back", () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    render(<GamesMenu screen="survival" streakHref="/streak" />);
    const button = screen.getByRole("button", { name: "Games" });
    button.focus();
    const sheet = openMenu();
    const close = within(sheet).getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "true");

    // Shift+Tab from the first control wraps to the last, and Tab from there back to the first.
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    const last = within(sheet).getByRole("button", { name: "Dark" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: "1" });
    expect(onWindowKey).not.toHaveBeenCalled();
    fireEvent.keyDown(close, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveFocus();
    window.removeEventListener("keydown", onWindowKey);
  });

  it("opens on the page's body, outside the night-chart stage, with the Colours switch", () => {
    render(
      <div className="wb-stage" data-testid="stage">
        <GamesMenu screen="round" streakHref="/streak" />
      </div>,
    );
    const sheet = openMenu();
    expect(screen.getByTestId("stage")).not.toContainElement(sheet);
    const colours = within(sheet).getByRole("group", { name: "Colours" });
    fireEvent.click(within(colours).getByRole("button", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    fireEvent.click(within(colours).getByRole("button", { name: "Auto" }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("closes on a tap outside the sheet", () => {
    render(<GamesMenu screen="odd-one-out" />);
    const sheet = openMenu();
    fireEvent.pointerDown(sheet.parentElement!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
