import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { NORTH_DAILY_KEY } from "@/lib/game/northDaily";
import { recordFreeRound } from "@/lib/game/quickRecord";

import QuickRecord from "./QuickRecord";

beforeEach(() => {
  window.localStorage.clear();
});

describe("QuickRecord", () => {
  it("shows nothing until a quick-game round has been played", () => {
    const { container } = render(<QuickRecord />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows only the games played, you against Atlas, with today's runs counted in", async () => {
    recordFreeRound("further-north", { first: true, correct: true, atlas: true });
    recordFreeRound("further-north", { first: false, correct: false, atlas: null });
    window.localStorage.setItem(
      NORTH_DAILY_KEY,
      JSON.stringify({
        "2026-10-31": { streak: 2, atlasRight: 0, atlasPlayed: 2, ended: "miss" },
      }),
    );
    render(<QuickRecord />);
    const card = await screen.findByTestId("record-further-north");
    expect(screen.queryByTestId("record-odd-one-out")).not.toBeInTheDocument();
    expect(within(card).getByText("2 runs, 1 of them today's")).toBeInTheDocument();
    // You: 3 of 5 right (60%); Atlas: 1 of the 3 it played (33%).
    expect(within(card).getByText("You're ahead of Atlas by 27 points.")).toBeInTheDocument();
    const you = within(card).getByRole("meter", { name: "You: rounds right" });
    expect(you).toHaveAttribute("aria-valuenow", "60");
    expect(you).toHaveAttribute("aria-valuetext", "3 of 5 rounds right, 60%");
    const atlas = within(card).getByRole("meter", { name: "Atlas: rounds right" });
    expect(atlas).toHaveAttribute("aria-valuetext", "1 of 3 rounds right, 33%");
    expect(within(card).getByText(/it has played 2 rounds fewer than you/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Play Further North" })).toHaveAttribute(
      "href",
      "/further-north",
    );
    expect(within(card).getByRole("link", { name: "Today's run" })).toHaveAttribute(
      "href",
      "/further-north/daily",
    );
  });

  it("waits for Atlas's first round before calling a leader", async () => {
    recordFreeRound("odd-one-out", { first: true, correct: true, atlas: null });
    render(<QuickRecord />);
    const card = await screen.findByTestId("record-odd-one-out");
    expect(within(card).getByText("Atlas hasn't played a round with you yet.")).toBeInTheDocument();
    expect(within(card).getByText("1 run")).toBeInTheDocument();
    expect(within(card).getByText("No rounds yet")).toBeInTheDocument();
  });
});
