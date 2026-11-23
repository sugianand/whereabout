import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import { BEST_HOTTEST_KEY, BEST_SPOT_KEY, dealSpot } from "@/lib/game/spotClue";
import { SPOT_DAILY_KEY, dailySpotOrder, loadSpotDay } from "@/lib/game/spotDaily";
import { loadSpotRead } from "@/lib/game/spotRead";
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
    // Atlas's hottest found on two photos, kept for Mind reader on Stamps.
    expect(localStorage.getItem(BEST_HOTTEST_KEY)).toBe("2");
    expect(screen.getAllByTestId("spot-row")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Play again" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    await screen.findByRole("button", { name: "Lock in row 2, column 2" });
    expect(screen.getByText("3,500", { selector: "dd" })).toBeInTheDocument();
  });
});

describe("today's Spot the clue", () => {
  const DAY = "2026-11-23";
  const now = () => new Date(`${DAY}T12:00:00Z`);
  const TODAY = dailySpotOrder(IDS, DAY);

  function renderDaily() {
    const game = gameFor(RECORDS);
    return render(
      <SpotClue deck={game.deck} ids={IDS} loadRecords={game.loadRecords} daily now={now} />,
    );
  }

  async function answer(n: number, hottest: boolean) {
    await waitFor(() => expect(photoOn()).toBe(TODAY[n]));
    if (hottest) fireEvent.click(await screen.findByRole("button", { name: "Row 3, column 1" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Lock in/ }));
    const card = await screen.findByRole("region");
    fireEvent.click(
      within(card).getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }),
    );
  }

  it("deals the day's five, keeps each square, and picks up after a reload at the next photo", async () => {
    localStorage.setItem(BEST_SPOT_KEY, "1200");
    const { unmount } = renderDaily();
    expect(await screen.findByText("Spot the clue, today: what told Atlas?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Free games" })).toHaveAttribute(
      "href",
      "/spot-the-clue",
    );
    // Today's game has no best of its own.
    expect(screen.queryByText("Best")).toBeNull();
    await answer(0, true);
    await answer(1, false);
    expect(loadSpotDay(DAY)?.results.map((r) => [r.id, r.points])).toEqual([
      [TODAY[0], 1000],
      [TODAY[1], 500],
    ]);

    unmount();
    renderDaily();
    await waitFor(() => expect(photoOn()).toBe(TODAY[2]));
    expect(screen.getByText("Photo 3 of 5")).toBeInTheDocument();
    expect(screen.getByText("1,500", { selector: "dd" })).toBeInTheDocument();
    await answer(2, false);
    await answer(3, true);
    await answer(4, false);

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("3,500 points");
    expect(screen.getByText(`Spot the clue · today's game · ${DAY}`)).toBeInTheDocument();
    expect(
      screen.getByText(/You found Atlas's most telling square on 2 of 5 photos\./),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("spot-row")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Share today's game" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Play a free game" })).toHaveAttribute(
      "href",
      "/spot-the-clue",
    );
    // The free game's best is untouched, and so is its most hottest found: Stamps reads the day.
    expect(localStorage.getItem(BEST_SPOT_KEY)).toBe("1200");
    expect(localStorage.getItem(BEST_HOTTEST_KEY)).toBeNull();
    // Each square counted once toward your read of Atlas, the reload taking none back or twice.
    expect(loadSpotRead()).toEqual({
      picked: 5,
      warm: 5,
      hottest: 2,
      away: 3,
      you: [0, 0, 0, 0, 3, 0, 2, 0, 0],
      atlas: [0, 0, 0, 0, 0, 0, 5, 0, 0],
    });
  });

  it("shows a finished day's result instead of dealing it again, scored from the maps", async () => {
    // A forged day claiming the full points on every photo, on squares worth nothing.
    const forged = TODAY.map((id) => ({ id, cell: 0, points: 1000, hottest: false }));
    localStorage.setItem(SPOT_DAILY_KEY, JSON.stringify({ [DAY]: { results: forged } }));
    renderDaily();
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^0 points$/),
    );
    expect(screen.queryByRole("group", { name: /grid of/ })).toBeNull();
    expect(screen.getAllByTestId("spot-row")[0]).toHaveTextContent("Cold: 0 points");
    // A day read back from storage adds nothing to your read of Atlas.
    expect(loadSpotRead().picked).toBe(0);
  });

  it("links to today's game from a free one", async () => {
    await setup();
    expect(screen.getByRole("link", { name: "Today's game" })).toHaveAttribute(
      "href",
      "/spot-the-clue/daily",
    );
  });
});

function useClipboard() {
  const sent = { text: "" };
  Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: async (t: string) => void (sent.text = t) },
    configurable: true,
  });
  return sent;
}

