import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BLITZ_BEST_KEY } from "@/lib/game/blitz";
import { BEST_NORTH_KEY } from "@/lib/game/furtherNorth";
import { bestStreakKey } from "@/lib/game/streak";

import QuickGames from "./QuickGames";

afterEach(() => localStorage.clear());

describe("QuickGames", () => {
  it("shows each mode's best beside its name once the page is in the browser", async () => {
    localStorage.setItem(BLITZ_BEST_KEY, "12000");
    localStorage.setItem(BEST_NORTH_KEY, "5");
    localStorage.setItem(bestStreakKey("africa"), "4");
    render(<QuickGames onPlayBlitz={() => {}} streakHref="/streak" />);
    expect(await screen.findByText("Best: 12,000 points")).toBeVisible();
    expect(screen.getByTestId("best-streak")).toHaveTextContent("Best: 4 in a row in Africa");
    expect(screen.getByTestId("best-further-north")).toHaveTextContent("Best: 5 in a row");
    expect(screen.getByTestId("best-survival")).toHaveTextContent("No best yet");
    expect(screen.getByTestId("best-odd-one-out")).toHaveTextContent("No best yet");
    expect(screen.getByTestId("best-how-far")).toHaveTextContent("No best yet");
  });

  it("links every mode, and Blitz starts from its button", () => {
    const onPlayBlitz = vi.fn();
    render(<QuickGames onPlayBlitz={onPlayBlitz} streakHref="/streak?region=europe" />);
    expect(screen.getByRole("link", { name: /^Country Streak/ })).toHaveAttribute(
      "href",
      "/streak?region=europe",
    );
    expect(screen.getByRole("link", { name: /^Survival/ })).toHaveAttribute("href", "/survival");
    expect(screen.getByRole("link", { name: /^Further North/ })).toHaveAttribute(
      "href",
      "/further-north",
    );
    expect(screen.getByRole("link", { name: /^Odd one out/ })).toHaveAttribute(
      "href",
      "/odd-one-out",
    );
    expect(screen.getByRole("link", { name: /^How far apart\?/ })).toHaveAttribute(
      "href",
      "/how-far",
    );
    fireEvent.click(screen.getByRole("button", { name: /^Blitz/ }));
    expect(onPlayBlitz).toHaveBeenCalledOnce();
  });

  it("leaves out Blitz and Country Streak when they can't be played", () => {
    render(<QuickGames />);
    expect(screen.queryByRole("button", { name: /^Blitz/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /^Country Streak/ })).toBeNull();
    expect(screen.getByRole("link", { name: /^Survival/ })).toBeVisible();
  });

  it("shows the Blitz best the summary's game just set, before storage is read", () => {
    render(<QuickGames onPlayBlitz={() => {}} blitzBest={21000} />);
    expect(screen.getByTestId("best-blitz")).toHaveTextContent("Best: 21,000 points");
  });
});
