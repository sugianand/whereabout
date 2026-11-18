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

function record(id: string, atlas: { lng: number; lat: number } | null = null): GameRecord {
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
      postcard: {
        description: `About ${id}.`,
        article: { title: `Article ${id}`, url: `https://en.wikipedia.org/wiki/${id}` },
      },
    },
    atlas: atlas && { ...atlas, confidence: 0.5, topCountries: [], clues: [] },
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
    expect(within(asia).getByRole("link", { name: "Find them in Asia →" })).toHaveAttribute(
      "href",
      "/?find=asia",
    );
    // Nothing found yet: a first game, not "find the rest".
    expect(screen.queryByRole("link", { name: "Find the rest →" })).toBeNull();
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
    // The rest of the album is still to find, from anywhere.
    expect(screen.getByRole("link", { name: "Find the rest →" })).toHaveAttribute(
      "href",
      "/?find",
    );
  });

  it("says when the album is full, with nothing left to find", () => {
    const all = Object.keys(continents).map((id) => played(id));
    render(
      <Album
        deck={deck}
        continents={continents}
        history={all}
        loadRecord={vi.fn(async (id: string) => record(id))}
      />,
    );
    expect(screen.getByText(/Your album is full/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Find/ })).toBeNull();
    expect(screen.queryByTestId("album-left")).toBeNull();
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
    expect(within(europe).queryByRole("button", { name: /^Show all/ })).toBeNull();
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

  describe("a photo opened from the album", () => {
    // Three found in Europe, newest first: e2, e1, e0. Atlas guessed each spot exactly.
    const history = [played("e0", 900), played("e1", 15), played("e2", null)];
    const exact = (id: string) => record(id, { lng: 2.35, lat: 48.86 });

    function openFirst() {
      render(
        <Album
          deck={deck}
          continents={continents}
          history={history}
          loadRecord={vi.fn(async (id: string) => exact(id))}
        />,
      );
      const opener = screen.getByRole("button", { name: "Open your photo from Place e2" });
      opener.focus();
      fireEvent.click(opener);
      return { dialog: screen.getByRole("dialog", { name: "Place e2" }), opener };
    }

    it("shows the photo large with the day found, both distances, the verdict and its postcard", async () => {
      const { dialog } = openFirst();
      expect(within(dialog).getByText("Europe · 1 of 3")).toBeInTheDocument();
      expect(within(dialog).getByText("Found 2026-11-18")).toBeInTheDocument();
      expect(within(dialog).getByText("No pin")).toBeInTheDocument();
      expect(await within(dialog).findByText("Atlas")).toBeInTheDocument();
      expect(within(dialog).getByText("About e2.", { exact: false })).toBeInTheDocument();
      expect(
        within(dialog).getByRole("link", { name: "Read about Article e2 on Wikipedia" }),
      ).toHaveAttribute("href", "https://en.wikipedia.org/wiki/e2");
      const img = within(dialog).getByRole("img", { name: "Your photo from Place e2" });
      expect(img.getAttribute("srcset")).toContain("1280px-Some_place.jpg");
      // Focus starts on Close, inside the dialog.
      expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
    });

    it("turns through the continent with the arrow keys and the buttons, held at both ends", async () => {
      const { dialog } = openFirst();
      expect(within(dialog).getByRole("button", { name: "Previous photo" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      fireEvent.keyDown(dialog, { key: "ArrowLeft" });
      expect(within(dialog).getByText("Europe · 1 of 3")).toBeInTheDocument();

      fireEvent.keyDown(dialog, { key: "ArrowRight" });
      expect(screen.getByRole("dialog", { name: "Place e1" })).toBeInTheDocument();
      expect(within(dialog).getByText("Europe · 2 of 3")).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: "Next photo" }));
      expect(screen.getByRole("dialog", { name: "Place e0" })).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Next photo" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      fireEvent.click(within(dialog).getByRole("button", { name: "Next photo" }));
      expect(screen.getByRole("dialog", { name: "Place e0" })).toBeInTheDocument();
      // Atlas guessed the spot itself, 900 km closer than the pin.
      expect(await within(dialog).findByText("Atlas got closer")).toBeInTheDocument();
    });

    it("turns the page on a sideways swipe across the photo, not on a tap", () => {
      const { dialog } = openFirst();
      const frame = within(dialog).getByTestId("album-viewer-photo");
      fireEvent.pointerDown(frame, { clientX: 300, clientY: 100 });
      fireEvent.pointerUp(frame, { clientX: 302, clientY: 101 });
      expect(within(dialog).getByText("Europe · 1 of 3")).toBeInTheDocument();
      fireEvent.pointerDown(frame, { clientX: 300, clientY: 100 });
      fireEvent.pointerUp(frame, { clientX: 180, clientY: 110 });
      expect(within(dialog).getByText("Europe · 2 of 3")).toBeInTheDocument();
      fireEvent.pointerDown(frame, { clientX: 100, clientY: 100 });
      fireEvent.pointerUp(frame, { clientX: 220, clientY: 100 });
      expect(within(dialog).getByText("Europe · 1 of 3")).toBeInTheDocument();
    });

    it("closes on Esc or Close and gives focus back to the card it came from", () => {
      const { dialog, opener } = openFirst();
      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(opener).toHaveFocus();

      fireEvent.click(opener);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
