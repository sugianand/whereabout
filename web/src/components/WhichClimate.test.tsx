import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import type { CatalogPhoto } from "@/lib/game/types";
import { CLIMATE_DAILY_KEY, dailyClimateOrder } from "@/lib/game/climateDaily";
import { EMPTY_TALLY, loadFreeTallies, loadQuickRecord } from "@/lib/game/quickRecord";
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

describe("WhichClimate, today's game", () => {
  const DAY = "2026-11-13";
  const now = () => new Date(`${DAY}T18:48:00Z`);
  const order = dailyClimateOrder(GROUPS, DAY);
  const dayTruth = (n: number) => GROUPS[order[n]];

  function play() {
    const game = gameFor(RECORDS);
    return render(
      <WhichClimate
        deck={game.deck}
        groups={GROUPS}
        loadRecords={game.loadRecords}
        daily
        now={now}
      />,
    );
  }

  async function call(n: number, group: ClimateGroup) {
    await waitFor(() => expect(photo()).toHaveAttribute("data-photo", order[n]));
    await waitFor(() => expect(button("Arid")).toBeEnabled());
    fireEvent.click(button(group));
    return screen.findByRole("region");
  }

  it("deals the day's photos, picks up after a reload, and shares the score once all five are called", async () => {
    expect(order).toHaveLength(5);
    const first = play();
    await waitFor(() => expect(button("Arid")).toBeEnabled());
    expect(screen.getByText(/today's game \(2026-11-13\)/)).toBeInTheDocument();
    expect(screen.queryByText("Best")).toBeNull();
    expect(screen.getByRole("link", { name: "Free games" })).toHaveAttribute(
      "href",
      "/which-climate",
    );
    await call(0, dayTruth(0));
    expect(JSON.parse(localStorage.getItem(CLIMATE_DAILY_KEY)!)[DAY].results).toHaveLength(1);
    first.unmount();

    // A reload carries on at the second photo with the score so far: the first can't be retaken.
    play();
    await waitFor(() => expect(photo()).toHaveAttribute("data-photo", order[1]));
    expect(score()).toHaveTextContent("1");
    expect(screen.getByText("Photo 2 of 5")).toBeInTheDocument();

    for (let n = 1; n < 5; n++) {
      const card = await call(n, n < 3 ? dayTruth(n) : wrongFor(dayTruth(n)));
      fireEvent.click(
        within(card).getByRole("button", { name: n === 4 ? "See today's result" : "Next photo" }),
      );
    }
    expect(await screen.findByRole("heading", { level: 1, name: "3 of 5" })).toBeInTheDocument();
    expect(screen.getByText(/^That's today's game played\./)).toBeInTheDocument();
    expect(screen.getByText(/The next game is dealt in 5h 12m\./)).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId("climate-row")[0]).toHaveTextContent("Place"));
    expect(screen.getAllByTestId("climate-row")).toHaveLength(5);

    // Today's game keeps its own result, apart from the free games' best, and Your map reads it
    // from the day kept, so the free games' tally never counts it a second time.
    expect(localStorage.getItem(BEST_CLIMATE_KEY)).toBeNull();
    expect(loadFreeTallies()["which-climate"]).toEqual(EMPTY_TALLY);
    expect(loadQuickRecord()["which-climate"].daily).toMatchObject({
      runs: 1,
      rounds: 5,
      right: 3,
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const share = screen.getByRole("button", { name: "Share today's game" });
    expect(share).toHaveFocus();
    fireEvent.click(share);
    expect(await screen.findByText("Result copied. Paste it anywhere.")).toBeVisible();
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toMatch(/^Whereabout · Which climate\? · 2026-11-13\n🌦️ 3 of 5\n🟩🟩🟩🟥🟥\n/);
    for (const r of RECORDS) {
      expect(text).not.toContain(r.photo.id);
      expect(text).not.toContain(r.photo.place);
    }
  });

  it("shows the day's result instead of dealing it again once every photo is called", async () => {
    const results = order.map((id) => ({
      id,
      picked: GROUPS[id],
      truth: GROUPS[id],
      correct: true,
      atlas: null,
    }));
    localStorage.setItem(CLIMATE_DAILY_KEY, JSON.stringify({ [DAY]: { results } }));
    play();
    expect(await screen.findByRole("heading", { level: 1, name: "5 of 5" })).toBeInTheDocument();
    expect(screen.getByText(/Atlas said nothing about the climate today\./)).toBeInTheDocument();
    expect(screen.queryByTestId("climate-photo")).toBeNull();
    expect(screen.getByRole("link", { name: "Play a free game" })).toHaveAttribute(
      "href",
      "/which-climate",
    );
  });

  it("links the free games to today's game", async () => {
    await setup();
    expect(screen.getByRole("link", { name: "Today's game" })).toHaveAttribute(
      "href",
      "/which-climate/daily",
    );
  });
});
