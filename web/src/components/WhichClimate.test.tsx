import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import type { CatalogPhoto } from "@/lib/game/types";
import { loadFreeTallies } from "@/lib/game/quickRecord";
import { BEST_CLIMATE_KEY, dealClimate, type ClimateMap } from "@/lib/game/whichClimate";
import { atlasClimateGroup, type ClimateGroup } from "@/lib/trueClues";
import { gameFor } from "@/test/deck";

import WhichClimate from "./WhichClimate";

function record(id: string, group: ClimateGroup, atlasClues: string[] | null): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
    lng: 10,
    lat: -33.5,
    place: `Place ${id}`,
    country: "AU",
    climateGroup: group,
    credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  const atlas = atlasClues && {
    lng: 0,
    lat: 0,
    confidence: 0.5,
    topCountries: [{ country: "AU", p: 0.5 }],
    clues: atlasClues.map((label) => ({ label, p: 0.7 })),
  };
  return { photo, atlas };
}

// Each photo's Atlas read is right, wrong or missing, depending on the photo.
const RECORDS = [
  record("t1", "Tropical", ["Tropical climate"]),
  record("t2", "Tropical", ["Desert"]),
  record("a1", "Arid", ["Arid climate"]),
  record("a2", "Arid", null),
  record("m1", "Temperate", ["Mediterranean"]),
  record("m2", "Temperate", ["City"]),
  record("c1", "Continental", ["Temperate climate"]),
  record("p1", "Polar", ["Arctic"]),
];
const GROUPS: ClimateMap = Object.fromEntries(
  RECORDS.map((r) => [r.photo.id, r.photo.climateGroup as ClimateGroup]),
);
// random() = 0 deals from seed 0.
const ORDER = dealClimate(GROUPS, 0);
const truthOf = (n: number) => GROUPS[ORDER[n]];
const wrongFor = (g: ClimateGroup): ClimateGroup => (g === "Polar" ? "Arid" : "Polar");

beforeEach(() => localStorage.clear());
afterEach(cleanup);

async function setup() {
  const game = gameFor(RECORDS);
  const loadRecords = vi.fn(game.loadRecords);
  render(
    <WhichClimate deck={game.deck} groups={GROUPS} loadRecords={loadRecords} random={() => 0} />,
  );
  await waitFor(() => expect(button("Arid")).toBeEnabled());
  return { loadRecords };
}

const button = (group: ClimateGroup) => screen.getByTestId(`climate-${group}`);
const photo = () => screen.getByTestId("climate-photo");
const score = () => screen.getByText("Score").nextElementSibling;

describe("WhichClimate", () => {
  it("deals five photos, showing nothing about the place before a call", async () => {
    expect(ORDER).toHaveLength(5);
    const { loadRecords } = await setup();
    expect(photo()).toHaveAttribute("data-photo", ORDER[0]);
    expect(screen.getByText("Photo 1 of 5")).toBeInTheDocument();
    expect(screen.queryByText(/Place /)).toBeNull();
    // The photo on screen and the next one are all that's fetched.
    expect(loadRecords.mock.calls.flat(2)).toEqual(ORDER.slice(0, 2));
  });

  it("reveals the place on the band of climates, with your call and Atlas's", async () => {
    await setup();
    const truth = truthOf(0);
    const wrong = wrongFor(truth);
    fireEvent.click(button(wrong));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Wrong");
    expect(card).toHaveTextContent(`climate:`);
    expect(card).toHaveTextContent(`Place ${ORDER[0]} · 33.5° S`);
    const band = within(card).getByTestId("climate-band");
    const here = band.querySelector("[aria-current='location']")!;
    expect(here).toHaveAttribute("data-group", truth);
    expect(band.querySelector(`[data-group='${wrong}']`)).toHaveTextContent("You");
    expect(score()).toHaveTextContent("0");
    // The next button has focus, so Enter moves on.
    expect(within(card).getByRole("button", { name: "Next photo" })).toHaveFocus();
  });

  it("plays five photos by key, against Atlas, and keeps the best whole game", async () => {
    await setup();
    for (let n = 0; n < 5; n++) {
      await waitFor(() => expect(photo()).toHaveAttribute("data-photo", ORDER[n]));
      await waitFor(() => expect(button("Arid")).toBeEnabled());
      const pick = n < 3 ? truthOf(n) : wrongFor(truthOf(n));
      const key = String(
        ["Tropical", "Arid", "Temperate", "Continental", "Polar"].indexOf(pick) + 1,
      );
      fireEvent.keyDown(window, { key });
      const card = await screen.findByRole("region");
      expect(within(card).getByRole("heading")).toHaveTextContent(n < 3 ? "Correct" : "Wrong");
      fireEvent.click(
        within(card).getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }),
      );
    }
    expect(await screen.findByRole("heading", { level: 1, name: "3 of 5" })).toBeInTheDocument();
    expect(screen.getAllByTestId("climate-row")).toHaveLength(5);
    expect(screen.getByText("That's your new best!")).toBeInTheDocument();
    expect(localStorage.getItem(BEST_CLIMATE_KEY)).toBe("3");
    expect(screen.getByText(/Atlas read the climate on \d of the 5 photos/)).toBeInTheDocument();
    // Every call is in your clue reading on Your map, with Atlas's read of the same photos.
    const reads = ORDER.map((id) =>
      atlasClimateGroup(RECORDS.find((r) => r.photo.id === id)!.atlas),
    );
    expect(loadFreeTallies()["which-climate"]).toEqual({
      runs: 1,
      rounds: 5,
      right: 3,
      atlasPlayed: reads.filter((g) => g !== null).length,
      atlasRight: reads.filter((g, n) => g !== null && g === truthOf(n)).length,
    });
  });

  it("says when Atlas read nothing about the climate", async () => {
    // Deal a game whose first photo is the one Atlas sat out.
    const groups: ClimateMap = {
      a2: "Arid",
      t1: "Tropical",
      m1: "Temperate",
      c1: "Continental",
      p1: "Polar",
    };
    const game = gameFor(RECORDS);
    let seed = 0;
    while (dealClimate(groups, seed)[0] !== "a2") seed++;
    render(
      <WhichClimate
        deck={game.deck}
        groups={groups}
        loadRecords={game.loadRecords}
        random={() => seed / 2 ** 32}
      />,
    );
    await waitFor(() => expect(button("Arid")).toBeEnabled());
    fireEvent.click(button("Arid"));
    const card = await screen.findByRole("region");
    expect(card).toHaveTextContent("Atlas said nothing about the climate here");
    expect(card).toHaveTextContent("Atlas this game: 0 of 1.");
  });

  it("says so when there are too few photos to deal", async () => {
    const game = gameFor(RECORDS);
    render(
      <WhichClimate deck={game.deck} groups={{ a1: "Arid" }} loadRecords={game.loadRecords} />,
    );
    expect(await screen.findByText("No photos to play yet")).toBeInTheDocument();
  });
});
