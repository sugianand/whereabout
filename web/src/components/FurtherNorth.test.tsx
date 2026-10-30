import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import { BEST_NORTH_KEY } from "@/lib/game/furtherNorth";
import type { CatalogPhoto } from "@/lib/game/types";
import { gameFor } from "@/test/deck";

import FurtherNorth from "./FurtherNorth";

function record(id: string, lat: number, atlasLat: number | null): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
    lng: 10,
    lat,
    place: `Place ${id}`,
    country: "FR",
    credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  return {
    photo,
    atlas:
      atlasLat === null
        ? null
        : { lng: 10, lat: atlasLat, confidence: 0.5, topCountries: [], clues: [] },
  };
}

// random() = 0 shuffles with seed 0, which deals p5, p3, p4, p1, p2: photo 1 is further north,
// then photo 2, then photo 2 by under a degree (a dead heat), then photo 1.
const RECORDS = [
  record("p1", 49.3, 50),
  record("p2", 5.2, 10),
  record("p3", -33.9, 45),
  record("p4", 48.86, null),
  record("p5", 48.5, 40),
];
const ORDER = ["p5", "p3", "p4", "p1", "p2"];

beforeEach(() => {
  localStorage.clear();
});

async function setup() {
  const game = gameFor(RECORDS);
  const loadRecords = vi.fn(game.loadRecords);
  render(<FurtherNorth deck={game.deck} loadRecords={loadRecords} random={() => 0} />);
  await waitFor(() => expect(pickButton(1)).toBeEnabled());
  return { loadRecords };
}

const pickButton = (n: number) =>
  screen.getByRole("button", { name: `Photo ${n} was taken further north` });
const streak = () => screen.getByText("Streak").nextElementSibling;

async function pickAndNext(n: number) {
  fireEvent.click(pickButton(n));
  fireEvent.click(await screen.findByRole("button", { name: "Next pair" }));
}

describe("FurtherNorth", () => {
  it("deals the shuffled photos two at a time, with no place until a pick", async () => {
    const { loadRecords } = await setup();
    expect(screen.getByTestId("north-photo-1")).toHaveAttribute("data-photo", "p5");
    expect(screen.getByTestId("north-photo-2")).toHaveAttribute("data-photo", "p3");
    expect(screen.getByRole("img", { name: "Photo 1" })).toBeInTheDocument();
    expect(screen.queryByText(/Place p/)).toBeNull();
    // Only the pair and the photo dealt next are fetched.
    expect(loadRecords.mock.calls.flat(2)).toEqual(ORDER.slice(0, 3));
  });

  it("reveals both places and Atlas's pick, then keeps the second photo", async () => {
    await setup();
    fireEvent.click(pickButton(1));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Right");
    expect(card).toHaveTextContent(/Place p5 is [\d,]+ (km|mi) further north than Place p3\./);
    // Atlas guessed p3 further north (45° against 40°): it would have missed.
    expect(card).toHaveTextContent("Atlas picked photo 2, wrong. Atlas this run: 0 of 1 pair.");
    expect(screen.getByTestId("north-photo-1")).toHaveTextContent("Place p5 · 48.5° N");
    expect(screen.getByTestId("north-photo-2")).toHaveTextContent("Place p3 · 33.9° S");
    expect(within(screen.getByTestId("north-photo-1")).getByText("Further north")).toBeVisible();
    expect(streak()).toHaveTextContent("1");
    expect(localStorage.getItem(BEST_NORTH_KEY)).toBe("1");

    fireEvent.click(within(card).getByRole("button", { name: "Next pair" }));
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    expect(screen.getByTestId("north-photo-1")).toHaveAttribute("data-photo", "p3");
    expect(screen.getByTestId("north-photo-2")).toHaveAttribute("data-photo", "p4");
  });

  it("ends the run on a wrong pick, picked with the keyboard, and starts a new one", async () => {
    await setup();
    await pickAndNext(1);
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    fireEvent.keyDown(window, { key: "1" });
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Wrong");
    expect(card).toHaveTextContent("Run over: 1 pair in a row. That's your new best!");
    // Atlas has no guess for p4, so it sits this pair out.
    expect(card).not.toHaveTextContent("Atlas picked");

    fireEvent.click(within(card).getByRole("button", { name: "Start a new run" }));
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    expect(streak()).toHaveTextContent("0");
    expect(screen.getByText("Best").nextElementSibling).toHaveTextContent("1");
  });

  it("counts either pick on a dead heat, and clears once every photo is played", async () => {
    await setup();
    await pickAndNext(1);
    await waitFor(() => expect(pickButton(2)).toBeEnabled());
    await pickAndNext(2);
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    // p4 (48.86°) against p1 (49.3°): under a degree apart, so the "wrong" photo counts too.
    fireEvent.click(pickButton(1));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Too close to call");
    expect(card).toHaveTextContent(/Only \d+ (km|mi) apart north to south/);
    expect(within(screen.getByTestId("north-photo-2")).getByText("North by a hair")).toBeVisible();
    fireEvent.click(within(card).getByRole("button", { name: "Next pair" }));

    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    await pickAndNext(1);
    expect(
      await screen.findByRole("heading", { name: "You called every pair" }),
    ).toBeInTheDocument();
    expect(screen.getByText("4 pairs in a row, every photo the game has.")).toBeInTheDocument();
    expect(localStorage.getItem(BEST_NORTH_KEY)).toBe("4");
  });
});
