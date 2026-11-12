import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import { BEST_LEFT_RIGHT_KEY, leftRightOrder, type SideMap } from "@/lib/game/leftRight";
import type { CatalogPhoto } from "@/lib/game/types";
import { gameFor } from "@/test/deck";

import LeftRight from "./LeftRight";

function record(
  id: string,
  country: string,
  side: "left" | "right",
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
  record("j1", "JP", "left", guess(["Drives on the left"], "JP")),
  record("j2", "JP", "left", guess([], "KR")),
  record("f1", "FR", "right", guess([], "FR")),
  record("f2", "FR", "right", null),
  record("f3", "FR", "right", guess(["Drives on the left"], "GB")),
];
const SIDES: SideMap = Object.fromEntries(RECORDS.map((r) => [r.photo.id, r.photo.drivingSide!]));
// random() = 0 deals from seed 0.
const ORDER = leftRightOrder(SIDES, 0);
const byId = new Map(RECORDS.map((r) => [r.photo.id, r]));
const sideOf = (n: number) => byId.get(ORDER[n])!.photo.drivingSide!;
const other = (side: "left" | "right") => (side === "left" ? "right" : "left");

beforeEach(() => localStorage.clear());
afterEach(cleanup);

async function setup() {
  const game = gameFor(RECORDS);
  const loadRecords = vi.fn(game.loadRecords);
  render(<LeftRight deck={game.deck} sides={SIDES} loadRecords={loadRecords} random={() => 0} />);
  await waitFor(() => expect(button("left")).toBeEnabled());
  return { loadRecords };
}

const button = (side: "left" | "right") =>
  screen.getByRole("button", { name: `They drive on the ${side}` });
const photo = () => screen.getByTestId("side-photo");
const streak = () => screen.getByText("Streak").nextElementSibling;

describe("LeftRight", () => {
  it("deals an even run, one photo at a time, with nothing about the place until a call", async () => {
    expect(ORDER.length).toBeGreaterThanOrEqual(2);
    const { loadRecords } = await setup();
    expect(photo()).toHaveAttribute("data-photo", ORDER[0]);
    expect(screen.queryByText(/Place /)).toBeNull();
    expect(screen.queryByText(/Drives on the/)).toBeNull();
    // Only the photo on screen and the one dealt next are fetched.
    expect(loadRecords.mock.calls.flat(2)).toEqual(ORDER.slice(0, 2));
  });

  it("reveals the country's side and Atlas's read, and plays on after a right call", async () => {
    await setup();
    const first = byId.get(ORDER[0])!;
    fireEvent.click(button(sideOf(0)));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Correct");
    const country = first.photo.country === "JP" ? "Japan" : "France";
    expect(card).toHaveTextContent(`In ${country} they drive on the ${sideOf(0)}.`);
    expect(card).toHaveTextContent(`Place ${ORDER[0]}`);
    expect(photo()).toHaveTextContent(`Drives on the ${sideOf(0)}`);
    if (first.atlas) expect(card).toHaveTextContent(/Atlas this run: [01] of 1 photo\./);
    expect(streak()).toHaveTextContent("1");
    expect(localStorage.getItem(BEST_LEFT_RIGHT_KEY)).toBe("1");

    const next = within(card).getByRole("button", { name: "Next photo" });
    expect(next).toHaveFocus();
    fireEvent.click(next);
    await waitFor(() => expect(photo()).toHaveAttribute("data-photo", ORDER[1]));
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("ends the run on a wrong call, says the best, and deals a new run", async () => {
    localStorage.setItem(BEST_LEFT_RIGHT_KEY, "4");
    await setup();
    fireEvent.click(button(other(sideOf(0))));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Wrong");
    expect(card).toHaveTextContent("Run over: 0 photos in a row. Your best is 4 photos.");
    expect(localStorage.getItem(BEST_LEFT_RIGHT_KEY)).toBe("4");
    fireEvent.click(within(card).getByRole("button", { name: "Start a new run" }));
    await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
    expect(streak()).toHaveTextContent("0");
  });

  it("judges Atlas on what it read: its road clue first, else its top country", async () => {
    // A run with only f3 and j2: Atlas read "left" for the French photo from a clue, and picked
    // South Korea (right-hand traffic) for the Japanese one.
    const sides: SideMap = { f3: "right", j2: "left" };
    const game = gameFor(RECORDS);
    const order = leftRightOrder(sides, 0);
    render(
      <LeftRight deck={game.deck} sides={sides} loadRecords={game.loadRecords} random={() => 0} />,
    );
    await waitFor(() => expect(button("left")).toBeEnabled());
    fireEvent.click(button(sides[order[0]]));
    const card = await screen.findByRole("region");
    expect(card).toHaveTextContent(
      order[0] === "f3"
        ? "Atlas read the left from the photo: wrong."
        : "Atlas picked South Korea, where they drive on the right: wrong.",
    );
  });

  it("takes the call from the arrow keys", async () => {
    await setup();
    fireEvent.keyDown(window, { key: sideOf(0) === "left" ? "ArrowLeft" : "ArrowRight" });
    expect(await screen.findByRole("heading", { name: "Correct" })).toBeInTheDocument();
  });

  it("takes a swipe past the threshold as a call, and springs back from a short one", async () => {
    await setup();
    const el = photo();
    Object.defineProperty(el, "clientWidth", { value: 400, configurable: true });
    const toward = sideOf(0) === "left" ? -1 : 1;
    // 400px wide: a call needs 100px. 60px is let go short and makes no call.
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 200 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + toward * 60 });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 200 + toward * 60 });
    expect(screen.queryByRole("region")).toBeNull();
    expect(el.style.transform).toBe("");

    fireEvent.pointerDown(el, { pointerId: 2, clientX: 200 });
    fireEvent.pointerMove(el, { pointerId: 2, clientX: 200 + toward * 130 });
    fireEvent.pointerUp(el, { pointerId: 2, clientX: 200 + toward * 130 });
    expect(await screen.findByRole("heading", { name: "Correct" })).toBeInTheDocument();
  });

  it("says so when there are no photos from both sides to deal", async () => {
    const game = gameFor(RECORDS);
    render(<LeftRight deck={game.deck} sides={{ f1: "right" }} loadRecords={game.loadRecords} />);
    expect(
      await screen.findByRole("heading", { name: "No photos to play yet" }),
    ).toBeInTheDocument();
  });
});
