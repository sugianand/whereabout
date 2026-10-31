import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import { BEST_NORTH_KEY } from "@/lib/game/furtherNorth";
import { NORTH_DAILY_KEY, dailyNorthOrder } from "@/lib/game/northDaily";
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

describe("FurtherNorth, today's run", () => {
  // Every latitude a few degrees apart, so no pair is a dead heat whatever order the day deals.
  const LATS: Record<string, number> = { d1: 60, d2: 40, d3: 20, d4: 0, d5: -20 };
  const DAILY = Object.entries(LATS).map(([id, lat]) => record(id, lat, lat));
  const DAY = "2026-10-31";
  const now = () => new Date(`${DAY}T18:48:00Z`);
  const order = dailyNorthOrder(Object.keys(LATS), DAY);
  /** The photo (1 or 2) really further north in the pair starting at `index`. */
  const north = (index: number) => (LATS[order[index]] > LATS[order[index + 1]] ? 1 : 2);

  function play() {
    const game = gameFor(DAILY);
    return render(<FurtherNorth deck={game.deck} loadRecords={game.loadRecords} daily now={now} />);
  }

  it("deals the day's order, picks the run back up after a reload, and ends on a miss", async () => {
    const first = play();
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    expect(screen.getByTestId("north-photo-1")).toHaveAttribute("data-photo", order[0]);
    expect(screen.getByTestId("north-photo-2")).toHaveAttribute("data-photo", order[1]);
    expect(screen.getByText(/today's run \(2026-10-31\)/)).toBeInTheDocument();
    expect(screen.queryByText("Best")).toBeNull();
    fireEvent.click(pickButton(north(0)));
    await screen.findByRole("button", { name: "Next pair" });
    first.unmount();

    // A reload carries on at the next pair, with the streak so far: no fresh start.
    play();
    await waitFor(() => expect(pickButton(1)).toBeEnabled());
    expect(screen.getByTestId("north-photo-1")).toHaveAttribute("data-photo", order[1]);
    expect(streak()).toHaveTextContent("1");

    fireEvent.click(pickButton(north(1) === 1 ? 2 : 1));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Wrong");
    expect(card).toHaveTextContent("Today's run is over: 1 pair in a row.");
    expect(within(card).queryByRole("button", { name: "Start a new run" })).toBeNull();
    expect(within(card).getByRole("link", { name: "Play a free run" })).toHaveAttribute(
      "href",
      "/further-north",
    );
    expect(JSON.parse(localStorage.getItem(NORTH_DAILY_KEY)!)).toEqual({
      [DAY]: { streak: 1, atlasRight: 2, atlasPlayed: 2, ended: "miss" },
    });
    // Today's run keeps its own result, apart from the free runs' best.
    expect(localStorage.getItem(BEST_NORTH_KEY)).toBeNull();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    fireEvent.click(within(card).getByRole("button", { name: "Share today's run" }));
    expect(await within(card).findByText("Result copied. Paste it anywhere.")).toBeVisible();
    expect(writeText.mock.calls[0][0]).toMatch(
      /^Whereabout · Further North · 2026-10-31\n⬆️ 1 pair in a row\n🟩🟥\nAtlas: 2 of 2\n/,
    );
  });

  it("shows the day's result instead of dealing it again once it has ended", async () => {
    localStorage.setItem(
      NORTH_DAILY_KEY,
      JSON.stringify({ [DAY]: { streak: 4, atlasRight: 1, atlasPlayed: 3, ended: "miss" } }),
    );
    play();
    expect(await screen.findByRole("heading", { name: "4 pairs in a row" })).toBeInTheDocument();
    expect(
      screen.getByText(/Atlas got 1 of the 3 pairs it played\. The next run is dealt in 5h 12m\./),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share today's run" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: /was taken further north/ })).toBeNull();
  });

  it("links free runs and today's run to each other", async () => {
    const game = gameFor(DAILY);
    render(<FurtherNorth deck={game.deck} loadRecords={game.loadRecords} random={() => 0} />);
    expect(await screen.findByRole("link", { name: "Today's run" })).toHaveAttribute(
      "href",
      "/further-north/daily",
    );
  });
});
