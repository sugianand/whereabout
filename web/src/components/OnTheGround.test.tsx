import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import { GROUND_DAILY_KEY, dailyGroundOrder } from "@/lib/game/groundDaily";
import { BEST_GROUND_KEY, dealGround, type GroundMap } from "@/lib/game/onTheGround";
import { loadQuickRecord } from "@/lib/game/quickRecord";
import type { CatalogPhoto } from "@/lib/game/types";
import { GROUND_COVERS, atlasGroundCover, type GroundCover } from "@/lib/trueClues";
import { gameFor } from "@/test/deck";

import OnTheGround from "./OnTheGround";

function record(id: string, cover: GroundCover, atlasClues: string[] | null): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
    lng: 10,
    lat: -33.5,
    place: `Place ${id}`,
    country: "AU",
    landCover: cover,
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
  record("b1", "Built-up", ["City"]),
  record("b2", "Built-up", ["Coast"]),
  record("t1", "Tree cover", ["No buildings"]),
  record("t2", "Tree cover", null),
  record("g1", "Grassland", ["Countryside"]),
  record("w1", "Permanent water bodies", ["Mountains", "Coast"]),
  record("w2", "Permanent water bodies", ["Modern skyline"]),
  record("s1", "Bare / sparse vegetation", ["Arid climate"]),
];
const COVERS: GroundMap = Object.fromEntries(
  RECORDS.map((r) => [r.photo.id, r.photo.landCover as GroundCover]),
);
// random() = 0 deals from seed 0.
const ORDER = dealGround(COVERS, 0);
const truthOf = (n: number) => COVERS[ORDER[n]];
const wrongFor = (c: GroundCover): GroundCover => (c === "Grassland" ? "Built-up" : "Grassland");
const keyOf = (c: GroundCover) => String(GROUND_COVERS.indexOf(c) + 1);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

async function setup() {
  const game = gameFor(RECORDS);
  const loadRecords = vi.fn(game.loadRecords);
  render(
    <OnTheGround deck={game.deck} covers={COVERS} loadRecords={loadRecords} random={() => 0} />,
  );
  await waitFor(() => expect(button("Grassland")).toBeEnabled());
  return { loadRecords };
}

const button = (cover: GroundCover) => screen.getByTestId(`ground-${keyOf(cover)}`);
const photo = () => screen.getByTestId("ground-photo");
const score = () => screen.getByText("Score").nextElementSibling;

describe("OnTheGround", () => {
  it("deals five photos, named on five buttons, showing nothing about the place before a call", async () => {
    expect(ORDER).toHaveLength(5);
    const { loadRecords } = await setup();
    const group = screen.getByRole("group", { name: "Land covers" });
    expect(
      within(group)
        .getAllByRole("button")
        .map((b) => b.firstChild?.textContent),
    ).toEqual(["Built-up", "Trees", "Grassland", "Water", "Bare ground"]);
    expect(photo()).toHaveAttribute("data-photo", ORDER[0]);
    expect(screen.getByText("Photo 1 of 5")).toBeInTheDocument();
    expect(screen.queryByText(/Place /)).toBeNull();
    // The photo on screen and the next one are all that's fetched.
    expect(loadRecords.mock.calls.flat(2)).toEqual(ORDER.slice(0, 2));
  });

  it("reveals the ground on the band of covers, with your call and Atlas's", async () => {
    await setup();
    const truth = truthOf(0);
    const wrong = wrongFor(truth);
    fireEvent.click(button(wrong));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Wrong");
    expect(card).toHaveTextContent("around it:");
    expect(card).toHaveTextContent(`Place ${ORDER[0]} · from the ESA WorldCover map`);
    const band = within(card).getByTestId("ground-band");
    expect(band.querySelector("[aria-current='location']")).toHaveAttribute("data-cover", truth);
    expect(band.querySelector(`[data-cover='${wrong}']`)).toHaveTextContent("You");
    const atlas = atlasGroundCover(RECORDS.find((r) => r.photo.id === ORDER[0])!.atlas);
    if (atlas) expect(band.querySelector(`[data-cover='${atlas}']`)).toHaveTextContent("Atlas");
    expect(score()).toHaveTextContent("0");
    // The next button has focus, so Enter moves on.
    expect(within(card).getByRole("button", { name: "Next photo" })).toHaveFocus();
  });

  it("plays five photos by key, against Atlas, and keeps the best whole game", async () => {
    await setup();
    for (let n = 0; n < 5; n++) {
      await waitFor(() => expect(photo()).toHaveAttribute("data-photo", ORDER[n]));
      await waitFor(() => expect(button("Grassland")).toBeEnabled());
      const pick = n < 3 ? truthOf(n) : wrongFor(truthOf(n));
      fireEvent.keyDown(window, { key: keyOf(pick) });
      const card = await screen.findByRole("region");
      expect(within(card).getByRole("heading")).toHaveTextContent(n < 3 ? "Correct" : "Wrong");
      // No best is kept until the game is whole.
      if (n < 4) expect(localStorage.getItem(BEST_GROUND_KEY)).toBeNull();
      fireEvent.click(
        within(card).getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }),
      );
    }
    expect(await screen.findByRole("heading", { level: 1, name: "3 of 5" })).toBeInTheDocument();
    expect(screen.getAllByTestId("ground-row")).toHaveLength(5);
    expect(screen.getByText("That's your new best!")).toBeInTheDocument();
    expect(localStorage.getItem(BEST_GROUND_KEY)).toBe("3");
    const reads = ORDER.map((id) =>
      atlasGroundCover(RECORDS.find((r) => r.photo.id === id)!.atlas),
    );
    const read = reads.filter((c) => c !== null).length;
    expect(
      screen.getByText(new RegExp(`Atlas's clues named the ground on ${read} of the 5 photos`)),
    ).toBeInTheDocument();
    // Every call counted in your clue reading as it was made, Atlas on the photos it read.
    const atlasRight = reads.filter((c, n) => c === truthOf(n)).length;
    expect(loadQuickRecord()["on-the-ground"].free).toEqual({
      runs: 1,
      rounds: 5,
      right: 3,
      atlasPlayed: read,
      atlasRight,
    });

    // A worse game keeps the best.
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    await waitFor(() => expect(button("Grassland")).toBeEnabled());
    expect(screen.getByText("Best").nextElementSibling).toHaveTextContent("3");
  });

  it("says when Atlas's clues named no cover", async () => {
    // Deal a game whose first photo is the one Atlas sat out.
    const covers: GroundMap = {
      t2: "Tree cover",
      b1: "Built-up",
      g1: "Grassland",
      w1: "Permanent water bodies",
      s1: "Bare / sparse vegetation",
    };
    const game = gameFor(RECORDS);
    let seed = 0;
    while (dealGround(covers, seed)[0] !== "t2") seed++;
    render(
      <OnTheGround
        deck={game.deck}
        covers={covers}
        loadRecords={game.loadRecords}
        random={() => seed / 2 ** 32}
      />,
    );
    await waitFor(() => expect(button("Tree cover")).toBeEnabled());
    fireEvent.click(button("Tree cover"));
    const card = await screen.findByRole("region");
    expect(card).toHaveTextContent("Correct");
    expect(card).toHaveTextContent("Atlas's clues named no ground cover here");
    expect(card).toHaveTextContent("Atlas this game: 0 of 1.");
  });

  it("says so when there are too few photos to deal", async () => {
    const game = gameFor(RECORDS);
    render(
      <OnTheGround deck={game.deck} covers={{ b1: "Built-up" }} loadRecords={game.loadRecords} />,
    );
    expect(await screen.findByText("No photos to play yet")).toBeInTheDocument();
  });
});

