import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import { BEST_SPOT_KEY, dealSpot } from "@/lib/game/spotClue";
import type { AtlasLooked } from "@/lib/game/types";
import { gameFor } from "@/test/deck";

import SpotClue from "./SpotClue";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// A 3 × 3 map whose hottest square is the bottom left; the middle counts half as much.
const MAP: AtlasLooked = {
  grid: 3,
  crop: [0, 0, 1, 1],
  cells: [0, 0, 0, 0, 0.5, 0, 1, 0, 0],
};

function record(id: string, atlasCountry: string): GameRecord {
  return {
    photo: {
      id,
      imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
      lng: 2,
      lat: 48,
      place: `Place ${id}`,
      country: "FR",
      credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
    },
    atlas: {
      lng: 2,
      lat: 48,
      confidence: 0.82,
      topCountries: [{ country: atlasCountry, p: 0.82 }],
      clues: [],
      looked: MAP,
    },
  };
}

const RECORDS = ["s1", "s2", "s3", "s4", "s5", "s6"].map((id, i) =>
  record(id, i % 2 ? "BE" : "FR"),
);
const IDS = RECORDS.map((r) => r.photo.id);
// random() = 0 deals from seed 0.
const ORDER = dealSpot(IDS, 0);
const byId = new Map(RECORDS.map((r) => [r.photo.id, r]));

async function setup() {
  const game = gameFor(RECORDS);
  render(<SpotClue deck={game.deck} ids={IDS} loadRecords={game.loadRecords} random={() => 0} />);
  await screen.findByRole("button", { name: "Lock in row 2, column 2" });
}

const photoOn = () => document.querySelector("main")?.getAttribute("data-photo");

describe("SpotClue", () => {
  it("asks about Atlas's country on a grid of the square it saw, starting in the middle", async () => {
    await setup();
    expect(photoOn()).toBe(ORDER[0]);
    const pick = byId.get(ORDER[0]!)!.atlas!.topCountries[0]!.country;
    expect(screen.getByTestId("spot-question")).toHaveTextContent(
      `Atlas said ${pick === "FR" ? "France" : "Belgium"}.`,
    );
    const grid = screen.getByRole("group", { name: /grid of 3 rows by 3 columns/ });
    const squares = within(grid).getAllByRole("button");
    expect(squares).toHaveLength(9);
    expect(within(grid).getByRole("button", { name: "Row 2, column 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Only the picked square is in the tab order.
    expect(squares.filter((b) => b.tabIndex === 0)).toHaveLength(1);
  });

  it("moves the square with the arrows, locks it in with G and shows Atlas's map", async () => {
    await setup();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByRole("button", { name: "Lock in row 3, column 1" })).toBeEnabled();
    fireEvent.keyDown(window, { key: "g" });

    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Spot on: 1,000 points");
    expect(within(card).getByTestId("spot-line")).toHaveTextContent(
      "You picked the square that mattered most to Atlas",
    );
    expect(screen.getByTestId("spot-heat")).toBeInTheDocument();
    expect(screen.getByTestId("spot-yours")).toHaveAttribute("data-cell", "6");
    // The grid to pick from is gone once the square is locked in.
    expect(screen.queryByRole("group", { name: /grid of/ })).toBeNull();
    expect(within(card).getByRole("button", { name: "Next photo" })).toHaveFocus();
    expect(screen.getByText("1,000", { selector: "dd" })).toBeInTheDocument();
  });

  it("scores a tapped square by how much it told Atlas, and marks the hottest apart", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Row 1, column 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Lock in row 1, column 1" }));
    let card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Cold: 0 points");
    expect(screen.getByTestId("spot-yours")).toHaveAttribute("data-cell", "0");
    expect(screen.getByTestId("spot-hottest")).toHaveAttribute("data-cell", "6");

    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
    await waitFor(() => expect(photoOn()).toBe(ORDER[1]));
    // The cursor starts in the middle again, and the middle is worth half.
    fireEvent.click(await screen.findByRole("button", { name: "Lock in row 2, column 2" }));
    card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Warm: 500 points");
    expect(within(card).getByTestId("spot-line")).toHaveTextContent(
      "Your square (gold) mattered 50% as much to Atlas as its most telling one",
    );
    const atlas = byId.get(ORDER[1]!)!.atlas!.topCountries[0]!.country;
    expect(within(card).getByTestId("spot-atlas")).toHaveTextContent(
      atlas === "FR"
        ? "Atlas said France, 82% sure, and it was right. The photo: Place"
        : "Atlas said Belgium, 82% sure: wrong. The photo: Place",
    );
  });

  it("finishes five photos with the total and keeps the best", async () => {
    localStorage.setItem(BEST_SPOT_KEY, "1200");
    await setup();
    for (let n = 0; n < 5; n++) {
      await waitFor(() => expect(photoOn()).toBe(ORDER[n]));
      // Two photos on the hottest square, the rest on the middle.
      if (n < 2) {
        fireEvent.click(await screen.findByRole("button", { name: "Row 3, column 1" }));
      }
      fireEvent.keyDown(window, { key: "g" });
      const card = await screen.findByRole("region");
      fireEvent.click(
        within(card).getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }),
      );
    }
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("3,500 points");
    expect(
      screen.getByText(/Out of 5,000\. You found Atlas's most telling square on 2 of 5 photos\./),
    ).toBeInTheDocument();
    expect(screen.getByText("That's your new best!")).toBeInTheDocument();
    expect(localStorage.getItem(BEST_SPOT_KEY)).toBe("3500");
    expect(screen.getAllByTestId("spot-row")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Play again" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    await screen.findByRole("button", { name: "Lock in row 2, column 2" });
    expect(screen.getByText("3,500", { selector: "dd" })).toBeInTheDocument();
  });
});
