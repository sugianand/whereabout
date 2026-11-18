import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Continent } from "@/lib/continents";
import type { GameRecord } from "@/lib/game/deck";
import type { PlayedPhoto } from "@/lib/playedMap";

import Album, { ALBUM_FIRST } from "./Album";

const THUMB =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Some_place.jpg/1280px-Some_place.jpg";

function played(id: string, km: number | null = 120): PlayedPhoto {
  return {
    id,
    lng: 2.35,
    lat: 48.86,
    place: `Place ${id}`,
    country: "FR",
    km,
    score: 4000,
    day: "2026-11-18",
  };
}

function record(id: string): GameRecord {
  return {
    photo: {
      id,
      imageUrl: THUMB,
      lng: 2.35,
      lat: 48.86,
      place: `Place ${id}`,
      country: "FR",
      credit: {
        author: `Author ${id}`,
        license: "CC BY-SA 4.0",
        sourceUrl: `https://commons.wikimedia.org/wiki/File:${id}.jpg`,
      },
    },
    atlas: null,
  };
}

// Twelve European photos, two in Asia and one in Antarctica, which can't fill a game.
const continents: Record<string, Continent> = {
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`e${i}`, "Europe" as Continent])),
  a0: "Asia",
  a1: "Asia",
  q0: "Antarctica",
};
const deck = {
  version: "v1",
  regions: { Europe: ["e0"], Asia: ["a0"] },
};

function section(name: string) {
  return screen.getByRole("region", { name });
}

describe("Album", () => {
  it("says how many photos are found and invites a first game when none are", () => {
    render(<Album deck={deck} continents={continents} history={[]} loadRecord={vi.fn()} />);
    expect(screen.getByTestId("album-found")).toHaveTextContent("0");
    expect(screen.getByText(/of 15 photos found/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Play a game →" })).toHaveAttribute("href", "/");
    // Every continent still shows what it holds, with a game there when it can fill one.
    const asia = section("Asia");
    expect(within(asia).getByText("0 of 2 found")).toBeInTheDocument();
    expect(within(asia).getByRole("link", { name: "Play Asia →" })).toHaveAttribute(
      "href",
      "/?region=asia",
    );
    expect(within(section("Antarctica")).queryByRole("link")).toBeNull();
  });

  it("shows each found photo under its continent with its picture, distance and credit", async () => {
    const loadRecord = vi.fn(async (id: string) => record(id));
    render(
      <Album
        deck={deck}
        continents={continents}
        history={[played("a0", 42), played("e3", null)]}
        loadRecord={loadRecord}
      />,
    );
    expect(screen.getByTestId("album-found")).toHaveTextContent("2");
    const asia = section("Asia");
    expect(within(asia).getByText("1 of 2 found")).toBeInTheDocument();
    expect(within(asia).getByText("Place a0")).toBeInTheDocument();
    expect(within(asia).getByText("42 km off")).toBeInTheDocument();
    expect(within(asia).getByText("photo still to find")).toBeInTheDocument();
    expect(within(section("Europe")).getByText("No pin")).toBeInTheDocument();
    expect(within(section("Europe")).getByText("11")).toBeInTheDocument();

    const img = await within(asia).findByRole("img", { name: "Your photo from Place a0" });
    expect(img.getAttribute("src")).toContain("/500px-Some_place.jpg");
    expect(within(asia).getByRole("link", { name: "Author a0" })).toHaveAttribute(
      "href",
      "https://commons.wikimedia.org/wiki/File:a0.jpg",
    );
    // Only found photos' records are asked for: nothing about the rest reaches the browser.
    expect(loadRecord.mock.calls.map(([id]) => id).sort()).toEqual(["a0", "e3"]);
  });

  it("drops the to-find card once a continent is complete", () => {
    render(
      <Album
        deck={deck}
        continents={continents}
        history={[played("a0"), played("a1")]}
        loadRecord={vi.fn(async (id: string) => record(id))}
      />,
    );
    expect(within(section("Asia")).getByText("2 of 2 found")).toBeInTheDocument();
    expect(within(section("Asia")).queryByTestId("album-left")).toBeNull();
  });

  it("shows a continent's first photos, then all of them, loading the rest only when asked", async () => {
    const loadRecord = vi.fn(async (id: string) => record(id));
    const history = Array.from({ length: 12 }, (_, i) => played(`e${i}`));
    render(<Album deck={deck} continents={continents} history={history} loadRecord={loadRecord} />);
    const europe = section("Europe");
    expect(within(europe).getAllByTestId("album-photo")).toHaveLength(ALBUM_FIRST);
    // Newest first: the last one played leads.
    expect(within(europe).getAllByTestId("album-photo")[0]).toHaveTextContent("Place e11");
    await waitFor(() => expect(loadRecord).toHaveBeenCalledTimes(ALBUM_FIRST));

    fireEvent.click(within(europe).getByRole("button", { name: "Show all 12 from Europe" }));
    expect(within(europe).getAllByTestId("album-photo")).toHaveLength(12);
    expect(within(europe).queryByRole("button")).toBeNull();
    await waitFor(() => expect(loadRecord).toHaveBeenCalledTimes(12));
  });

  it("keeps a photo's card when its record can't be had", async () => {
    render(
      <Album
        deck={deck}
        continents={continents}
        history={[played("a0")]}
        loadRecord={vi.fn(async () => Promise.reject(new Error("offline")))}
      />,
    );
    await waitFor(() => expect(within(section("Asia")).getByText("Place a0")).toBeInTheDocument());
    expect(within(section("Asia")).queryByRole("img")).toBeNull();
  });
});
