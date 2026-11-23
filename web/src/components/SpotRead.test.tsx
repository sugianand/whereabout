import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { recordSpotRead } from "@/lib/game/spotRead";
import type { AtlasLooked } from "@/lib/game/types";

import SpotRead from "./SpotRead";

// A 3 × 3 map whose hottest square is the bottom left.
const MAP: AtlasLooked = { grid: 3, crop: [0, 0, 1, 1], cells: [0, 0, 0, 0, 0.5, 0, 1, 0, 0] };

beforeEach(() => window.localStorage.clear());

describe("SpotRead", () => {
  it("shows nothing until a square has been picked", () => {
    const { container } = render(<SpotRead />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says how warm and how far, and charts where you and Atlas look", async () => {
    recordSpotRead(MAP, 6);
    recordSpotRead(MAP, 4);
    recordSpotRead(MAP, 2);
    render(<SpotRead />);
    expect(await screen.findByTestId("spot-read-line")).toHaveTextContent(
      "2 of 3 squares warm or better (67%), on average 1.0 squares from Atlas's most telling.You look most at the top right of the photo; Atlas at the bottom left.",
    );
    const you = screen.getByRole("list", { name: "Where you look, by third of the photo" });
    const cells = within(you).getAllByRole("listitem");
    expect(cells).toHaveLength(9);
    expect(cells[6]).toHaveAccessibleName("the bottom left: 1 square");
    expect(cells[0]).toHaveAccessibleName("the top left: 0 squares");
    const atlas = screen.getByRole("list", { name: "Where Atlas looks, by third of the photo" });
    expect(within(atlas).getAllByRole("listitem")[6]).toHaveAccessibleName(
      "the bottom left: 3 photos",
    );
    expect(screen.getByRole("link", { name: "Play Spot the clue" })).toHaveAttribute(
      "href",
      "/spot-the-clue",
    );
  });
});
