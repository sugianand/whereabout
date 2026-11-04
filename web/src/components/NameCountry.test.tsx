import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { countryName } from "@/lib/countries";
import type { GameRecord } from "@/lib/game/deck";
import { BEST_NAME_KEY } from "@/lib/game/nameCountry";
import { loadNameDay, rememberNameDay } from "@/lib/game/nameDaily";
import type { AtlasGuess, CatalogPhoto } from "@/lib/game/types";
import { gameFor } from "@/test/deck";

import NameCountry from "./NameCountry";

function record(id: string, country: string, atlas: AtlasGuess | null): GameRecord {
  const photo: CatalogPhoto = {
    id,
    imageUrl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${id}.jpg/1280px-${id}.jpg`,
    lng: 10,
    lat: 45,
    place: `Place ${id}`,
    country,
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

// Five French photos Atlas reads rightly, and five Japanese ones: j1 to j4 Atlas reads as Atlantis
// (a country on none of the four names), and j5 it never guessed.
const RECORDS = [
  ...[1, 2, 3, 4, 5].map((i) => record(`e${i}`, "FR", atlasSays("FR", 0.62))),
  ...[1, 2, 3, 4].map((i) => record(`j${i}`, "JP", atlasSays("XA", 0.9))),
  record("j5", "JP", null),
];
const BY_ID = new Map(RECORDS.map((r) => [r.photo.id, r]));

beforeEach(() => localStorage.clear());

async function setup(random: () => number = () => 0.5) {
  const game = gameFor(RECORDS);
  const { container } = render(
    <NameCountry deck={game.deck} loadRecords={game.loadRecords} random={random} />,
  );
  await waitFor(() => expect(screen.getByTestId("name-option-4")).toBeEnabled(), {
    timeout: 5000,
  });
  const photoId = () => container.querySelector("main")!.getAttribute("data-photo")!;
  return { photoId, truth: () => BY_ID.get(photoId())!.photo.country };
}

const option = (country: string) =>
  screen.getByRole("button", { name: new RegExp(countryName(country)) });
const streak = () => screen.getByText("Streak").nextElementSibling;
const wrongOf = (truth: string) =>
  [1, 2, 3, 4]
    .map((n) => screen.getByTestId(`name-option-${n}`).getAttribute("data-country")!)
    .find((c) => c !== truth)!;

describe("NameCountry", () => {
  it("offers four names from the photo's continent, and shows nothing of the answer", async () => {
    const { truth } = await setup();
    expect(option(truth())).toBeEnabled();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.queryByText(/^Place /)).toBeNull();
  });

  it("a right tap counts, names the place and its continent, and deals the next photo", async () => {
    const { truth, photoId } = await setup();
    const first = photoId();
    const country = truth();
    fireEvent.click(option(country));
    const card = screen.getByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent(`Right: ${countryName(country)}`);
    expect(card).toHaveTextContent(`Place ${first}, ${country === "FR" ? "Europe" : "Asia"}`);
    expect(streak()).toHaveTextContent("1");
    expect(localStorage.getItem(BEST_NAME_KEY)).toBe("1");
    fireEvent.click(within(card).getByRole("button", { name: "Next photo" }));
    await waitFor(() => expect(photoId()).not.toBe(first));
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("a wrong tap ends the run and shows the right name; a new run starts at 0", async () => {
    localStorage.setItem(BEST_NAME_KEY, "3");
    const { truth } = await setup();
    const country = truth();
    fireEvent.click(option(wrongOf(country)));
    const card = screen.getByRole("region");
    expect(within(card).getByRole("heading")).toHaveTextContent(`Wrong: ${countryName(country)}`);
    expect(card).toHaveTextContent("Run over: 0 countries in a row. Your best is 3 countries.");
    fireEvent.click(within(card).getByRole("button", { name: "Start a new run" }));
    await waitFor(() => expect(screen.getByTestId("name-option-1")).toBeEnabled());
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("takes 1 to 4 from the keyboard, ignoring other keys", async () => {
    await setup();
    fireEvent.keyDown(window, { key: "5" });
    expect(screen.queryByRole("region")).toBeNull();
    fireEvent.keyDown(window, { key: "2" });
    expect(screen.getByRole("region")).toBeInTheDocument();
  });

  it("says what Atlas leaned to, or that it sat the photo out", async () => {
    // Each deal differs, so play until both kinds of photo have come up, restarting on a miss.
    const { truth } = await setup();
    const seen = new Set<string>();
    for (let i = 0; i < 10 && seen.size < 2; i++) {
      const country = truth();
      fireEvent.click(option(country));
      const card = screen.getByRole("region");
      if (country === "FR") {
        expect(card).toHaveTextContent(
          "Of these four, Atlas leaned most to France (62%), and got it.",
        );
        expect(within(option("FR")).getByText("Atlas")).toBeInTheDocument();
        seen.add("read");
      } else if (card.textContent?.includes("sat this one out")) {
        seen.add("sat out");
      }
      const next = within(card).getByRole("button", { name: "Next photo" });
      fireEvent.click(next);
      await waitFor(() => expect(screen.queryByRole("region")).toBeNull());
      await waitFor(() => expect(screen.getByTestId("name-option-4")).toBeEnabled());
    }
    expect(seen).toEqual(new Set(["read", "sat out"]));
  });

  it("says when every photo has been named", async () => {
    const game = gameFor(RECORDS.slice(0, 5));
    render(<NameCountry deck={game.deck} loadRecords={game.loadRecords} random={() => 0.5} />);
    for (let i = 0; i < 5; i++) {
      await waitFor(() => expect(screen.getByTestId("name-option-4")).toBeEnabled());
      fireEvent.click(option("FR"));
      fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
    }
    expect(await screen.findByRole("heading", { name: "All 5 named" })).toBeInTheDocument();
  });

  it("explains itself with nothing to deal", async () => {
    const empty = gameFor([]);
    render(<NameCountry deck={empty.deck} loadRecords={vi.fn()} />);
    expect(
      await screen.findByRole("heading", { name: "No photos to play yet" }),
    ).toBeInTheDocument();
  });

  describe("today's run", () => {
    const DAY = "2026-11-04";
    const now = () => new Date(`${DAY}T12:00:00Z`);

    async function daily() {
      const game = gameFor(RECORDS);
      const view = render(
        <NameCountry deck={game.deck} loadRecords={game.loadRecords} daily now={now} />,
      );
      await waitFor(() => expect(screen.getByTestId("name-option-4")).toBeEnabled(), {
        timeout: 5000,
      });
      const shown = () => ({
        id: view.container.querySelector("main")!.getAttribute("data-photo")!,
        names: [1, 2, 3, 4].map((n) =>
          screen.getByTestId(`name-option-${n}`).getAttribute("data-country"),
        ),
      });
      return { ...view, shown };
    }
    const right = (id: string) => BY_ID.get(id)!.photo.country;

    it("deals the same photo and names again, and picks up after a right tap", async () => {
      const first = await daily();
      const opening = first.shown();
      first.unmount();

      const second = await daily();
      expect(second.shown()).toEqual(opening);
      fireEvent.click(option(right(opening.id)));
      expect(loadNameDay(DAY)).toMatchObject({ streak: 1, ended: null });
      second.unmount();

      const third = await daily();
      expect(streak()).toHaveTextContent("1");
      expect(third.shown().id).not.toBe(opening.id);
      expect(screen.queryByText("Best")).toBeNull();
    });

    it("ends on the first miss, keeps no free-run best, and offers the share", async () => {
      rememberNameDay(DAY, { streak: 1, atlasRight: 0, atlasPlayed: 0, ended: null });
      const { shown } = await daily();
      fireEvent.click(option(wrongOf(right(shown().id))));
      expect(await screen.findByText("Today's run is over: 1 country in a row.")).toBeVisible();
      expect(screen.getByRole("button", { name: "Share today's run" })).toHaveFocus();
      expect(screen.queryByRole("button", { name: "Start a new run" })).toBeNull();
      expect(loadNameDay(DAY)?.ended).toBe("miss");
      expect(localStorage.getItem(BEST_NAME_KEY)).toBeNull();
    });

    it("shows a finished day instead of dealing it again", async () => {
      rememberNameDay(DAY, { streak: 4, atlasRight: 2, atlasPlayed: 3, ended: "miss" });
      const game = gameFor(RECORDS);
      render(<NameCountry deck={game.deck} loadRecords={game.loadRecords} daily now={now} />);
      expect(await screen.findByRole("heading", { name: "4 countries in a row" })).toBeVisible();
      expect(screen.getByText(/Atlas got 2 of the 3 photos it played/)).toBeVisible();
      expect(screen.queryByTestId("name-option-1")).toBeNull();
    });

    it("marks a run that names the last photo as cleared, and shows the whole day", async () => {
      const count = RECORDS.length - 1;
      rememberNameDay(DAY, { streak: count, atlasRight: 0, atlasPlayed: 0, ended: null });
      const { shown } = await daily();
      fireEvent.click(option(right(shown().id)));
      expect(loadNameDay(DAY)?.ended).toBe("cleared");
      fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
      expect(await screen.findByRole("heading", { name: "You named every photo" })).toBeVisible();
    });
  });
});
