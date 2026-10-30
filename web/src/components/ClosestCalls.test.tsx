import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { GameRecord } from "@/lib/game/deck";
import type { PlayedPhoto } from "@/lib/playedMap";

import ClosestCalls, { CARD_WIDTH, cardImage, type ClosestCallsDeck } from "./ClosestCalls";

const THUMB =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Some_place.jpg/1280px-Some_place.jpg";

function played(id: string, km: number | null, over: Partial<PlayedPhoto> = {}): PlayedPhoto {
  return {
    id,
    lng: 2.35,
    lat: 48.86,
    place: `Place ${id}`,
    country: "FR",
    km,
    score: 4000,
    day: "2026-10-30",
    ...over,
  };
}

function record(id: string, atlas: { lng: number; lat: number } | null): GameRecord {
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
    atlas: atlas && { ...atlas, confidence: 0.5, topCountries: [], clues: [] },
  };
}

const deck: ClosestCallsDeck = {
  version: "v1",
  ids: ["near", "mid", "far", "atlas-out"],
  regions: { Europe: ["near", "mid", "far", "atlas-out", "x"] },
};

function cards() {
  return within(screen.getByRole("list", { name: "Your closest calls" })).getAllByRole("listitem");
}

describe("ClosestCalls", () => {
  it("shows nothing until a round has a pin", () => {
    const { container } = render(
      <ClosestCalls played={[played("blitz", null)]} deck={deck} loadRecord={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("ranks the nearest pins with each photo, both distances and a continent game", async () => {
    const loadRecord = vi.fn(async (id: string) =>
      // Atlas guessed Paris itself on "near" (0 km), and Berlin on "mid".
      id === "near"
        ? record(id, { lng: 2.35, lat: 48.86 })
        : id === "atlas-out"
          ? record(id, null)
          : record(id, { lng: 13.4, lat: 52.52 }),
    );
    render(
      <ClosestCalls
        played={[
          played("far", 1500),
          played("near", 0.3),
          played("blitz", null),
          played("mid", 40),
          played("atlas-out", 900, { country: "JP", place: "Kyoto" }),
        ]}
        deck={deck}
        loadRecord={loadRecord}
      />,
    );

    const list = cards();
    expect(list).toHaveLength(4);
    expect(list.map((c) => c.querySelector("p")?.textContent)).toEqual([
      "Place near",
      "Place mid",
      "Kyoto",
      "Place far",
    ]);
    expect(list[0]).toHaveTextContent("#1");
    expect(list[0]).toHaveTextContent("You300 m");

    await waitFor(() => expect(cards()[0]).toHaveTextContent("Atlas0 m"));
    const [near, mid, kyoto, far] = cards();
    expect(near).toHaveTextContent("Atlas got closer");
    expect(mid).toHaveTextContent("Atlas877 km");
    expect(mid).toHaveTextContent("You beat Atlas");
    expect(kyoto).toHaveTextContent("AtlasNo guess");
    expect(kyoto).not.toHaveTextContent(/beat|closer|heat/);
    expect(far).toHaveTextContent("Atlas got closer");

    // The photo, small, credited to its Commons page.
    const img = within(mid).getByRole("img", { name: "Your photo from Place mid" });
    expect(img).toHaveAttribute("src", cardImage(THUMB));
    expect(within(mid).getByRole("link", { name: "Author mid" })).toHaveAttribute(
      "href",
      "https://commons.wikimedia.org/wiki/File:mid.jpg",
    );
    // A continent game for Europe; Japan's continent can't fill one in this deck.
    expect(within(mid).getByRole("link", { name: "Play Europe →" })).toHaveAttribute(
      "href",
      "/?region=europe",
    );
    expect(within(kyoto).queryByRole("link", { name: /Play/ })).toBeNull();
    // Only the four shown photos were fetched; never the round with no pin.
    expect(loadRecord.mock.calls.map(([id]) => id).sort()).toEqual(
      ["atlas-out", "far", "mid", "near"].sort(),
    );
  });

  it("keeps a card whose record fails or whose photo the site no longer deals", async () => {
    const loadRecord = vi.fn(async (id: string) => {
      if (id === "mid") throw new Error("offline");
      return record(id, { lng: 2.35, lat: 48.86 });
    });
    render(
      <ClosestCalls
        played={[played("gone", 1), played("mid", 40), played("near", 5)]}
        deck={deck}
        loadRecord={loadRecord}
      />,
    );
    await waitFor(() => expect(cards()[1]).toHaveTextContent("Atlas0 m"));
    const [gone, near, mid] = cards();
    expect(gone).toHaveTextContent("Place gone");
    expect(gone).not.toHaveTextContent("Atlas");
    expect(within(gone).queryByRole("img")).toBeNull();
    expect(near).toHaveTextContent("Place near");
    expect(mid).toHaveTextContent("You40 km");
    expect(mid).not.toHaveTextContent("Atlas");
    expect(loadRecord).not.toHaveBeenCalledWith("gone");
  });
});

describe("cardImage", () => {
  it("asks Wikimedia for a card-sized thumbnail, and leaves other addresses alone", () => {
    expect(cardImage(THUMB)).toBe(THUMB.replace("/1280px-", `/${CARD_WIDTH}px-`));
    expect(cardImage("https://example.org/photo.jpg")).toBe("https://example.org/photo.jpg");
  });
});
