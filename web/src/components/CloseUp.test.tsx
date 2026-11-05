import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { countryName } from "@/lib/countries";
import { BEST_CLOSE_KEY } from "@/lib/game/closeUp";
import type { GameRecord } from "@/lib/game/deck";
import type { AtlasGuess, CatalogPhoto } from "@/lib/game/types";
import { gameFor } from "@/test/deck";

import CloseUp from "./CloseUp";

function record(id: string, country: string, atlas: AtlasGuess | null): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
    lng: 10,
    lat: 45,
    place: `Place ${id}`,
    country,
    width: 4000,
    height: 3000,
    credit: { author: "A. Photographer", license: "CC BY 4.0", sourceUrl: `https://c/${id}` },
  };
  return { photo, atlas };
}

function atlasSays(country: string, p: number): AtlasGuess {
  return {
    lng: 10,
    lat: 45,
    confidence: p,
    topCountries: [{ country, p }],
    belief: { [country]: p },
    clues: [],
  };
}

const RECORDS = [
  ...[1, 2, 3, 4, 5].map((i) => record(`e${i}`, "FR", atlasSays("FR", 0.62))),
  ...[1, 2, 3, 4].map((i) => record(`j${i}`, "JP", atlasSays("XA", 0.9))),
  record("j5", "JP", null),
];
const BY_ID = new Map(RECORDS.map((r) => [r.photo.id, r]));

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 400,
    height: 300,
  } as DOMRect);
});

async function setup(loadFocus: (url: string) => Promise<null | { x: number; y: number }>) {
  const game = gameFor(RECORDS);
  const { container } = render(
    <CloseUp
      deck={game.deck}
      loadRecords={game.loadRecords}
      random={() => 0.5}
      loadFocus={loadFocus}
    />,
  );
  await waitFor(() => expect(screen.getByTestId("close-option-4")).toBeEnabled(), {
    timeout: 5000,
  });
  const photoId = () => container.querySelector("main")!.getAttribute("data-photo")!;
  const truth = () => BY_ID.get(photoId())!.photo.country;
  return { truth };
}

const noFocus = async () => null;
const option = (country: string) =>
  screen.getByRole("button", { name: new RegExp(countryName(country)) });
const names = () =>
  [1, 2, 3, 4].map((n) => screen.getByTestId(`close-option-${n}`).dataset.country!);

describe("Close-up", () => {
  it("zooms out with each wrong name and rules it out, and pays less for it", async () => {
    const { truth } = await setup(noFocus);
    expect(screen.getByText("Worth 3 points")).toBeInTheDocument();
    expect(screen.getByTestId("close-photo")).toHaveAttribute("data-stage", "0");
    const scale = () =>
      Number(/scale\(([\d.]+)\)/.exec(screen.getByTestId("close-photo").style.transform)![1]);
    const tight = scale();

    const wrong = names().find((c) => c !== truth())!;
    fireEvent.click(option(wrong));
    expect(option(wrong)).toBeDisabled();
    expect(screen.getByText("Worth 2 points")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(`Not ${countryName(wrong)}`);
    expect(screen.getByTestId("close-photo")).toHaveAttribute("data-stage", "1");
    expect(scale()).toBeLessThan(tight);

    fireEvent.click(option(truth()));
    expect(screen.getByRole("heading", { name: /^Right/ })).toBeInTheDocument();
    expect(screen.getByTestId("close-photo")).toHaveAttribute("data-stage", "whole");
    expect(screen.getByText(/^2 points, after 1 wrong\./)).toBeInTheDocument();
  });

  it("ends a photo on the third wrong name, naming the answer", async () => {
    const { truth } = await setup(noFocus);
    for (const c of names().filter((c) => c !== truth())) fireEvent.click(option(c));
    expect(
      screen.getByRole("heading", { name: `Out of tries: ${countryName(truth())}` }),
    ).toBeInTheDocument();
    expect(screen.getByText(/^No points on this one\./)).toBeInTheDocument();
  });

  it("says what Atlas would have done, with the whole photo in front of it", async () => {
    const { truth } = await setup(noFocus);
    fireEvent.click(option(truth()));
    expect(
      screen.getByText(/Atlas, with the whole photo, would have|Atlas sat this one out/),
    ).toBeInTheDocument();
  });

  it("plays five photos to a score, keeps the best and deals again", async () => {
    const { truth } = await setup(noFocus);
    for (let i = 1; i <= 5; i++) {
      await waitFor(() => expect(screen.getByTestId("close-option-4")).toBeEnabled());
      expect(screen.getByText(`Photo ${i} of 5`)).toBeInTheDocument();
      fireEvent.keyDown(window, { key: String(names().indexOf(truth()) + 1) });
      fireEvent.click(
        screen.getByRole("button", { name: i === 5 ? "See the score" : "Next photo" }),
      );
    }
    expect(screen.getByRole("heading", { name: "15 of 15 points" })).toBeInTheDocument();
    expect(screen.getByText("That's your new best!")).toBeInTheDocument();
    expect(localStorage.getItem(BEST_CLOSE_KEY)).toBe("15");

    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    await waitFor(() => expect(screen.getByText("Photo 1 of 5")).toBeInTheDocument());
  });

  it("opens the crop on the busiest spot when it can be read, and asks for a thumbnail once", async () => {
    const loadFocus = vi.fn(async () => ({ x: 1, y: 0 }));
    await setup(loadFocus);
    expect(loadFocus).toHaveBeenCalledTimes(1);
    // Hard against the photo's right edge, and level with its top.
    expect(screen.getByTestId("close-photo").style.transform).toMatch(/translate\(-[\d.]+px, 0px\)/);
  });

  it("still deals when the spot can't be read", async () => {
    await setup(() => Promise.reject(new Error("no CORS")));
    expect(screen.getByTestId("close-photo")).toBeInTheDocument();
  });
});
