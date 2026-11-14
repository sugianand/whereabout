import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BEST_CLUE_MIX_KEY, clueAnswers, dealClueMix, type ClueMaps } from "@/lib/game/clueMix";
import type { GameRecord } from "@/lib/game/deck";
import type { CatalogPhoto } from "@/lib/game/types";
import type { ClimateGroup } from "@/lib/trueClues";
import { gameFor } from "@/test/deck";

import ClueMix from "./ClueMix";

function record(
  id: string,
  country: string,
  side: "left" | "right",
  climate: ClimateGroup,
  atlas: GameRecord["atlas"],
): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
    lng: 10,
    lat: 40,
    place: `Place ${id}`,
    country,
    drivingSide: side,
    climateGroup: climate,
    credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  return { photo, atlas };
}

const guess = (clues: string[], top: string): GameRecord["atlas"] => ({
  lng: 0,
  lat: 0,
  confidence: 0.5,
  topCountries: [{ country: top, p: 0.5 }],
  clues: clues.map((label) => ({ label, p: 0.7 })),
});

const RECORDS = [
  record("j1", "JP", "left", "Temperate", guess(["Drives on the left", "Arid climate"], "JP")),
  record("j2", "JP", "left", "Continental", guess([], "KR")),
  record("g1", "GB", "left", "Temperate", guess(["Temperate climate"], "GB")),
  record("f1", "FR", "right", "Temperate", guess([], "FR")),
  record("f2", "FR", "right", "Arid", null),
  record("e1", "EG", "right", "Arid", guess(["Arid climate"], "MA")),
  record("b1", "BR", "right", "Tropical", guess(["Drives on the left"], "PT")),
  record("a1", "AU", "left", "Arid", guess([], "AU")),
  record("n1", "NO", "right", "Polar", guess(["Arctic"], "NO")),
];
const MAPS: ClueMaps = {
  sides: Object.fromEntries(RECORDS.map((r) => [r.photo.id, r.photo.drivingSide!])),
  climates: Object.fromEntries(
    RECORDS.map((r) => [r.photo.id, r.photo.climateGroup as ClimateGroup]),
  ),
  continents: {
    j1: "Asia",
    j2: "Asia",
    g1: "Europe",
    f1: "Europe",
    f2: "Europe",
    e1: "Africa",
    b1: "South America",
    a1: "Oceania",
    n1: "Europe",
  },
};
// random() = 0 deals from seed 0.
const ORDER = dealClueMix(MAPS, 0);
const truthOf = (n: number) => {
  const { id, clue } = ORDER[n];
  return clue === "road"
    ? MAPS.sides[id]
    : clue === "climate"
      ? MAPS.climates[id]
      : MAPS.continents[id];
};

beforeEach(() => localStorage.clear());
afterEach(cleanup);

async function setup() {
  const game = gameFor(RECORDS);
  const loadRecords = vi.fn(game.loadRecords);
  render(<ClueMix deck={game.deck} maps={MAPS} loadRecords={loadRecords} random={() => 0} />);
  await waitFor(() => expect(screen.getByTestId("clue-left")).toBeEnabled());
  return { loadRecords };
}

const photo = () => screen.getByTestId("clue-photo");
const streak = () => screen.getByText("Streak").nextElementSibling;

/** Answer the step on screen right, then move on. */
async function callRight(n: number) {
  await waitFor(() => expect(photo()).toHaveAttribute("data-photo", ORDER[n].id));
  await waitFor(() => expect(screen.getByTestId(`clue-${truthOf(n)}`)).toBeEnabled());
  fireEvent.click(screen.getByTestId(`clue-${truthOf(n)}`));
  const card = await screen.findByRole("region");
  expect(within(card).getByRole("heading")).toHaveTextContent("Correct");
  fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
}

