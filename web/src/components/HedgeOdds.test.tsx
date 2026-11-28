import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { HedgeResult } from "@/lib/game/hedge";
import { recordHedgeOdds } from "@/lib/game/hedgeOdds";

import HedgeOdds from "./HedgeOdds";

beforeEach(() => window.localStorage.clear());

const bet = (chips: number[], atlasChips: number[], right: number) =>
  recordHedgeOdds({
    id: "x",
    options: ["A", "B", "C", "D"],
    chips,
    atlasChips,
    right,
  } as HedgeResult);

describe("HedgeOdds", () => {
  it("shows nothing until a bet has been placed", () => {
    const { container } = render(<HedgeOdds />);
    expect(container).toBeEmptyDOMElement();
  });

  it("charts how often each share of chips was right, yours beside Atlas's", async () => {
    bet([10, 0, 0, 0], [6, 2, 1, 1], 0);
    bet([0, 10, 0, 0], [6, 2, 1, 1], 0);
    render(<HedgeOdds />);
    expect(await screen.findByTestId("hedge-odds-line")).toHaveTextContent(
      "Over 2 photos, your chips were 50 points off the real odds; Atlas's, 20.Atlas's probabilities read the odds closer than you so far.",
    );
    const chart = screen.getByRole("list", {
      name: "How often a country was right by the chips on it",
    });
    expect(within(chart).getAllByRole("listitem")).toHaveLength(4);
    const sure = screen.getByTestId("hedge-odds-sure");
    expect(
      within(sure).getByRole("meter", {
        name: "You: how often a country with 8–10 chips was right",
      }),
    ).toHaveAttribute("aria-valuetext", "Right 1 of 2 · 50%, chips said 100%");
    expect(screen.getByTestId("hedge-odds-sure-atlas")).toHaveTextContent("None bet yet");
    expect(screen.getByTestId("hedge-odds-likely-atlas")).toHaveTextContent(
      "Right 2 of 2 · 100%, chips said 60%",
    );
    expect(screen.getByTestId("hedge-odds-long-atlas")).toHaveTextContent(
      "Right 0 of 6 · 0%, chips said 13%",
    );
    expect(screen.getByRole("link", { name: "Play Hedge your bets" })).toHaveAttribute(
      "href",
      "/hedge",
    );
  });
});
