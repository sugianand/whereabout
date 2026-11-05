import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import { BEST_LINE_KEY } from "@/lib/game/lineUp";
import type { AtlasGuess, CatalogPhoto } from "@/lib/game/types";
import { gameFor } from "@/test/deck";

import LineUp from "./LineUp";

function record(id: string, country: string, lng: number, atlasLng: number | null): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
    lng,
    lat: 20,
    place: `Place ${id}`,
    country,
    credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  const atlas: AtlasGuess | null =
    atlasLng === null
      ? null
      : { lng: atlasLng, lat: 20, confidence: 0.5, topCountries: [], clues: [] };
  return { photo, atlas };
}

// Photos spread evenly so every row has a clear order, and Atlas's pins hold the same order.
const RECORDS = [
  ...[0, 1, 2, 3, 4, 5].map((i) => record(`fr${i}`, "FR", 1 + i * 3, 1 + i * 3)),
  ...[0, 1, 2, 3, 4, 5].map((i) => record(`jp${i}`, "JP", 130 + i * 3, 130 + i * 3)),
  ...[0, 1, 2, 3, 4, 5].map((i) => record(`eg${i}`, "EG", 30 + i * 3, 30 + i * 3)),
  ...[0, 1, 2, 3, 4, 5].map((i) => record(`us${i}`, "US", -120 + i * 3, -120 + i * 3)),
];
const BY_ID = new Map(RECORDS.map((r) => [r.photo.id, r]));

beforeEach(() => localStorage.clear());

async function setup() {
  const game = gameFor(RECORDS);
  const { container } = render(
    <LineUp deck={game.deck} loadRecords={game.loadRecords} random={() => 0.5} />,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "Lock it in" })).toBeEnabled(), {
    timeout: 5000,
  });
  return { container };
}

/** The row as it stands on screen, by place. */
function row(): string[] {
  return [1, 2, 3, 4].map((n) => screen.getByTestId(`line-photo-${n}`).dataset.photo!);
}

const tile = (n: number) => screen.getByRole("button", { name: new RegExp(`^Photo in place ${n}`) });

/** Put the row in its true order by swaps, the way a player taps it. */
function solve() {
  const want = [...row()].sort((a, b) => BY_ID.get(a)!.photo.lng - BY_ID.get(b)!.photo.lng);
  for (let place = 0; place < want.length; place++) {
    const at = row().indexOf(want[place]);
    if (at !== place) {
      fireEvent.click(tile(place + 1));
      fireEvent.click(tile(at + 1));
    }
  }
  expect(row()).toEqual(want);
}

describe("LineUp", () => {
  it("swaps two tapped photos, and a second tap on one puts it back down", async () => {
    await setup();
    const before = row();
    fireEvent.click(tile(1));
    expect(tile(1)).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Now tap the place it goes.");
    fireEvent.click(tile(1));
    expect(row()).toEqual(before);

    fireEvent.click(tile(1));
    fireEvent.click(tile(3));
    expect(row()).toEqual([before[2], before[1], before[0], before[3]]);
    expect(tile(1)).toHaveAttribute("aria-pressed", "false");
  });

  it("swaps from the number keys, and Escape lets go", async () => {
    await setup();
    const before = row();
    fireEvent.keyDown(window, { key: "2" });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "4" });
    fireEvent.keyDown(window, { key: "1" });
    expect(row()).toEqual([before[3], before[1], before[2], before[0]]);
  });

  it("reveals the true order with its longitudes, you and Atlas", async () => {
    await setup();
    solve();
    fireEvent.click(screen.getByRole("button", { name: "Lock it in" }));
    expect(screen.getByRole("heading", { name: "All four in place" })).toBeVisible();
    expect(screen.getByText("Atlas put 4 in place: 4 of 4 so far.")).toBeVisible();
    const west = BY_ID.get(row()[0])!.photo;
    expect(screen.getByText(`Place ${west.id}`)).toBeVisible();
    expect(screen.getByRole("button", { name: "Next row" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: /^Photo in place/ })).toBeNull();
  });

  it("says where a misplaced photo was put", async () => {
    await setup();
    solve();
    fireEvent.click(tile(1));
    fireEvent.click(tile(2));
    fireEvent.click(screen.getByRole("button", { name: "Lock it in" }));
    expect(screen.getByRole("heading", { name: "2 of 4 in place" })).toBeVisible();
    expect(screen.getByText("You: 2nd")).toBeVisible();
    expect(screen.getByText("You: 1st")).toBeVisible();
  });

  it("looks closer at a photo and comes back to the same row", async () => {
    await setup();
    const before = row();
    fireEvent.click(screen.getByRole("button", { name: "Look closer at the photo in place 2" }));
    expect(screen.getByRole("dialog", { name: "The photo, closer" })).toBeVisible();
    // The number keys don't move the row behind it.
    fireEvent.keyDown(window, { key: "1" });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(row()).toEqual(before);
    expect(tile(1)).toHaveAttribute("aria-pressed", "false");
  });

  it("plays five rows, shows Atlas's total, keeps the best and deals a new game", async () => {
    await setup();
    for (let i = 1; i <= 5; i++) {
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Lock it in" })).toBeEnabled(),
      );
      expect(screen.getByText(`Row ${i} of 5`)).toBeVisible();
      solve();
      fireEvent.click(screen.getByRole("button", { name: "Lock it in" }));
      fireEvent.click(screen.getByRole("button", { name: i < 5 ? "Next row" : "See your score" }));
    }
    expect(screen.getByRole("heading", { name: "20 in place" })).toBeVisible();
    expect(screen.getByText(/That's your new best!/)).toBeVisible();
    expect(screen.getByTestId("line-atlas-total")).toHaveTextContent(
      "Atlas: 20 of 20 in place.",
    );
    expect(localStorage.getItem(BEST_LINE_KEY)).toBe("20");

    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    await waitFor(() => expect(screen.getByText("Row 1 of 5")).toBeVisible());
  });

  it("says so when there is nothing to deal", async () => {
    const game = gameFor(RECORDS.slice(0, 3));
    render(<LineUp deck={{ ...game.deck, regions: {} }} loadRecords={vi.fn()} />);
    expect(await screen.findByText("No photos to play yet")).toBeVisible();
  });
});
