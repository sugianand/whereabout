import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SQUARES_KEY, SQUARE_SETS, setSquares } from "@/lib/squares";
import { useSquares } from "@/lib/useSquares";

import SquaresSwitch from "./SquaresSwitch";

/** The closest band's square, read the way the share card's preview reads it. */
function Closest() {
  return <span data-testid="closest">{SQUARE_SETS[useSquares()][0]}</span>;
}

afterEach(() => {
  act(() => setSquares("classic"));
  localStorage.clear();
});

describe("SquaresSwitch", () => {
  it("starts classic, switches every preview at once and keeps the choice", () => {
    render(
      <>
        <SquaresSwitch />
        <Closest />
      </>,
    );
    expect(screen.getByRole("group", { name: "Share squares" })).toBeInTheDocument();
    const classic = screen.getByRole("button", { name: "Classic" });
    const safe = screen.getByRole("button", { name: "Colour-blind safe" });
    expect(classic).toHaveAttribute("aria-pressed", "true");
    expect(classic).toHaveTextContent("🟩 Classic");
    expect(safe).toHaveTextContent("🟦 Colour-blind safe");
    expect(screen.getByTestId("closest")).toHaveTextContent("🟩");

    fireEvent.click(safe);
    expect(safe).toHaveAttribute("aria-pressed", "true");
    expect(classic).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("closest")).toHaveTextContent("🟦");
    expect(localStorage.getItem(SQUARES_KEY)).toBe("contrast");
  });

  it("follows a choice made in another tab", () => {
    render(<Closest />);
    expect(screen.getByTestId("closest")).toHaveTextContent("🟩");
    act(() => {
      localStorage.setItem(SQUARES_KEY, "contrast");
      window.dispatchEvent(new StorageEvent("storage", { key: SQUARES_KEY }));
    });
    expect(screen.getByTestId("closest")).toHaveTextContent("🟦");
  });
});