describe("a Spot the clue challenge", () => {
  // The friend played s6, s1, s2, s3 and s4 in that order: the hottest square, the middle, a cold
  // corner, the hottest and the middle again: 3,000 points to beat.
  const LINKED = ["s6", "s1", "s2", "s3", "s4"];
  const FRIEND = "s6.s1.s2.s3.s4_6.4.0.6.4";

  afterEach(() => window.history.replaceState(null, "", "/"));

  it("deals the friend's five, shows their square once yours is in, and sends yours back", async () => {
    const sent = useClipboard();
    window.history.replaceState(null, "", `/spot-the-clue?challenge=${FRIEND}`);
    await setup();
    // Every map arrives up front, so the friend's squares are scored before the first photo.
    await waitFor(() => expect(screen.getByTestId("spot-challenge")).toHaveTextContent("3,000"));
    expect(screen.queryByText("Best")).toBeNull();
    for (const [i, id] of LINKED.entries()) {
      await waitFor(() => expect(photoOn()).toBe(id));
      expect(screen.getByTestId("spot-friend-score")).toHaveTextContent(
        ["0", "1,000", "1,500", "1,500", "2,500"][i]!,
      );
      // The friend's square stays hidden until yours is locked in.
      expect(screen.queryByTestId("spot-friend")).toBeNull();
      // You: the hottest on the first three, the middle on the last two: 4,000.
      if (i < 3) fireEvent.click(await screen.findByRole("button", { name: "Row 3, column 1" }));
      fireEvent.keyDown(window, { key: "g" });
      const card = await screen.findByRole("region");
      const line = within(card).getByTestId("spot-friend-line");
      if (i === 0) {
        expect(line).toHaveTextContent("Friend: the same square, 1,000 points.");
      } else if (i === 1) {
        expect(line).toHaveTextContent("Friend (red): row 2, column 2, 500 points.");
      } else if (i === 2) {
        expect(line).toHaveTextContent("Friend (red): row 1, column 1, 0 points.");
      }
      expect(screen.getByTestId("spot-friend")).toHaveAttribute(
        "data-cell",
        FRIEND.split("_")[1]!.split(".")[i],
      );
      fireEvent.click(
        within(card).getByRole("button", { name: i === 4 ? "See the results" : "Next photo" }),
      );
    }
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("4,000 points");
    expect(screen.getByTestId("spot-challenge-line")).toHaveTextContent(
      "You beat your friend's 3,000 by 1,000.",
    );
    expect(screen.getAllByTestId("spot-row")[2]).toHaveTextContent(
      "You: 1,000 points (spot on)Friend: 0 points (cold)",
    );
    // A challenge's photos were picked by someone who had seen them: never a best.
    expect(localStorage.getItem(BEST_SPOT_KEY)).toBeNull();
    expect(localStorage.getItem(BEST_HOTTEST_KEY)).toBeNull();
    expect(screen.queryByText(/new best/)).toBeNull();
    expect(screen.getByRole("button", { name: "Share head to head" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send yours back" }));
    await waitFor(() => expect(sent.text).not.toBe(""));
    expect(sent.text.split("\n")).toEqual([
      "Whereabout · Spot the clue: 4,000 points, Atlas's most telling square found on 3 of 5.",
      "That beats your 3,000. Your turn to read Atlas.",
      "http://localhost:3000/spot-the-clue?challenge=s6.s1.s2.s3.s4_6.6.6.4.4",
    ]);
    for (const id of LINKED) expect(sent.text).not.toContain(byId.get(id)!.photo.place);

    fireEvent.click(screen.getByRole("button", { name: "Play a fresh game" }));
    await waitFor(() => expect(screen.queryByTestId("spot-challenge")).toBeNull());
    expect(window.location.search).toBe("");
  });

  it.each([
    ["s6.s1.s2.s3_6.4.0.6", "That challenge link was cut short, so here's a fresh game instead."],
    [
      "s6.s1.s2.s3.zz_6.4.0.6.4",
      "That challenge's photos aren't in the game any more, so here's a fresh game instead.",
    ],
  ])("sets the link %s aside for a fresh game", async (value, notice) => {
    window.history.replaceState(null, "", `/spot-the-clue?challenge=${value}`);
    await setup();
    expect(await screen.findByText(notice)).toBeInTheDocument();
    expect(screen.queryByTestId("spot-challenge")).toBeNull();
    expect(window.location.search).toBe("");
    expect(photoOn()).toBe(ORDER[0]);
  });

  it("offers a whole free game to a friend, with no head to head", async () => {
    const sent = useClipboard();
    await setup();
    for (let n = 0; n < 5; n++) {
      await waitFor(() => expect(photoOn()).toBe(ORDER[n]));
      fireEvent.keyDown(window, { key: "g" });
      const card = await screen.findByRole("region");
      expect(within(card).queryByTestId("spot-friend-line")).toBeNull();
      fireEvent.click(
        within(card).getByRole("button", { name: n === 4 ? "See the results" : "Next photo" }),
      );
    }
    fireEvent.click(await screen.findByRole("button", { name: "Challenge a friend" }));
    await waitFor(() => expect(sent.text).not.toBe(""));
    expect(sent.text).toContain(`?challenge=${ORDER.join(".")}_4.4.4.4.4`);
    expect(sent.text).toContain("Same five photos: can you tell what Atlas looked at?");
    expect(screen.queryByRole("button", { name: "Share head to head" })).toBeNull();
  });
});
