import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import { encodeLineChallenge } from "@/lib/game/lineChallenge";
import { LINE_DAILY_KEY, dailyLineRows, loadLineDay } from "@/lib/game/lineDaily";
import { BEST_LINE_KEY } from "@/lib/game/lineUp";
import type { AtlasGuess, CatalogPhoto } from "@/lib/game/types";
import { stubCanvas } from "@/test/canvas";
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

describe("today's Line them up", () => {
  const DAY = "2026-11-06";
  const now = () => new Date(`${DAY}T10:30:00Z`);

  async function today() {
    const game = gameFor(RECORDS);
    const view = render(
      <LineUp deck={game.deck} loadRecords={game.loadRecords} daily now={now} />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Lock it in" })).toBeEnabled(), {
      timeout: 5000,
    });
    return { ...view, deck: game.deck };
  }

  const lockRow = () => {
    solve();
    fireEvent.click(screen.getByRole("button", { name: "Lock it in" }));
  };

  it("deals the day's first row, and links to the free games", async () => {
    const { deck } = await today();
    expect([...row()].sort()).toEqual([...dailyLineRows(deck.regions, DAY)[0]].sort());
    expect(screen.getByRole("link", { name: "Free games" })).toHaveAttribute("href", "/line-up");
    expect(screen.queryByText("Best")).toBeNull();
  });

  it("keeps a locked row, so a reload picks up at the next with the score", async () => {
    const { unmount, deck } = await today();
    lockRow();
    expect(loadLineDay(DAY)?.results).toHaveLength(1);
    unmount();
    await today();
    expect(screen.getByText("Row 2 of 5")).toBeInTheDocument();
    expect(screen.getByText(String(4))).toBeInTheDocument();
    expect([...row()].sort()).toEqual([...dailyLineRows(deck.regions, DAY)[1]].sort());
  });

  it("ends on the day's result, kept from the free games' best, and never deals it again", async () => {
    const { unmount } = await today();
    for (let i = 0; i < 5; i++) {
      await waitFor(() => expect(screen.getByRole("button", { name: "Lock it in" })).toBeEnabled());
      lockRow();
      fireEvent.click(
        screen.getByRole("button", { name: i < 4 ? "Next row" : "See your score" }),
      );
    }
    const headline = await screen.findByRole("heading", { level: 1, name: "20 in place" });
    expect(headline).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share today's run" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play again" })).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(localStorage.getItem(BEST_LINE_KEY)).toBeNull();
    expect(localStorage.getItem(LINE_DAILY_KEY)).not.toBeNull();

    unmount();
    const game = gameFor(RECORDS);
    render(<LineUp deck={game.deck} loadRecords={game.loadRecords} daily now={now} />);
    expect(await screen.findByRole("heading", { level: 1, name: "20 in place" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lock it in" })).toBeNull();
  });
});

describe("a friend's Line them up challenge", () => {
  // Five rows in a dealt order that isn't already west to east, so each opens just as listed.
  const ROWS_DEALT = [
    ["jp0", "fr0", "us0", "eg0"],
    ["jp1", "fr1", "us1", "eg1"],
    ["jp2", "fr2", "us2", "eg2"],
    ["jp3", "fr3", "us3", "eg3"],
    ["jp4", "fr4", "us4", "eg4"],
  ];
  const FRIEND = [4, 2, 0, 1, 3];

  afterEach(() => window.history.replaceState(null, "", "/"));

  function mockClipboard() {
    const box = { sent: "" };
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (t: string) => void (box.sent = t) },
      configurable: true,
    });
    return box;
  }

  /** Play every row, solving it, and return each row as it opened. */
  async function playAll() {
    const opened: string[][] = [];
    for (let i = 1; i <= 5; i++) {
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Lock it in" })).toBeEnabled(),
      );
      opened.push(row());
      solve();
      fireEvent.click(screen.getByRole("button", { name: "Lock it in" }));
      fireEvent.click(screen.getByRole("button", { name: i < 5 ? "Next row" : "See your score" }));
    }
    return opened;
  }

  it("deals the friend's rows as they opened for them, says the count to beat, and answers", async () => {
    const value = encodeLineChallenge({ rows: ROWS_DEALT, points: FRIEND });
    window.history.replaceState(null, "", `/line-up?challenge=${value}&x=1`);
    await setup();
    expect(screen.getByText("A friend's challenge: 10 in place to beat")).toBeInTheDocument();
    const box = mockClipboard();

    const opened: string[][] = [];
    for (let i = 0; i < 5; i++) {
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Lock it in" })).toBeEnabled(),
      );
      opened.push(row());
      solve();
      fireEvent.click(screen.getByRole("button", { name: "Lock it in" }));
      expect(screen.getByText(new RegExp(`Your friend: ${FRIEND[i]} in place\\.`))).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: i < 4 ? "Next row" : "See your score" }));
    }
    expect(opened).toEqual(ROWS_DEALT);

    // 20 to the friend's 10; a challenge's rows may be known, so it isn't a best.
    expect(screen.getByRole("heading", { name: "20 in place" })).toBeVisible();
    expect(
      screen.getByText(/You won the challenge by 10 in place\. Your friend had 10\./),
    ).toBeVisible();
    expect(screen.getByText("You 4, Atlas 4, friend 2")).toBeVisible();
    expect(screen.queryByText(/new best/)).toBeNull();
    expect(localStorage.getItem(BEST_LINE_KEY)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Send yours back" }));
    await waitFor(() =>
      expect(
        screen.getByText("Challenge link copied. Whoever opens it plays these rows."),
      ).toBeVisible(),
    );
    const rows = ROWS_DEALT.map((r) => r.join(".")).join("-");
    expect(box.sent.split("\n")).toEqual([
      "Whereabout · Line them up: I put 20 of 20 photos in place, west to east.",
      "That beats your 10. Your turn to beat mine.",
      `http://localhost:3000/line-up?challenge=${rows}_4.4.4.4.4`,
    ]);

    // The head to head is drawn row by row in photos in place, saved, and the reply link copied
    // beside it.
    const drawn = stubCanvas();
    const reply = box.sent;
    box.sent = "";
    fireEvent.click(screen.getByRole("button", { name: "Share head to head" }));
    expect(
      await screen.findByText("Head to head saved. Post it with the link, which is copied too."),
    ).toBeVisible();
    expect(drawn.saved).toEqual(["whereabout-line-them-up-head-to-head.png"]);
    expect(drawn.words).toEqual(
      expect.arrayContaining([
        "Line them up: head to head",
        "You won",
        "20 of 20",
        "10 of 20",
        "Row 5",
        "4 of 4 in place",
        "0 of 4 in place",
      ]),
    );
    const all = drawn.words.join("\n");
    for (const id of ROWS_DEALT.flat()) expect(all).not.toContain(id);
    expect(box.sent).toBe(reply);
    drawn.restore();

    // A fresh game leaves the link behind.
    fireEvent.click(screen.getByRole("button", { name: "Play a fresh game" }));
    await waitFor(() => expect(screen.getByText("Line them up: west to east")).toBeVisible());
    expect(window.location.search).toBe("?x=1");
  });

  it("sends a free game's rows so a friend's open exactly as the sender's did", async () => {
    await setup();
    const box = mockClipboard();
    const mine = await playAll();
    fireEvent.click(screen.getByRole("button", { name: "Challenge a friend" }));
    await waitFor(() => expect(box.sent).not.toBe(""));
    expect(box.sent).toContain("Same rows, same start: can you beat me?");
    // Head to head is only for a game that answered a friend's.
    expect(screen.queryByRole("button", { name: "Share head to head" })).toBeNull();
    const link = new URL(box.sent.split("\n")[2]);
    expect(link.searchParams.get("challenge")).toMatch(/_4\.4\.4\.4\.4$/);
    cleanup();

    window.history.replaceState(null, "", `${link.pathname}${link.search}`);
    await setup();
    expect(screen.getByText("A friend's challenge: 20 in place to beat")).toBeInTheDocument();
    expect(await playAll()).toEqual(mine);
  });

  it("deals a fresh game, and says why, when the link is cut short or its photos have gone", async () => {
    window.history.replaceState(null, "", "/line-up?challenge=jp0.fr0.us0_4&x=1");
    await setup();
    expect(screen.getByText(/That challenge link was cut short/)).toBeVisible();
    expect(screen.getByText("Line them up: west to east")).toBeVisible();
    expect(window.location.search).toBe("?x=1");
    cleanup();

    const gone = ROWS_DEALT.map((r, i) => (i === 4 ? [...r.slice(0, 3), "gone"] : r));
    window.history.replaceState(
      null,
      "",
      `/line-up?challenge=${encodeLineChallenge({ rows: gone, points: FRIEND })}`,
    );
    await setup();
    expect(screen.getByText(/That challenge's photos aren't in the game any more/)).toBeVisible();
  });
});