describe("ClueMix", () => {
  it("asks the road first, with nothing about the place until a call", async () => {
    expect(ORDER.length).toBeGreaterThanOrEqual(3);
    const { loadRecords } = await setup();
    expect(ORDER[0].clue).toBe("road");
    expect(photo()).toHaveAttribute("data-photo", ORDER[0].id);
    expect(photo()).toHaveAttribute("data-clue", "road");
    expect(screen.getByTestId("clue-question")).toHaveTextContent(
      "Which side of the road do they drive on?",
    );
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Road");
    expect(screen.queryByText(/Place /)).toBeNull();
    expect(loadRecords.mock.calls.flat(2)).toEqual(ORDER.slice(0, 2).map((s) => s.id));
  });

  it("moves through the climate and the continent, revealing each answer and Atlas's read", async () => {
    await setup();
    await callRight(0);

    await waitFor(() => expect(photo()).toHaveAttribute("data-clue", "climate"));
    expect(screen.getByTestId("clue-question")).toHaveTextContent("Which climate is it?");
    expect(screen.getByRole("group").querySelectorAll("button")).toHaveLength(5);
    await waitFor(() => expect(screen.getByTestId(`clue-${truthOf(1)}`)).toBeEnabled());
    fireEvent.click(screen.getByTestId(`clue-${truthOf(1)}`));
    const card = await screen.findByRole("region");
    expect(card).toHaveTextContent(`${truthOf(1).toLowerCase()} climate, in`);
    expect(card).toHaveTextContent(/Atlas this run: [0-2] of [0-2]\./);
    expect(card).toHaveTextContent("Next up: the continent");
    expect(photo()).toHaveTextContent(truthOf(1));
    expect(streak()).toHaveTextContent("2");
    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));

    await waitFor(() => expect(photo()).toHaveAttribute("data-clue", "continent"));
    expect(screen.getByTestId("clue-question")).toHaveTextContent("Which continent is it on?");
    // Only the continents the deck holds.
    expect(screen.getByRole("group").querySelectorAll("button")).toHaveLength(
      clueAnswers("continent", MAPS).length,
    );
    expect(localStorage.getItem(BEST_CLUE_MIX_KEY)).toBe("2");
  });

  it("takes the arrows for the road and numbers for the rest", async () => {
    await setup();
    fireEvent.keyDown(window, { key: truthOf(0) === "left" ? "ArrowLeft" : "ArrowRight" });
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Correct");
    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
    await waitFor(() => expect(photo()).toHaveAttribute("data-clue", "climate"));
    await waitFor(() => expect(screen.getByTestId("clue-Tropical")).toBeEnabled());
    // An arrow names no climate.
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.queryByRole("region")).toBeNull();
    const n = ["Tropical", "Arid", "Temperate", "Continental", "Polar"].indexOf(truthOf(1)) + 1;
    fireEvent.keyDown(window, { key: String(n) });
    expect(within(await screen.findByRole("region")).getByRole("heading")).toHaveTextContent(
      "Correct",
    );
  });

  it("ends the run on a wrong call, says the best, and deals a new run", async () => {
    localStorage.setItem(BEST_CLUE_MIX_KEY, "4");
    await setup();
    fireEvent.click(screen.getByTestId(`clue-${truthOf(0) === "left" ? "right" : "left"}`));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Wrong");
    expect(card).toHaveTextContent("Run over: 0 clues in a row. Your best is 4 clues.");
    expect(card).not.toHaveTextContent("Next up");
    const again = within(card).getByRole("button", { name: "Start a new run" });
    expect(again).toHaveFocus();
    fireEvent.click(again);
    await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
    expect(streak()).toHaveTextContent("0");
    expect(localStorage.getItem(BEST_CLUE_MIX_KEY)).toBe("4");
  });

  it("says when there's nothing to deal", async () => {
    const game = gameFor(RECORDS);
    render(
      <ClueMix
        deck={game.deck}
        maps={{ sides: { j1: "left" }, climates: {}, continents: {} }}
        loadRecords={game.loadRecords}
        random={() => 0}
      />,
    );
    expect(
      await screen.findByRole("heading", { name: "No photos to play yet" }),
    ).toBeInTheDocument();
  });
});
