import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import { BEST_ODD_KEY } from "@/lib/game/oddOneOut";
import type { CatalogPhoto } from "@/lib/game/types";
import { gameFor } from "@/test/deck";

import OddOneOut from "./OddOneOut";

function record(id: string, country: string, atlasCountry: string | null): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
    lng: 10,
    lat: 45,
    place: `Place ${id}`,
    country,
    credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  return {
    photo,
    atlas:
      atlasCountry === null
        ? null
        : {
            lng: 10,
            lat: 45,
            confidence: 0.5,
            topCountries: [{ country: atlasCountry, p: 0.5 }],
            clues: [],
          },
  };
}

// Five European photos (Atlas reads each as European) and five Japanese ones, which Atlas
// reads as Asian, except j5, which it never guessed. Only two continents can fill a game, so
// every quad is three from one and one from the other.
const RECORDS = [
  ...[1, 2, 3, 4, 5].map((i) => record(`e${i}`, "FR", "FR")),
  ...[1, 2, 3, 4].map((i) => record(`j${i}`, "JP", "JP")),
  record("j5", "JP", null),
];

beforeEach(() => {
  localStorage.clear();
});

async function setup(random: () => number = () => 0) {
  const game = gameFor(RECORDS);
  const loadRecords = vi.fn(game.loadRecords);
  render(<OddOneOut deck={game.deck} loadRecords={loadRecords} random={random} />);
  await waitFor(() => expect(tap(1)).toBeEnabled(), { timeout: 5000 });
  return { loadRecords };
}

const tap = (n: number) => screen.getByRole("button", { name: `Photo ${n} is the odd one out` });
const streak = () => screen.getByText("Streak").nextElementSibling;
const shownIds = () =>
  [1, 2, 3, 4].map((n) => screen.getByTestId(`odd-photo-${n}`).getAttribute("data-photo")!);

/** The slot (1–4) holding the photo whose continent appears once. */
function oddSlot(): number {
  const ids = shownIds();
  const europe = ids.filter((id) => id.startsWith("e")).length;
  return ids.findIndex((id) => id.startsWith(europe === 1 ? "e" : "j")) + 1;
}

describe("OddOneOut", () => {
  it("deals four photos with no place until a tap, and loads the next four ahead", async () => {
    const { loadRecords } = await setup();
    const ids = shownIds();
    expect(new Set(ids).size).toBe(4);
    expect(screen.getAllByRole("img")).toHaveLength(4);
    expect(screen.queryByText(/Place /)).toBeNull();
    // The quad on screen and the one after it (e2 with the three Asian photos again, since Asia
    // has no three fresh ones left), and nothing else.
    expect(new Set(loadRecords.mock.calls.flat(2))).toEqual(new Set([...ids, "e2"]));
  });

  it("reveals every photo's continent and Atlas's pick, then deals four more", async () => {
    // random() = 0 takes the first continent that can give three (Asia, before Europe), the
    // first fresh photos of each and puts the odd one first: e1, then j1, j2, j3.
    await setup();
    const before = shownIds();
    expect(before).toEqual(["e1", "j1", "j2", "j3"]);
    fireEvent.click(tap(1));
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Right");
    expect(card).toHaveTextContent("Photo 1 was taken in Europe; the other three in Asia.");
    expect(within(screen.getByTestId("odd-photo-1")).getByText("Europe")).toBeVisible();
    expect(within(screen.getByTestId("odd-photo-2")).getByText("Asia")).toBeVisible();
    expect(screen.getByTestId("odd-photo-2")).toHaveTextContent("Place j1");
    expect(card).toHaveTextContent(
      "Atlas read photo 1 as Europe and the rest as Asia, so it picked photo 1, and got it. Atlas this run: 1 of 1 quad.",
    );
    expect(within(screen.getByTestId("odd-photo-1")).getByText("Atlas's pick")).toBeVisible();
    expect(streak()).toHaveTextContent("1");
    expect(localStorage.getItem(BEST_ODD_KEY)).toBe("1");

    fireEvent.click(within(card).getByRole("button", { name: "Next four" }));
    await waitFor(() => expect(tap(1)).toBeEnabled());
    expect(screen.queryByRole("region")).toBeNull();
    expect(shownIds()).not.toEqual(before);
  });

  it("ends the run on a wrong tap, made with the keyboard, and starts a new one", async () => {
    await setup(Math.random);
    const right = oddSlot();
    fireEvent.click(tap(right));
    fireEvent.click(await screen.findByRole("button", { name: "Next four" }));
    await waitFor(() => expect(tap(1)).toBeEnabled());
    const wrong = (oddSlot() % 4) + 1;
    fireEvent.keyDown(window, { key: String(wrong) });
    const card = await screen.findByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent("Wrong");
    expect(card).toHaveTextContent("Run over: 1 quad in a row. That's your new best!");
    expect(screen.getByTestId(`odd-photo-${wrong}`).className).toContain("border-flare");

    fireEvent.click(within(card).getByRole("button", { name: "Start a new run" }));
    await waitFor(() => expect(tap(1)).toBeEnabled());
    expect(streak()).toHaveTextContent("0");
    expect(screen.getByText("Best").nextElementSibling).toHaveTextContent("1");
  });

  it("says so when the deck has only one continent to deal from", async () => {
    const game = gameFor(RECORDS.slice(0, 5));
    render(<OddOneOut deck={game.deck} loadRecords={game.loadRecords} />);
    expect(await screen.findByRole("heading", { name: "No photos to play yet" })).toBeVisible();
  });
});