describe("OnTheGround, today's game", () => {
  const DAY = "2026-11-19";
  const now = () => new Date(`${DAY}T18:48:00Z`);
  const order = dailyGroundOrder(COVERS, DAY);
  const dayTruth = (n: number) => COVERS[order[n]];

  function play() {
    const game = gameFor(RECORDS);
    return render(
      <OnTheGround
        deck={game.deck}
        covers={COVERS}
        loadRecords={game.loadRecords}
        daily
        now={now}
      />,
    );
  }

  async function call(n: number, cover: GroundCover) {
    await waitFor(() => expect(photo()).toHaveAttribute("data-photo", order[n]));
    await waitFor(() => expect(button("Grassland")).toBeEnabled());
    fireEvent.click(button(cover));
    return screen.findByRole("region");
  }

  it("deals the day's photos, picks up after a reload, and shares the score once all five are called", async () => {
    expect(order).toHaveLength(5);
    const first = play();
    await waitFor(() => expect(button("Grassland")).toBeEnabled());
    expect(screen.getByText(/today's game \(2026-11-19\)/)).toBeInTheDocument();
    expect(screen.queryByText("Best")).toBeNull();
    expect(screen.getByRole("link", { name: "Free games" })).toHaveAttribute(
      "href",
      "/on-the-ground",
    );
    await call(0, dayTruth(0));
    expect(JSON.parse(localStorage.getItem(GROUND_DAILY_KEY)!)[DAY].results).toHaveLength(1);
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
    await waitFor(() => expect(screen.getAllByTestId("ground-row")[0]).toHaveTextContent("Place"));
    expect(screen.getAllByTestId("ground-row")).toHaveLength(5);
    // Today's game keeps its own result, apart from the free games' best, and is read into your
    // clue reading from the day kept, never counted again as a free game.
    expect(localStorage.getItem(BEST_GROUND_KEY)).toBeNull();
    expect(loadQuickRecord()["on-the-ground"].free.rounds).toBe(0);
    expect(loadQuickRecord()["on-the-ground"].daily).toMatchObject({
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
    expect(text).toMatch(
      /^Whereabout · What's on the ground\? · 2026-11-19\n🌱 3 of 5\n🟩🟩🟩🟥🟥\n/,
    );
    for (const r of RECORDS) {
      expect(text).not.toContain(r.photo.id);
      expect(text).not.toContain(r.photo.place);
    }
    for (const cover of GROUND_COVERS) expect(text).not.toContain(cover);
  });

  it("shows the day's result instead of dealing it again once every photo is called", async () => {
    const results = order.map((id) => ({
      id,
      picked: COVERS[id],
      truth: COVERS[id],
      correct: true,
      atlas: null,
    }));
    localStorage.setItem(GROUND_DAILY_KEY, JSON.stringify({ [DAY]: { results } }));
    play();
    expect(await screen.findByRole("heading", { level: 1, name: "5 of 5" })).toBeInTheDocument();
    expect(
      screen.getByText(/Atlas's clues named the ground on none of today's photos\./),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("ground-photo")).toBeNull();
    expect(screen.getByRole("link", { name: "Play a free game" })).toHaveAttribute(
      "href",
      "/on-the-ground",
    );
  });

  it("links the free games to today's game", async () => {
    await setup();
    expect(screen.getByRole("link", { name: "Today's game" })).toHaveAttribute(
      "href",
      "/on-the-ground/daily",
    );
  });
});
